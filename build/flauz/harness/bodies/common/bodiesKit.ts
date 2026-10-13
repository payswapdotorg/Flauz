/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-006 organization-defaults kit: the deterministic staged-record
 * runtime over the bodies contract vocabulary AND the REAL DH-01
 * harness surfaces (imported, never re-implemented - THE IMPORT LAW,
 * this wave's charter). The kit walks a record begin -> addBody /
 * replaceBodySummary / removeBody -> finalizeDefaults: beginDefaults
 * binds the record to a harness through the REAL DH-01 harness-id
 * alphabet (the FORM law - isHarnessId, imported by reference; the
 * EXISTENCE binding is the caller's wiring and the AGREEMENT with the
 * bound harness's own industry is the caller's composition law, both
 * pinned in the battery through the real DH-01 kit) and mints the
 * flauz:bod:<16-hex> id from the injected rng (the organization
 * defaults are industry-scoped over the REAL frozen HARNESS_INDUSTRIES
 * list, imported by reference); the body ops apply the body laws
 * (shape, bounds, uniqueness, the MAX_BODIES bound); finalizeDefaults
 * freezes the record (composing -> composed, TERMINAL - the
 * empty-bodies floor fires there, never the record shape) AND
 * enforces THE ROLE-RESOLUTION LAW: every non-empty roleRef in the
 * record must resolve against the CALLER-SUPPLIED composed
 * RoleCompositionSession's roles (validated through the REAL DH-03
 * validateRoleCompositionSession import - a malformed or non-composed
 * roles record is the typed malformed-roles refusal, fail closed; a
 * dangling roleRef is the typed dangling-role-ref refusal naming
 * every offending ref; the two-phase law: dangling roleRefs are LEGAL
 * while composing). THE REMOVE+RE-ADD LAW: a body's key is its
 * identity - immutable once added; replaceBodySummary replaces ONLY
 * the summary; a changed bodyKey is a NEW body (remove, then
 * re-add). Removing the last body is LEGAL while composing (the
 * floor fires only at finalize). emitOrganizationRef emits the
 * COMPOSED record's id as the organizationRef string (the DH-02
 * review composition's reference-family member form - the emitted
 * organization reference rides the review composition's
 * capabilityRefs family, the landed schema's capability-side slot for
 * the org's default agent-body shapes). NO catalog and NO roles
 * authority is injected: the role resolution happens ONLY against the
 * caller-supplied roles record at the finalize boundary (THE CONTENT
 * LAW: no per-industry body/organization content is shipped - the
 * wave is the LAYER, the machinery; the caller composes the bodies;
 * this family never invents them).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * DH-01/DH-02/DH-03/DH-04/DH-05 laws EXACTLY): the same .flauz/harness
 * subtree, distinct files - the append-only ops ledger
 * .flauz/harness/bodies-ops.jsonl (one canonical JSON line per
 * applied op, the seq strictly increasing and equal to the line
 * number) and the envelope .flauz/harness/bodies-records.json ({
 * contractVersion, seq, records }). The ledger is authoritative; the
 * finalize line carries the caller-supplied composed roles record AS
 * IT STOOD as its payload (the entry-as-it-stood discipline - the
 * replay re-proves THE ROLE-RESOLUTION LAW from the ledger alone);
 * loadBodiesKit replays it and cross-checks the envelope
 * byte-for-byte (a torn or missing line is the typed E_LEDGER_TORN; a
 * divergent envelope is the typed E_ENVELOPE_MISMATCH - never
 * silently rebuilt). A version-bearing surface (a ledger line or the
 * envelope) carrying another contract version is the typed
 * version-mismatch - THE SINGLE-VERSION LAW's live station in this
 * family (the six-key record carries no version field). Lazy
 * persistence (the subtree lands with the first applied op); a fresh
 * kit never appends over a non-empty bodies ledger - reopen with
 * loadBodiesKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE IMPORT LAW,
 * THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW, THE
 * ROLE-RESOLUTION LAW, THE REMOVE+RE-ADD LAW, THE NO-FORK LAW, THE
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
        MAX_BODIES,
        BODIES_CONTRACTS_VERSION,
        BODY_ID_PREFIX,
        BODIES_REJECTION_REASONS,
        isHarnessId,
        isHarnessIndustry,
        isBodyId,
        isBodyOpName,
        isBodyStage,
        serializeOrganizationDefaultsRecord,
        validateBodyEntry,
        validateBodySummary,
        validateOrganizationDefaultsRecord,
} from './bodiesContract.js';
import type {
        HarnessIndustry,
        BodyOpName,
        BodiesRejection,
        BodyDefaultsEntry,
        BodyTransitionNote,
        OrganizationDefaultsRecord,
        BodyStage,
} from './bodiesContract.js';
import { validateRoleCompositionSession } from '../../roles/common/rolesContract.js';
import type { RoleCompositionSession } from '../../roles/common/rolesContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { BODIES_CONTRACTS_VERSION } from './bodiesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-02 version, re-carried by reference. */
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-03 version, re-carried by reference. */
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-04 version, re-carried by reference. */
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as the landed families, distinct file). */
export const BODIES_ENVELOPE_RELATIVE_PATH = '.flauz/harness/bodies-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const BODIES_LEDGER_RELATIVE_PATH = '.flauz/harness/bodies-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the industry on begin, the body entry on the body
 * ops, the caller-supplied composed roles record AS IT STOOD on
 * finalize).
 */
export const BODIES_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'bodyId',
        'harnessId',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const BODIES_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only organization-defaults ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the record id, the
 * BOUND harness id (the REAL DH-01 flauz:hrn:<16-hex> form, carried
 * on every line), the stage edge walked (fromStage null ONLY on the
 * begin line; the body ops walk the composing->composing self edge -
 * the organization composes its default bodies gradually), the
 * granting law, the canonical op payload (the industry on begin; the
 * added / replacement / removed-as-it-stood body entry on the body
 * ops; the caller-supplied composed roles record as it stood on
 * finalize - the replay re-proves THE ROLE-RESOLUTION LAW from the
 * ledger alone), and the deterministic detail sentence.
 */
export interface BodiesOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: BodyOpName;
        readonly bodyId: string;
        readonly harnessId: string;
        readonly fromStage: BodyStage | null;
        readonly toStage: BodyStage;
        readonly law: string;
        readonly payload: HarnessIndustry | BodyDefaultsEntry | RoleCompositionSession | null;
        readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * BODIES_REJECTION_REASONS):
 *   DISPOSED             - THE DISPOSE LAW: the kit was disposed;
 *                          every operation after dispose rejects;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted record id);
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing bodies ledger line, a structurally
 *                          invalid or out-of-order line, an unknown op
 *                          or an illegal stage edge inside the ledger,
 *                          or a fresh kit attempting to append over an
 *                          existing non-empty bodies ledger (reopen
 *                          with loadBodiesKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the bodies
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   BODIES_IO            - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the bodies family's own files;
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listDefaults
 *                          received an unknown filter field or a
 *                          non-member filter value.
 * The contract's version-mismatch station fires at THIS layer for
 * every version-bearing persisted surface (a ledger line or the
 * envelope carrying another contract version) - THE SINGLE-VERSION
 * LAW's live station in this family.
 */
export const BODIES_KIT_EXTRA_REFUSAL_REASONS = [
        'DISPOSED',
        'CORRUPT_SEAM',
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'BODIES_IO',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 23 domain reasons plus the kit-layer extras. */
export const BODIES_KIT_REFUSAL_REASONS = [
        ...BODIES_REJECTION_REASONS,
        ...BODIES_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type BodiesKitRefusalReason = (typeof BODIES_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isBodiesKitRefusalReason(value: unknown): value is BodiesKitRefusalReason {
        return (BODIES_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface BodiesKitRefusal {
        readonly reason: BodiesKitRefusalReason;
        readonly law: string;
        readonly detail: string;
        readonly items?: readonly string[];
        /** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
        readonly rejections?: readonly BodiesRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog and NO roles authority: the role resolution happens
 * ONLY against the CALLER-SUPPLIED roles record at the finalize
 * boundary (THE ROLE-RESOLUTION LAW / THE CONTENT LAW - the layer,
 * never the domain content).
 */
export interface BodiesKitOptions {
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
export type BodiesRecordOutcome =
        | { readonly ok: true; readonly record: OrganizationDefaultsRecord }
        | { readonly ok: false; readonly refusal: BodiesKitRefusal };

/** The ref outcome: ok carries the emitted organizationRef string; failure carries the typed refusal. */
export type BodiesRefOutcome =
        | { readonly ok: true; readonly organizationRef: string }
        | { readonly ok: false; readonly refusal: BodiesKitRefusal };

/** The list outcome: ok carries the bodyId-ordered honest records; failure carries the typed refusal. */
export type BodiesListOutcome =
        | { readonly ok: true; readonly records: readonly OrganizationDefaultsRecord[] }
        | { readonly ok: false; readonly refusal: BodiesKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type BodiesLoadOutcome =
        | { readonly ok: true; readonly kit: BodiesKit }
        | { readonly ok: false; readonly refusal: BodiesKitRefusal };

/**
 * The deterministic organization-defaults kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the record unchanged (inspectable before and
 * after).
 */
export interface BodiesKit {
        beginDefaults(harnessId: unknown, industry: unknown): Promise<BodiesRecordOutcome>;
        addBody(defaultsId: unknown, body: unknown): Promise<BodiesRecordOutcome>;
        replaceBodySummary(defaultsId: unknown, bodyKey: unknown, summary: unknown): Promise<BodiesRecordOutcome>;
        removeBody(defaultsId: unknown, bodyKey: unknown): Promise<BodiesRecordOutcome>;
        finalizeDefaults(defaultsId: unknown, rolesRecord: unknown): Promise<BodiesRecordOutcome>;
        emitOrganizationRef(defaultsId: unknown): Promise<BodiesRefOutcome>;
        inspectDefaults(defaultsId: unknown): Promise<BodiesRecordOutcome>;
        listDefaults(filter?: unknown): Promise<BodiesListOutcome>;
        dispose(): void;
}

/**
 * Creates an organization-defaults kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02/DH-03/
 * DH-04/DH-05 factory walk EXACTLY (the same preconditions, the same
 * message shapes, the createBodiesKit prefix): the options shape
 * (clock / rng), the clock's first read (a non-empty ISO string), the
 * rng's first read (exactly 16 lowercase hex chars - the id-minting
 * law), and the fsPort/root pairing (both or neither; the port must
 * expose readFile / writeFile / appendFile / mkdir). The factory
 * consumes exactly ONE clock read and ONE rng read (there is no inner
 * kit to re-validate the seams - the battery pins the exact count).
 * The kit starts with ZERO records; persistence is LAZY (the
 * .flauz/harness subtree lands with the first applied op; a fresh kit
 * never appends over an existing non-empty bodies ledger - reopen
 * with loadBodiesKit).
 */
export function createBodiesKit(options: BodiesKitOptions): BodiesKit {
        const bound = validateKitOptions(options, false, 'createBodiesKit');
        return buildBodiesKit(bound, { seq: 0, records: new Map<string, OrganizationDefaultsRecord>() });
}

/**
 * Reopens a persisted organization-defaults kit: replays the
 * append-only bodies ops ledger (the authoritative surface - each line
 * re-validated: the frozen eleven-key line schema, the REAL DH-01
 * harness-id alphabet on every line, the op's stage edge, the record's
 * walk order, the payload's full validation, the MAX_BODIES bound,
 * the replace line's immutable-parts cross-check, the remove line's
 * entry-as-it-stood cross-check, the finalize floor AND the finalize
 * payload's role resolution - THE ROLE-RESOLUTION LAW re-proved from
 * the ledger alone), and cross-checks the envelope byte-for-byte
 * against the replay-built state. A torn or missing bodies ledger
 * line is the typed E_LEDGER_TORN; a divergent, missing or malformed
 * envelope is the typed E_ENVELOPE_MISMATCH (never silently rebuilt);
 * a version-bearing surface carrying another contract version is the
 * typed version-mismatch (THE SINGLE-VERSION LAW's live station); a
 * refused fs port is the typed BODIES_IO. A fresh root (no files)
 * reopens as an empty kit. The options require BOTH fsPort and root
 * (the load is a persistence-surface operation).
 */
export async function loadBodiesKit(options: BodiesKitOptions): Promise<BodiesLoadOutcome> {
        const bound = validateKitOptions(options, true, 'loadBodiesKit');
        const fsPort = bound.fsPort as HarnessFsPort;
        const ledgerPath = `${bound.root}/${BODIES_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${BODIES_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `loadBodiesKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `loadBodiesKit: the fs port refused the bodies ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `loadBodiesKit: the fs port refused the bodies envelope read: ${toMessage(error)}`) };
        }
        const replay = replayBodiesLedger(ledgerText);
        if (!('lines' in replay)) {
                return { ok: false, refusal: replay };
        }
        const crossCheck = crossCheckBodiesEnvelope(envelopeText, replay.lines.length, replay.records);
        if (crossCheck !== null) {
                return { ok: false, refusal: crossCheck };
        }
        return { ok: true, kit: buildBodiesKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly fsPort: HarnessFsPort | null;
        readonly root: string | null;
}

interface BodiesKitState {
        readonly seq: number;
        readonly records: ReadonlyMap<string, OrganizationDefaultsRecord>;
}

/** The persist fold's result: applied means the bodies ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: BodiesKitRefusal }
        | { readonly applied: true; readonly refusal: BodiesKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: BodiesKitRefusal };

function validateKitOptions(options: BodiesKitOptions, requirePersistence: boolean, factoryName: 'createBodiesKit' | 'loadBodiesKit'): BoundOptions {
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
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${BODY_ID_PREFIX}<16-hex>)`,
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
        reason: BodiesKitRefusalReason,
        law: string,
        detail: string,
        items?: readonly string[],
): BodiesKitRefusal {
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
        outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly BodiesRejection[] },
): BodiesKitRefusal {
        const first = outcome.rejections[0];
        return {
                reason: first.reason,
                law: first.law,
                detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
                items: first.items,
                rejections: outcome.rejections,
        };
}

function buildBodiesKit(bound: BoundOptions, seed: BodiesKitState): BodiesKit {
        let disposed = false;
        let mutableSeq = seed.seq;
        const records = new Map<string, OrganizationDefaultsRecord>(seed.records);
        const persisted = bound.fsPort !== null && bound.root !== null;
        const fsPort = bound.fsPort;
        const ledgerPath = bound.root !== null ? `${bound.root}/${BODIES_LEDGER_RELATIVE_PATH}` : '';
        const envelopePath = bound.root !== null ? `${bound.root}/${BODIES_ENVELOPE_RELATIVE_PATH}` : '';
        let dirEnsured = false;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createBodiesKit guards the append).
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

        function copyRecord(record: OrganizationDefaultsRecord): OrganizationDefaultsRecord {
                return JSON.parse(serializeOrganizationDefaultsRecord(record)) as OrganizationDefaultsRecord;
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
        async function persist(line: BodiesOpsLedgerLine, nextRecords: Map<string, OrganizationDefaultsRecord>): Promise<PersistResult> {
                if (!persisted || fsPort === null) {
                        mutableSeq = line.seq;
                        return { applied: true, refusal: null };
                }
                if (!ledgerGuardDone) {
                        let existing: string | null;
                        try {
                                existing = await readText(fsPort, ledgerPath);
                        } catch (error) {
                                return { applied: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the bodies ledger read: ${toMessage(error)}`) };
                        }
                        if (existing !== null && existing.trim().length > 0) {
                                return {
                                        applied: false,
                                        refusal: refused(
                                                'E_LEDGER_TORN',
                                                'THE APPEND-ONLY LEDGER LAW',
                                                'persist: the bodies ledger already carries lines - reopen with loadBodiesKit (a fresh kit never appends over an existing ledger)',
                                        ),
                                };
                        }
                        ledgerGuardDone = true;
                }
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('BODIES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the bodies ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'BODIES_IO',
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the bodies ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextRecords: Map<string, OrganizationDefaultsRecord>): void {
                records.clear();
                for (const [id, record] of nextRecords) {
                        records.set(id, record);
                }
        }

        function recordOutcome(record: OrganizationDefaultsRecord): BodiesRecordOutcome {
                return { ok: true, record: copyRecord(record) };
        }

        /** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
        function refuseIfDisposed(opName: string): BodiesKitRefusal | null {
                if (disposed) {
                        return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
                }
                return null;
        }

        /** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
        function lookupRecord(opName: string, defaultsId: unknown): { record: OrganizationDefaultsRecord } | { refusal: BodiesKitRefusal } {
                if (!isBodyId(defaultsId)) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(defaultsId)}' (a malformed id fails closed as unknown-record)`) };
                }
                const record = records.get(defaultsId);
                if (record === undefined) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${defaultsId}'`) };
                }
                return { record };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
         * 'composing' stage (a composed record is past them - stale-stage,
         * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
         */
        function stageGuard(opName: string, record: OrganizationDefaultsRecord): BodiesKitRefusal | null {
                if (record.stage === 'composing') {
                        return null;
                }
                return refused(
                        'stale-stage',
                        'THE FORWARD-ONLY LAW',
                        `${opName}: the record is at the '${record.stage}' stage - the record is FROZEN ('composed' is TERMINAL; a changed body is a NEW body, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
                        [record.stage],
                );
        }

        /** The body lookup for replace / remove (a malformed bodyKey fails closed as unknown-body). */
        function findBody(record: OrganizationDefaultsRecord, bodyKey: unknown): BodyDefaultsEntry | null {
                if (typeof bodyKey !== 'string') {
                        return null;
                }
                const found = record.bodies.find((entry) => entry.bodyKey === bodyKey);
                return found === undefined ? null : found;
        }

        return {
                async beginDefaults(harnessId: unknown, industry: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginDefaults');
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
                                                'malformed-harness-id',
                                                'THE FAIL-CLOSED LAW',
                                                `beginDefaults: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
                                                [showValue(harnessId)],
                                        ),
                                };
                        }
                        if (!isHarnessIndustry(industry)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-industry',
                                                'THE FROZEN-VOCABULARY LAW',
                                                `beginDefaults: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the organization defaults are industry-scoped)`,
                                                [showValue(industry)],
                                        ),
                                };
                        }
                        const hex = bound.rng();
                        if (!/^[0-9a-f]{16}$/.test(hex)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginDefaults: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
                        }
                        const bodyId = `${BODY_ID_PREFIX}${hex}`;
                        if (records.has(bodyId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginDefaults: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `began the organization-defaults record bound to harness '${harnessId}' over the '${industry}' industry (the walk enters the composing stage with ZERO bodies; the caller composes the bodies - this family never invents them, THE CONTENT LAW)`;
                        const record: OrganizationDefaultsRecord = {
                                bodyId,
                                harnessId,
                                industry,
                                stage: 'composing',
                                bodies: [],
                                history: [
                                        { at, fromStage: null, toStage: 'composing', op: 'begin-defaults', law: 'THE FORWARD-ONLY LAW', detail },
                                ],
                        };
                        const line: BodiesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BODIES_CONTRACTS_VERSION,
                                op: 'begin-defaults',
                                bodyId,
                                harnessId,
                                fromStage: null,
                                toStage: 'composing',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: industry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(bodyId, record);
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
                async addBody(defaultsId: unknown, body: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('addBody');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('addBody', defaultsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('addBody', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const verdict = validateBodyEntry(body);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('addBody', verdict) };
                        }
                        const entry = verdict.value;
                        if (record.bodies.some((existing) => existing.bodyKey === entry.bodyKey)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'duplicate-body-key',
                                                'THE FAIL-CLOSED LAW',
                                                `addBody: the bodyKey '${entry.bodyKey}' is already composed (a body appears once)`,
                                                [entry.bodyKey],
                                        ),
                                };
                        }
                        if (record.bodies.length >= MAX_BODIES) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'max-bodies-exceeded',
                                                'THE FAIL-CLOSED LAW',
                                                `addBody: the record already carries ${record.bodies.length} bodies - the composition bound is MAX_BODIES (${MAX_BODIES})`,
                                                [`${record.bodies.length} bodies`],
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `added the body '${entry.bodyKey}' (a body is CONFIGURATION - it grants NOTHING by itself; dangling roleRefs are LEGAL while composing - THE ROLE-RESOLUTION LAW's two-phase law)`;
                        const next: OrganizationDefaultsRecord = {
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                bodies: [...record.bodies, entry],
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-body', law: 'THE NO-FORK LAW', detail }],
                        };
                        const line: BodiesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BODIES_CONTRACTS_VERSION,
                                op: 'add-body',
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE NO-FORK LAW',
                                payload: entry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.bodyId, next);
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
                async replaceBodySummary(defaultsId: unknown, bodyKey: unknown, summary: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('replaceBodySummary');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('replaceBodySummary', defaultsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('replaceBodySummary', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findBody(record, bodyKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-body',
                                                'THE FAIL-CLOSED LAW',
                                                `replaceBodySummary: no body '${showValue(bodyKey)}' in the record (a malformed bodyKey fails closed as unknown-body)`,
                                        ),
                                };
                        }
                        const verdict = validateBodySummary(summary);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('replaceBodySummary', verdict) };
                        }
                        const replacement: BodyDefaultsEntry = { bodyKey: existing.bodyKey, summary: verdict.value, roleRefs: [...existing.roleRefs] };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `replaced the summary of the body '${existing.bodyKey}' (a body's key is its identity - immutable once added; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
                        const next: OrganizationDefaultsRecord = {
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                bodies: record.bodies.map((entry) => (entry.bodyKey === replacement.bodyKey ? replacement : entry)),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-body-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: BodiesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BODIES_CONTRACTS_VERSION,
                                op: 'replace-body-summary',
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: replacement,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.bodyId, next);
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
                async removeBody(defaultsId: unknown, bodyKey: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('removeBody');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('removeBody', defaultsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('removeBody', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findBody(record, bodyKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-body',
                                                'THE FAIL-CLOSED LAW',
                                                `removeBody: no body '${showValue(bodyKey)}' in the record (a malformed bodyKey fails closed as unknown-body)`,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `removed the body '${existing.bodyKey}' (THE REMOVE+RE-ADD LAW: a changed bodyKey is a NEW body; removing the last body is legal while composing - the empty-bodies floor fires only at finalize)`;
                        const next: OrganizationDefaultsRecord = {
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                bodies: record.bodies.filter((entry) => entry.bodyKey !== existing.bodyKey),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-body', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: BodiesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BODIES_CONTRACTS_VERSION,
                                op: 'remove-body',
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composing',
                                law: 'THE REMOVE+RE-ADD LAW',
                                payload: existing,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.bodyId, next);
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
                async finalizeDefaults(defaultsId: unknown, rolesRecord: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('finalizeDefaults');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('finalizeDefaults', defaultsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('finalizeDefaults', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE ROLE-RESOLUTION LAW, station 1: the CALLER-SUPPLIED roles record must
                        // pass the REAL DH-03 session walk AND sit at 'composed' (fail closed - a
                        // malformed authority resolves nothing, never a silent skip; the kit
                        // NEVER injects a roles authority of its own).
                        const walked = validateRoleCompositionSession(rolesRecord);
                        if (!walked.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-roles',
                                                'THE ROLE-RESOLUTION LAW',
                                                'finalizeDefaults: the caller-supplied roles record fails the REAL DH-03 validateRoleCompositionSession walk (a malformed authority resolves nothing - fail closed, never a silent skip)',
                                        ),
                                };
                        }
                        const rolesSession = walked.value;
                        if (rolesSession.stage !== 'composed') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-roles',
                                                'THE ROLE-RESOLUTION LAW',
                                                `finalizeDefaults: the caller-supplied roles record is at the '${rolesSession.stage}' stage - roleRefs resolve ONLY against a COMPOSED roles record (the frozen role composition)`,
                                                [rolesSession.stage],
                                        ),
                                };
                        }
                        // THE DH-01 FLOOR: at least one body at finalize (never the record shape).
                        if (record.bodies.length === 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'empty-bodies',
                                                'THE FAIL-CLOSED LAW',
                                                'finalizeDefaults: the organization defaults must compose at least one body (THE DH-01 FLOOR - compose bodies with addBody first; the floor fires HERE, never the record shape)',
                                                ['bodies'],
                                        ),
                                };
                        }
                        // THE NO-DANGLING-REF boundary: every non-empty roleRef must resolve against
                        // the caller-supplied composed roles record's roles (each offender named
                        // once, first-seen order).
                        const known = new Set<string>(rolesSession.roles.map((role) => role.roleKey));
                        const reported = new Set<string>();
                        const dangling: string[] = [];
                        for (const body of record.bodies) {
                                for (const ref of body.roleRefs) {
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
                                                'dangling-role-ref',
                                                'THE ROLE-RESOLUTION LAW',
                                                `finalizeDefaults: every non-empty roleRef must resolve against the caller-supplied composed roles record '${rolesSession.sessionId}' (a dangling roleRef is never a silent skip; the two-phase law allowed these while composing)`,
                                                dangling,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `finalized the organization defaults (${record.bodies.length} body(s); composing -> composed, TERMINAL - the record is FROZEN, a changed body is a NEW body; every roleRef resolved against the caller-supplied composed roles record '${rolesSession.sessionId}')`;
                        const next: OrganizationDefaultsRecord = {
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composed',
                                bodies: record.bodies.map((body) => ({ bodyKey: body.bodyKey, summary: body.summary, roleRefs: [...body.roleRefs] })),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-defaults', law: 'THE ROLE-RESOLUTION LAW', detail }],
                        };
                        const line: BodiesOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BODIES_CONTRACTS_VERSION,
                                op: 'finalize-defaults',
                                bodyId: record.bodyId,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composed',
                                law: 'THE ROLE-RESOLUTION LAW',
                                payload: rolesSession,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(record.bodyId, next);
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
                async emitOrganizationRef(defaultsId: unknown): Promise<BodiesRefOutcome> {
                        const disposedRefusal = refuseIfDisposed('emitOrganizationRef');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('emitOrganizationRef', defaultsId);
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
                                                `emitOrganizationRef: the record is at the '${record.stage}' stage - an organizationRef is emitted ONLY from a COMPOSED record (finalizeDefaults first)`,
                                                [record.stage],
                                        ),
                                };
                        }
                        // The emitted ref IS the composed record's id (the review composition's
                        // reference-family member form: a string, duplicate-free by identity).
                        // A pure read: no state change, no ledger line - the ref is deterministic.
                        return { ok: true, organizationRef: record.bodyId };
                },
                async inspectDefaults(defaultsId: unknown): Promise<BodiesRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectDefaults');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('inspectDefaults', defaultsId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return recordOutcome(lookup.record);
                },
                async listDefaults(filter?: unknown): Promise<BodiesListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listDefaults');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listDefaults: the filter must be an object (or absent)') };
                                }
                                const filterRecord = filter as Record<string, unknown>;
                                const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'harnessId');
                                if (unknownFields.length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listDefaults: the filter carries an unknown field (stage / industry / harnessId only)', unknownFields),
                                        };
                                }
                                if (filterRecord.stage !== undefined && !isBodyStage(filterRecord.stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listDefaults: the stage filter value is not a member of the frozen BODY_STAGES list') };
                                }
                                if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listDefaults: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
                                }
                                if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listDefaults: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
                                }
                        }
                        const ids = [...records.keys()].sort();
                        const listed: OrganizationDefaultsRecord[] = [];
                        for (const id of ids) {
                                const entry = records.get(id) as OrganizationDefaultsRecord;
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

interface BodiesLedgerReplay {
        readonly lines: readonly BodiesOpsLedgerLine[];
        readonly records: Map<string, OrganizationDefaultsRecord>;
}

/** Parses and validates the whole bodies ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayBodiesLedger(ledgerText: string | null): BodiesLedgerReplay | BodiesKitRefusal {
        if (ledgerText === null || ledgerText.length === 0) {
                return { lines: [], records: new Map<string, OrganizationDefaultsRecord>() };
        }
        if (!ledgerText.endsWith('\n')) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies ledger does not end with a complete line (a torn append - never a silent skip)');
        }
        const records = new Map<string, OrganizationDefaultsRecord>();
        const lines: BodiesOpsLedgerLine[] = [];
        const rawLines = ledgerText.split('\n');
        rawLines.pop();
        for (let i = 0; i < rawLines.length; i += 1) {
                if (rawLines[i].length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${i + 1} is empty`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(rawLines[i]);
                } catch {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
                }
                const torn = validateBodiesLedgerLine(parsed, i + 1, records);
                if (torn !== null) {
                        return torn;
                }
                const record = parsed as Record<string, unknown>;
                const line: BodiesOpsLedgerLine = {
                        seq: record.seq as number,
                        at: record.at as string,
                        contractVersion: record.contractVersion as string,
                        op: record.op as BodyOpName,
                        bodyId: record.bodyId as string,
                        harnessId: record.harnessId as string,
                        fromStage: record.fromStage as BodyStage | null,
                        toStage: record.toStage as BodyStage,
                        law: record.law as string,
                        payload: record.payload as BodiesOpsLedgerLine['payload'],
                        detail: record.detail as string,
                };
                applyBodiesLine(records, line);
                lines.push(line);
        }
        return { lines, records };
}

/** Validates one parsed bodies ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateBodiesLedgerLine(parsed: unknown, lineNo: number, records: Map<string, OrganizationDefaultsRecord>): BodiesKitRefusal | null {
        if (!isRecord(parsed)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is not a JSON object`);
        }
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...BODIES_LEDGER_LINE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
        }
        if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
        }
        if (typeof record.at !== 'string' || record.at.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
        }
        if (record.contractVersion !== BODIES_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${BODIES_CONTRACTS_VERSION}' is known (the single-version law; the six-key record carries no version field, so THIS is the law's live station)`);
        }
        if (!isBodyOpName(record.op)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
        }
        if (!isBodyId(record.bodyId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries a malformed record id`);
        }
        if (!isHarnessId(record.harnessId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
        }
        if (record.fromStage !== null && !isBodyStage(record.fromStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries an unknown fromStage`);
        }
        if (!isBodyStage(record.toStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries an unknown toStage`);
        }
        if (typeof record.law !== 'string' || record.law.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries no law name (the provenance law)`);
        }
        if (typeof record.detail !== 'string' || record.detail.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries no provenance detail`);
        }
        const op = record.op as BodyOpName;
        const defaults = records.get(record.bodyId as string);
        if (op === 'begin-defaults') {
                if (record.fromStage !== null || record.toStage !== 'composing') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
                }
                if (!isHarnessIndustry(record.payload)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
                }
                if (defaults !== undefined) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} begins a duplicate record id`);
                }
                return null;
        }
        if (defaults === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} advances an unknown record`);
        }
        if (defaults.stage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
        }
        if (op === 'finalize-defaults') {
                if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
                }
                // The finalize payload is the caller-supplied composed roles record AS IT
                // STOOD: the replay re-proves the REAL DH-03 walk, the composed stage, the
                // empty-bodies floor AND the NO-DANGLING-REF resolution from the ledger alone.
                const walked = validateRoleCompositionSession(record.payload);
                if (!walked.ok) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a finalize line carrying an invalid roles payload (the REAL DH-03 session walk)`);
                }
                if (walked.value.stage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a finalize line whose roles payload is not at the 'composed' stage (THE ROLE-RESOLUTION LAW)`);
                }
                if (defaults.bodies.length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} finalizes an empty record (THE DH-01 FLOOR - the replay re-validates the boundary law)`);
                }
                const known = new Set<string>(walked.value.roles.map((role) => role.roleKey));
                const dangling = defaults.bodies.flatMap((body) => body.roleRefs).filter((ref) => ref.length > 0 && !known.has(ref));
                if (dangling.length > 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries a dangling roleRef payload resolution (${showList(dangling)}) - THE ROLE-RESOLUTION LAW re-proved from the ledger alone`);
                }
                return null;
        }
        if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} is a body-op line outside the composing->composing self edge (the organization composes its default bodies gradually)`);
        }
        const entry = validateBodyEntry(record.payload);
        if (!entry.ok) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} carries an invalid body payload`);
        }
        const payloadBody = entry.value;
        if (op === 'add-body') {
                if (defaults.bodies.some((body) => body.bodyKey === payloadBody.bodyKey)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} adds a duplicate bodyKey '${payloadBody.bodyKey}'`);
                }
                if (defaults.bodies.length >= MAX_BODIES) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} exceeds the MAX_BODIES (${MAX_BODIES}) composition bound`);
                }
                return null;
        }
        const standing = defaults.bodies.find((body) => body.bodyKey === payloadBody.bodyKey);
        if (standing === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} advances an unknown body '${payloadBody.bodyKey}'`);
        }
        if (op === 'replace-body-summary') {
                // The immutable-parts cross-check: only the summary may differ (a body's key
                // is its identity and the roleRefs are carried unchanged).
                if (JSON.stringify(payloadBody.roleRefs) !== JSON.stringify(standing.roleRefs)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} replaces a body whose roleRefs do not match the record's body as it stood (THE REMOVE+RE-ADD LAW)`);
                }
                return null;
        }
        // remove-body: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
        if (payloadBody.summary !== standing.summary || JSON.stringify(payloadBody.roleRefs) !== JSON.stringify(standing.roleRefs)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: bodies ledger line ${lineNo} removes a body entry that does not match the record's organization defaults as it stood`);
        }
        return null;
}

/** Applies one validated bodies ledger line to the replay records (pure fold). */
function applyBodiesLine(records: Map<string, OrganizationDefaultsRecord>, line: BodiesOpsLedgerLine): void {
        if (line.op === 'begin-defaults') {
                records.set(line.bodyId, {
                        bodyId: line.bodyId,
                        harnessId: line.harnessId,
                        industry: line.payload as HarnessIndustry,
                        stage: line.toStage,
                        bodies: [],
                        history: [noteOf(line)],
                });
                return;
        }
        const record = records.get(line.bodyId);
        if (record === undefined) {
                return;
        }
        const base: OrganizationDefaultsRecord = {
                ...record,
                stage: line.toStage,
                history: [...record.history, noteOf(line)],
        };
        let next: OrganizationDefaultsRecord;
        if (line.op === 'add-body') {
                next = { ...base, bodies: [...record.bodies, line.payload as BodyDefaultsEntry] };
        } else if (line.op === 'replace-body-summary') {
                const replacement = line.payload as BodyDefaultsEntry;
                next = { ...base, bodies: record.bodies.map((body) => (body.bodyKey === replacement.bodyKey ? replacement : body)) };
        } else if (line.op === 'remove-body') {
                const removed = line.payload as BodyDefaultsEntry;
                next = { ...base, bodies: record.bodies.filter((body) => body.bodyKey !== removed.bodyKey) };
        } else {
                next = { ...base, bodies: record.bodies.map((body) => ({ bodyKey: body.bodyKey, summary: body.summary, roleRefs: [...body.roleRefs] })) };
        }
        records.set(line.bodyId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: BodiesOpsLedgerLine): BodyTransitionNote {
        return {
                at: line.at,
                fromStage: line.fromStage,
                toStage: line.toStage,
                op: line.op,
                law: line.law,
                detail: line.detail,
        };
}

/** Cross-checks the bodies envelope against the replay; returns the typed refusal or null. */
function crossCheckBodiesEnvelope(
        envelopeText: string | null,
        lineCount: number,
        replayed: Map<string, OrganizationDefaultsRecord>,
): BodiesKitRefusal | null {
        if (envelopeText === null) {
                if (lineCount === 0) {
                        return null;
                }
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: the bodies envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        let parsedEnvelope: unknown;
        try {
                parsedEnvelope = JSON.parse(envelopeText);
        } catch {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope is not valid JSON');
        }
        if (!isRecord(parsedEnvelope)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope is not a JSON object');
        }
        const envelope = parsedEnvelope as Record<string, unknown>;
        const keys = Object.keys(envelope).sort();
        const expected = [...BODIES_ENVELOPE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope is structurally invalid (the frozen three-key envelope schema)');
        }
        if (envelope.contractVersion !== BODIES_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadBodiesKit: the bodies envelope carries contract version ${showValue(envelope.contractVersion)} - only '${BODIES_CONTRACTS_VERSION}' is known (the single-version law)`);
        }
        if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope carries a malformed seq');
        }
        if (!Array.isArray(envelope.records)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope carries a malformed records array');
        }
        const envelopeSeq = envelope.seq as number;
        if (envelopeSeq > lineCount) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: the bodies envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
        }
        if (envelopeSeq < lineCount) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: the bodies envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        const envelopeRecordMap = new Map<string, OrganizationDefaultsRecord>();
        for (let i = 0; i < envelope.records.length; i += 1) {
                const entry = envelope.records[i];
                if (!validateOrganizationDefaultsRecord(entry).ok) {
                        return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBodiesKit: the bodies envelope's records[${i}] is not a valid organization-defaults record`);
                }
                const defaultsRecord = entry as OrganizationDefaultsRecord;
                envelopeRecordMap.set(defaultsRecord.bodyId, defaultsRecord);
        }
        const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
        const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
        if (replayBytes !== envelopeBytes) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBodiesKit: the bodies envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
        }
        return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: BodiesOpsLedgerLine): string {
        return JSON.stringify({
                seq: line.seq,
                at: line.at,
                contractVersion: line.contractVersion,
                op: line.op,
                bodyId: line.bodyId,
                harnessId: line.harnessId,
                fromStage: line.fromStage,
                toStage: line.toStage,
                law: line.law,
                payload: payloadObject(line.payload),
                detail: line.detail,
        });
}

/** Builds the canonical fixed-key-order object of a ledger-line payload (the industry string, the body entry, or the roles session record). */
function payloadObject(payload: BodiesOpsLedgerLine['payload']): HarnessIndustry | Record<string, unknown> | null {
        if (payload === null) {
                return null;
        }
        if (typeof payload === 'string') {
                return payload;
        }
        if ('sessionId' in payload) {
                return {
                        sessionId: payload.sessionId,
                        industry: payload.industry,
                        stage: payload.stage,
                        roles: payload.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                        history: payload.history.map((note) => ({
                                at: note.at,
                                fromStage: note.fromStage,
                                toStage: note.toStage,
                                op: note.op,
                                law: note.law,
                                detail: note.detail,
                        })),
                };
        }
        return { bodyKey: payload.bodyKey, summary: payload.summary, roleRefs: [...payload.roleRefs] };
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by bodyId). */
function envelopeBytes(seq: number, nextRecords: Map<string, OrganizationDefaultsRecord>): string {
        const ids = [...nextRecords.keys()].sort();
        const listed = ids.map((id) => nextRecords.get(id) as OrganizationDefaultsRecord);
        return `{"contractVersion":${JSON.stringify(BODIES_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
                .map((record) => serializeOrganizationDefaultsRecord(record))
                .join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, OrganizationDefaultsRecord>): string {
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

function matchesRecordFilter(record: OrganizationDefaultsRecord, filter: Record<string, unknown>): boolean {
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
