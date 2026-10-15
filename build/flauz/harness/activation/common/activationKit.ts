/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-011 activation kit: the deterministic end-to-end journey runtime
 * over the activation contract vocabulary AND the REAL LANDED KITS
 * (constructed internally with the SAME injected seams, never
 * re-implemented - THE REAL-KIT LAW). The journey walks the COMPLETE
 * user chain
 *   industry selection -> company/work type -> roles/workloads ->
 *   proposed harness -> validation -> user inspection and approval ->
 *   activation -> usable harness
 * through the REAL DH-002 onboarding kit (beginSession /
 * selectIndustry / composeCompany / selectWorkTypes / composeDraft /
 * proposeSession - the session's own walk), the REAL DH-003
 * role-composition kit (beginSession / addRole / finalizeComposition
 * - THE MULTI-ROLE LAW: one user, multiple roles), the REAL DH-04
 * ontology / DH-05 templates / DH-06 bodies / DH-07 packs / DH-08
 * profiles / DH-09 benchmarks kits (the staged record composition
 * with their cross-record finalize boundaries), and the REAL DH-001
 * harness kit (minted THROUGH the onboarding kit's composeDraft; the
 * post-proposal lifecycle legs - approved, active - reopened and
 * advanced through the authority's OWN loadHarnessKit /
 * advanceHarness surfaces).
 *
 * THE EVIDENCE-NOT-AUTHORITY LAW (binding): the journey record is
 * EVIDENCE of the run, never a second lifecycle authority. The REAL
 * DH-01 harness record remains the ONLY lifecycle authority; the
 * journey's lifecycle legs REOPEN the real kit from its own
 * append-only ledger (loadHarnessKit) at every boundary, re-inspect
 * the authority's own state and advance through the authority's own
 * surface - the journey never maintains a second lifecycle machine,
 * a second journal or an approval broker (THE NO-NEW-AUTHORITY LAW,
 * ARCHITECTURE-LOCK §12.6). THE LINEAGE LAW: the record-composition
 * leg mints a BINDING draft through the real onboarding kit's
 * composeDraft (the provisional composition - the composed roles with
 * empty ref families, THE TWO-PHASE LAW: the refs compose gradually);
 * the six record kits bind to that binding draft id; the proposal leg
 * re-composes the FULL composition (the emitted refs riding the
 * review composition's four ref families) which mints the FINAL
 * draft - a NEW harness id per the registry lineage law (an
 * immutable descriptor can never be re-written; a re-composition is
 * a re-mint, the real kits' own law).
 *
 * THE FAIL-CLOSED LAW (the registry row's core): an incomplete or
 * unsafe proposal NEVER activates. Every unsafe condition is a typed
 * refusal - dangling-ref-at-proposal (the real DH-01
 * draft->proposed boundary refused the full validation),
 * catalog-binding-refused / unapproved-capability (the real approve
 * boundary refused - a capabilityRef absent from or below
 * approved/enabled/available in the catalog snapshot, classified
 * through the REAL validateDomainHarnessDescriptor walk, never
 * re-implemented), malformed-decision (the real kit refused the
 * caller-supplied decision shape), approval-missing (THE
 * APPROVAL-BEFORE-ACTIVATION LAW: no approval input, no activation),
 * incomplete-composition (THE INCOMPLETE-COMPOSITION LAW: the
 * proposal boundary requires every composition leg walked),
 * unsafe-proposal (THE FAIL-CLOSED double-check: the REAL harness
 * record does not sit at 'approved' at the activation boundary - NO
 * code path from an unsafe proposal to an active harness) - each
 * leaving the REAL harness record at its pre-refusal state (the
 * record-unchanged law) and the journey record at its pre-refusal
 * stage. THE VERBATIM-CARRY LAW: every leg's typed refusal names the
 * leg AND carries the underlying real kit's refusal complete, never
 * paraphrased.
 *
 * THE PERSISTENCE-FIRST LAW (this family's own disclosure): the
 * journey kit REQUIRES the fsPort/root pair (never optional like the
 * sibling families) because BOTH of its core surfaces are
 * persistence surfaces - the journey evidence mirror (this family's
 * own PIN-2-style append-only ledger + envelope) AND the lifecycle
 * legs' reopening of the real DH-01 authority from its own persisted
 * ledger (the evidence-not-authority law's literal expression). A
 * non-persistent journey would be a SECOND in-memory lifecycle
 * authority - exactly what THE NO-NEW-AUTHORITY LAW forbids.
 *
 * Persistence (the PIN-2 sibling precedent): the same .flauz/harness
 * subtree, distinct files - the append-only ops ledger
 * .flauz/harness/activation-ops.jsonl (one canonical JSON line per
 * applied op, the seq strictly increasing and equal to the line
 * number) and the envelope .flauz/harness/activation-journeys.json
 * ({ contractVersion, seq, journeys }). The ledger is authoritative;
 * the replay re-proves the journey laws FROM THE LEDGER ALONE (the
 * frozen line schema, the op<->leg table, the stage chain through the
 * contract's own machine, the payload walks through the REAL family
 * validators, THE INCOMPLETE-COMPOSITION LAW, THE
 * APPROVAL-BEFORE-ACTIVATION LAW); the envelope is cross-checked
 * byte-for-byte (E_LEDGER_TORN / E_ENVELOPE_MISMATCH - never
 * silently rebuilt). Lazy persistence (the subtree lands with the
 * first applied op); a fresh kit never appends over an existing
 * non-empty activation ledger - reopen with loadActivationKit;
 * restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header):
 * THE IMPORT LAW, THE REAL-KIT LAW, THE EVIDENCE-NOT-AUTHORITY LAW,
 * THE LINEAGE LAW, THE FORWARD-ONLY LAW, THE FAIL-CLOSED LAW, THE
 * INCOMPLETE-COMPOSITION LAW, THE APPROVAL-BEFORE-ACTIVATION LAW,
 * THE MULTI-ROLE LAW, THE VERBATIM-CARRY LAW, THE CONTENT LAW (no
 * per-industry journey content is shipped - the caller supplies the
 * selections and the domain content; the evidence level is fixture:
 * the battery drives the real kits with fixture inputs - claim
 * exactly that), THE DETERMINISM LAW (no Math.random, no Date.now,
 * no new Date(...) and no process.env in this module - law comments
 * excepted; the clock, the rng, the catalog and the fsPort are
 * INJECTED seams forwarded to the real kits verbatim; the factory
 * consumes exactly ONE clock read and ONE rng read), THE DISPOSE LAW
 * (every operation after dispose rejects with the typed disposed
 * refusal), THE SINGLE-VERSION LAW (the re-export chain).
 */

import {
        ACTIVATION_CONTRACTS_VERSION,
        ACTIVATION_JOURNEY_REJECTION_REASONS,
        canTransitionActivationStage,
        COMPOSED_RECORD_LINKS_SCHEMA_KEYS,
        isActivationJourneyStage,
        isActivationOpName,
        isJourneyLeg,
        isJourneyId,
        JOURNEY_ID_PREFIX,
        JOURNEY_LEG_STAGES,
        JOURNEY_OP_LEGS,
        JOURNEY_OP_REQUIRED_LEGS,
        journeyLegIndex,
        serializeActivationJourney,
        validateActivationJourneyRecord,
        validateJourneyRecordContent,
        validateJourneyDecisionMirror,
} from './activationContract.js';
import type {
        ActivationJourneyNote,
        ActivationJourneyRecord,
        ActivationJourneyRejectionReason,
        ActivationJourneyStage,
        ActivationOpName,
        ComposedRecordLinks,
        JourneyContentRejection,
        JourneyLeg,
        JourneyRecordContent,
} from './activationContract.js';
import type { HarnessCatalogSnapshot, HarnessValidationOutcome, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';
import { isHarnessCatalogSnapshot, isHarnessId, isHarnessIndustry, isHarnessValidationOutcome, validateDomainHarnessDescriptor } from '../../contract/common/domainHarnessContract.js';
import { loadHarnessKit } from '../../contract/common/domainHarnessKit.js';
import type { HarnessFsPort, HarnessKit, HarnessKitRefusal } from '../../contract/common/domainHarnessKit.js';
import { createOnboardingKit, loadOnboardingKit } from '../../onboarding/common/onboardingKit.js';
import type { OnboardingKit, OnboardingKitRefusal } from '../../onboarding/common/onboardingKit.js';
import type { OnboardingCompanyProfile, OnboardingIndustryPayload, OnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';
import { validateOnboardingCompanyProfile, validateOnboardingIndustryPayload, validateOnboardingReviewComposition, validateOnboardingWorkTypes, isOnboardingSessionId } from '../../onboarding/common/onboardingContract.js';
import { createRolesKit, loadRolesKit } from '../../roles/common/rolesKit.js';
import type { RolesKit, RolesKitRefusal } from '../../roles/common/rolesKit.js';
import { validateRoleCompositionSession } from '../../roles/common/rolesContract.js';
import type { RoleCompositionSession } from '../../roles/common/rolesContract.js';
import { createOntologyKit, loadOntologyKit } from '../../ontology/common/ontologyKit.js';
import type { OntologyKit, OntologyKitRefusal } from '../../ontology/common/ontologyKit.js';
import { createTemplatesKit, loadTemplatesKit } from '../../templates/common/templatesKit.js';
import type { TemplatesKit, TemplatesKitRefusal } from '../../templates/common/templatesKit.js';
import { createBodiesKit, loadBodiesKit } from '../../bodies/common/bodiesKit.js';
import type { BodiesKit, BodiesKitRefusal } from '../../bodies/common/bodiesKit.js';
import { createPacksKit, loadPacksKit } from '../../packs/common/packsKit.js';
import type { PacksKit, PacksKitRefusal } from '../../packs/common/packsKit.js';
import { createProfilesKit, loadProfilesKit } from '../../profiles/common/profilesKit.js';
import type { ProfilesKit, ProfilesKitRefusal } from '../../profiles/common/profilesKit.js';
import { createBenchmarksKit, loadBenchmarksKit } from '../../benchmarks/common/benchmarksKit.js';
import type { BenchmarksKit, BenchmarksKitRefusal } from '../../benchmarks/common/benchmarksKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ACTIVATION_CONTRACTS_VERSION } from './activationContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The injected READ-ONLY catalog snapshot is the DH-01 contract's own type (re-exported by reference). */
export type { HarnessCatalogSnapshot } from '../../contract/common/domainHarnessContract.js';

/** The verbatim DH-01 refusal carrier (re-exported by reference for the harness-refused surface). */
export type { HarnessKitRefusal } from '../../contract/common/domainHarnessKit.js';

/** The union of the six record families' own kit refusals (THE VERBATIM-CARRY LAW's record-side carrier). */
export type RecordFamilyKitRefusal =
        | OntologyKitRefusal
        | TemplatesKitRefusal
        | BodiesKitRefusal
        | PacksKitRefusal
        | ProfilesKitRefusal
        | BenchmarksKitRefusal;

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const ACTIVATION_ENVELOPE_RELATIVE_PATH = '.flauz/harness/activation-journeys.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const ACTIVATION_LEDGER_RELATIVE_PATH = '.flauz/harness/activation-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the serialization order). The onboardingSessionId column carries
 * the REAL DH-02 session link (minted at begin; constant per journey
 * across every line - a drift is a torn ledger); the harnessId column
 * carries the binding draft id (the compose-records line) then the
 * current harness id (the proposal and later lines); the validation
 * column carries the REAL DH-01 full-green validation outcome (the
 * propose line only - the proposal boundary's evidence, re-proven by
 * the replay).
 */
export const ACTIVATION_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'journeyId',
        'onboardingSessionId',
        'leg',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'harnessId',
        'validation',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const ACTIVATION_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'journeys'] as const;

/**
 * The compose-records line's payload: the caller-supplied record
 * content (the six families' entries - THE CONTENT LAW) plus the six
 * composed record links (the real kits' minted ids, the entry-as-it-
 * stood discipline: the replay re-proves the content walk and the
 * link forms from the ledger alone).
 */
export interface JourneyRecordsPayload {
        readonly content: JourneyRecordContent;
        readonly links: ComposedRecordLinks;
}

/** The frozen records-payload schema keys, in the canonical fixed-key-order. */
export const JOURNEY_RECORDS_PAYLOAD_SCHEMA_KEYS = ['content', 'links'] as const;

/**
 * One append-only activation ops ledger line (the canonical persisted
 * op): the seq (equal to the line number), the clock reading, the
 * contract version, the op name, the journey id, the REAL DH-02
 * onboarding session link, the walked leg (null ONLY on the begin
 * line; the propose line lands on the validation leg - the net
 * composed->proposed edge - carrying the full review composition,
 * the proposal leg's evidence, in its payload), the net stage edge,
 * the granting law, the canonical op payload, the harness link (the
 * binding draft id from compose-records onward; the current harness
 * id from the proposal onward), the REAL validation outcome (the
 * propose line only) and the deterministic detail sentence.
 */
export interface ActivationOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: ActivationOpName;
        readonly journeyId: string;
        readonly onboardingSessionId: string;
        readonly leg: JourneyLeg | null;
        readonly fromStage: ActivationJourneyStage | null;
        readonly toStage: ActivationJourneyStage;
        readonly law: string;
        readonly payload:
                | null
                | OnboardingIndustryPayload
                | OnboardingCompanyProfile
                | readonly HarnessWorkType[]
                | RoleCompositionSession
                | JourneyRecordsPayload
                | OnboardingReviewComposition
                | Readonly<Record<string, string>>;
        readonly harnessId: string | null;
        readonly validation: HarnessValidationOutcome | null;
        readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ACTIVATION_JOURNEY_REJECTION_REASONS):
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing activation ledger line, a
 *                          structurally invalid or out-of-order line,
 *                          an unknown op or contract version, an
 *                          illegal stage edge or a fail-closed law
 *                          violation inside the ledger (an approve
 *                          line without the propose line, an activate
 *                          line without the approve line, a propose
 *                          line without the compose-records line), or
 *                          a fresh kit attempting to append over an
 *                          existing non-empty activation ledger
 *                          (reopen with loadActivationKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the activation
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   ACTIVATION_IO        - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the activation family's own files;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted journey id);
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listJourneys received
 *                          an unknown filter field or a non-member
 *                          filter value.
 */
export const ACTIVATION_KIT_EXTRA_REFUSAL_REASONS = [
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'ACTIVATION_IO',
        'CORRUPT_SEAM',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 18 domain reasons plus the kit-layer extras. */
export const ACTIVATION_KIT_REFUSAL_REASONS = [
        ...ACTIVATION_JOURNEY_REJECTION_REASONS,
        ...ACTIVATION_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type ActivationKitRefusalReason = (typeof ACTIVATION_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isActivationKitRefusalReason(value: unknown): value is ActivationKitRefusalReason {
        return (ACTIVATION_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the LEG the refusal
 * names (THE VERBATIM-CARRY LAW - null on the begin surface and the
 * load surface), the violated law's name, the deterministic message,
 * the optional offending items, and - THE VERBATIM-CARRY LAW - the
 * owning real kit's own typed refusal, carried complete, never
 * paraphrased (onboardingRefusal for the REAL DH-02 kit;
 * rolesRefusal for the REAL DH-03 kit; recordRefusal for one of the
 * REAL DH-04..DH-09 record kits; harnessRefusal for the REAL DH-01
 * kit; contentRejection for the contract-level record-content walk,
 * itself carrying the owning family's complete typed rejection
 * table).
 */
export interface ActivationKitRefusal {
        readonly reason: ActivationKitRefusalReason;
        readonly leg: JourneyLeg | null;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
        /** THE VERBATIM-CARRY LAW: the REAL DH-02 onboarding kit's refusal (which itself carries the DH-01 refusal at its harness boundaries). */
        readonly onboardingRefusal?: OnboardingKitRefusal;
        /** THE VERBATIM-CARRY LAW: the REAL DH-03 roles kit's refusal. */
        readonly rolesRefusal?: RolesKitRefusal;
        /** THE VERBATIM-CARRY LAW: one of the REAL DH-04..DH-09 record kits' refusals. */
        readonly recordRefusal?: RecordFamilyKitRefusal;
        /** THE VERBATIM-CARRY LAW: the REAL DH-01 harness kit's refusal. */
        readonly harnessRefusal?: HarnessKitRefusal;
        /** THE VERBATIM-CARRY LAW (contract level): the record-content walk's typed rejection (the owning family's complete table). */
        readonly contentRejection?: JourneyContentRejection;
}

/**
 * The kit construction options (all injected, never env-read; THE
 * PERSISTENCE-FIRST LAW - the fsPort/root pair is REQUIRED: the
 * journey evidence mirror AND the lifecycle legs' reopening of the
 * real DH-01 authority are both persistence surfaces; a
 * non-persistent journey would be a second in-memory lifecycle
 * authority, exactly what THE NO-NEW-AUTHORITY LAW forbids).
 */
export interface ActivationKitOptions {
        /** The injected clock (returns the ISO string; forwarded to every real kit verbatim). */
        readonly clock: () => string;
        /** The id-minting seam (returns 16 lowercase hex chars; NEVER the random global; forwarded to every real kit). */
        readonly rng: () => string;
        /** The injected READ-ONLY catalog snapshot (forwarded to the real DH-01/DH-02 kits; tests inject fixtures). */
        readonly catalog: HarnessCatalogSnapshot;
        /** The filesystem seam (the ONLY filesystem seam; shared with every real kit the journey constructs). */
        readonly fsPort: HarnessFsPort;
        /** The persistence root (the .flauz/harness subtree lands under it - the journey's own mirror AND the real kits' ledgers). */
        readonly root: string;
}

/** The journey op outcome: ok carries the honest journey record; failure carries the typed refusal. */
export type JourneyOutcome =
        | { readonly ok: true; readonly journey: ActivationJourneyRecord }
        | { readonly ok: false; readonly refusal: ActivationKitRefusal };

/** The list outcome: ok carries the journeyId-ordered honest records; failure carries the typed refusal. */
export type JourneyListOutcome =
        | { readonly ok: true; readonly journeys: readonly ActivationJourneyRecord[] }
        | { readonly ok: false; readonly refusal: ActivationKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type ActivationLoadOutcome =
        | { readonly ok: true; readonly kit: ActivationKit }
        | { readonly ok: false; readonly refusal: ActivationKitRefusal };

/**
 * The deterministic end-to-end journey kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * every leg routes THROUGH the real kits (THE REAL-KIT LAW); a
 * refused leg leaves the journey record AND the real harness record
 * unchanged (THE FAIL-CLOSED LAW's record-unchanged half).
 */
export interface ActivationKit {
        beginJourney(): Promise<JourneyOutcome>;
        selectIndustry(journeyId: unknown, industry: unknown): Promise<JourneyOutcome>;
        composeCompany(journeyId: unknown, profile: unknown): Promise<JourneyOutcome>;
        selectWorkTypes(journeyId: unknown, workTypes: unknown): Promise<JourneyOutcome>;
        composeRoles(journeyId: unknown, roles: unknown): Promise<JourneyOutcome>;
        composeRecords(journeyId: unknown, content: unknown): Promise<JourneyOutcome>;
        proposeHarness(journeyId: unknown): Promise<JourneyOutcome>;
        approveHarness(journeyId: unknown, decision: unknown): Promise<JourneyOutcome>;
        activateHarness(journeyId: unknown, decision: unknown): Promise<JourneyOutcome>;
        inspectJourney(journeyId: unknown): Promise<JourneyOutcome>;
        listJourneys(filter?: unknown): Promise<JourneyListOutcome>;
        dispose(): void;
}

/**
 * Creates an activation journey kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02 factory
 * walk EXACTLY (the same preconditions, the same message shapes, the
 * createActivationKit prefix): the options shape (clock / rng /
 * catalog / fsPort / root - the persistence pair REQUIRED), the
 * clock's first read (a non-empty ISO string), the rng's first read
 * (exactly 16 lowercase hex chars - the id-minting law), the catalog
 * snapshot guard (the REAL predicate, imported by reference), the fs
 * port's four functions and the non-empty root. THE REAL-KIT LAW:
 * the real kits are constructed LAZILY (the onboarding kit at the
 * first beginJourney through the REAL createOnboardingKit - which
 * itself constructs the REAL DH-01 harness kit with the same seams;
 * the roles and record kits at their composition legs; the harness
 * authority at the proposal leg through the REAL loadHarnessKit).
 * The factory consumes exactly ONE clock read and ONE rng read. The
 * kit starts with ZERO journeys; persistence is LAZY; a fresh kit
 * never appends over an existing non-empty activation ledger -
 * reopen with loadActivationKit.
 */
export function createActivationKit(options: ActivationKitOptions): ActivationKit {
        const bound = validateKitOptions(options, 'createActivationKit');
        return buildKit(bound, { seq: 0, journeys: new Map<string, ActivationJourneyRecord>() }, false);
}

/**
 * Reopens a persisted activation journey kit: replays the append-only
 * activation ops ledger (the authoritative surface - each line
 * re-validated: the frozen fourteen-key line schema, the op's leg and
 * net stage edge through the contract's own tables and machine, the
 * payload walks through the REAL family validators, THE
 * FORWARD-ONLY LAW's frontier discipline, THE INCOMPLETE-COMPOSITION
 * LAW, THE APPROVAL-BEFORE-ACTIVATION LAW - re-proven from the
 * ledger alone), cross-checks the envelope byte-for-byte against the
 * replay-built state, and reopens the REAL DH-02 onboarding kit
 * through the REAL loadOnboardingKit (which itself reopens the REAL
 * DH-01 harness kit - a refused inner reopen is carried verbatim).
 * A torn or missing activation ledger line is the typed
 * E_LEDGER_TORN; a divergent, missing or malformed envelope is the
 * typed E_ENVELOPE_MISMATCH (never silently rebuilt); a refused fs
 * port is the typed ACTIVATION_IO. A fresh root (no files) reopens
 * as an empty kit.
 */
export async function loadActivationKit(options: ActivationKitOptions): Promise<ActivationLoadOutcome> {
        const bound = validateKitOptions(options, 'loadActivationKit');
        const fsPort = bound.fsPort;
        const ledgerPath = `${bound.root}/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `loadActivationKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `loadActivationKit: the fs port refused the activation ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `loadActivationKit: the fs port refused the activation envelope read: ${toMessage(error)}`) };
        }
        const replay = replayActivationLedger(ledgerText);
        if (typeof replay === 'string') {
                return { ok: false, refusal: refused('E_LEDGER_TORN', null, 'THE APPEND-ONLY LEDGER LAW', replay) };
        }
        const crossCheck = crossCheckEnvelope(envelopeText, replay.lines.length, replay.journeys);
        if (crossCheck !== null) {
                return { ok: false, refusal: refused(crossCheck.reason, null, 'THE APPEND-ONLY LEDGER LAW', crossCheck.message) };
        }
        // THE REAL-KIT LAW: reopen the REAL DH-02 onboarding kit through its
        // own load surface (which reopens the REAL DH-01 harness kit inside).
        const onboardingLoad = await loadOnboardingKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort, root: bound.root });
        if (!onboardingLoad.ok) {
                return {
                        ok: false,
                        refusal: refused(
                                'onboarding-refused',
                                null,
                                'THE VERBATIM-CARRY LAW',
                                'loadActivationKit: the REAL DH-02 onboarding kit refused to reopen over the persisted onboarding ledger (which reopens the REAL DH-01 harness kit inside) - the refusal is carried verbatim (the journey family never re-implements the onboarding or harness load)',
                                undefined,
                                { onboardingRefusal: onboardingLoad.refusal },
                        ),
                };
        }
        return {
                ok: true,
                kit: buildKit(bound, { seq: replay.lines.length, journeys: replay.journeys }, true, onboardingLoad.kit),
        };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly catalog: HarnessCatalogSnapshot;
        readonly fsPort: HarnessFsPort;
        readonly root: string;
}

interface KitState {
        readonly seq: number;
        readonly journeys: ReadonlyMap<string, ActivationJourneyRecord>;
}

/** The persist fold's result: applied means the activation ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: ActivationKitRefusal }
        | { readonly applied: true; readonly refusal: ActivationKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: ActivationKitRefusal };

function validateKitOptions(options: ActivationKitOptions, factoryName: 'createActivationKit' | 'loadActivationKit'): BoundOptions {
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
                        `${factoryName}: options.catalog must satisfy isHarnessCatalogSnapshot (the injected READ-ONLY resolution surface - the REAL predicate, imported by reference)`,
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
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${JOURNEY_ID_PREFIX}<16-hex>)`,
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
                throw new TypeError(`${factoryName}: options.root must be a non-empty string (the persistence root - THE PERSISTENCE-FIRST LAW: the pair is required, never optional)`);
        }
        return {
                clock,
                rng,
                catalog: opts.catalog as HarnessCatalogSnapshot,
                fsPort: port as unknown as HarnessFsPort,
                root: (opts.root as string).replace(/\/+$/, ''),
        };
}

function refused(
        reason: ActivationKitRefusalReason,
        leg: JourneyLeg | null,
        law: string,
        message: string,
        items?: readonly string[],
        extra?: Omit<ActivationKitRefusal, 'reason' | 'leg' | 'law' | 'message' | 'items'>,
): ActivationKitRefusal {
        if (items === undefined) {
                return { reason, leg, law, message, ...extra };
        }
        return { reason, leg, law, message, items, ...extra };
}

function buildKit(
        bound: BoundOptions,
        seed: KitState,
        reloaded: boolean,
        reopenedOnboarding?: OnboardingKit,
): ActivationKit {
        let disposed = false;
        let mutableSeq = seed.seq;
        const journeys = new Map<string, ActivationJourneyRecord>(seed.journeys);
        const fsPort = bound.fsPort;
        const ledgerPath = `${bound.root}/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`;
        let dirEnsured = reloaded;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createActivationKit guards the append).
        let ledgerGuardDone = seed.seq > 0;
        // THE REAL-KIT LAW: the real kits are held internally, constructed lazily
        // with the SAME injected seams (never re-implemented, never re-minted).
        let onboardingKit: OnboardingKit | null = reopenedOnboarding ?? null;
        let rolesKit: RolesKit | null = null;
        let ontologyKit: OntologyKit | null = null;
        let templatesKit: TemplatesKit | null = null;
        let bodiesKit: BodiesKit | null = null;
        let packsKit: PacksKit | null = null;
        let profilesKit: ProfilesKit | null = null;
        let benchmarksKit: BenchmarksKit | null = null;
        // THE EVIDENCE-NOT-AUTHORITY LAW: the real DH-01 harness authority is
        // NEVER held as a cached lifecycle handle - every lifecycle boundary
        // REOPENS the authority from its own append-only ledger (see
        // ensureHarnessKit) so the authority's own state is the truth at every
        // boundary (a cached handle would freeze the state and become a second
        // in-memory lifecycle authority).

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

        function copyJourney(record: ActivationJourneyRecord): ActivationJourneyRecord {
                return JSON.parse(serializeActivationJourney(record)) as ActivationJourneyRecord;
        }

        function journeyOutcome(record: ActivationJourneyRecord): JourneyOutcome {
                return { ok: true, journey: copyJourney(record) };
        }

        function envelopeBytes(nextSeq: number, nextJourneys: ReadonlyMap<string, ActivationJourneyRecord>): string {
                const ids = [...nextJourneys.keys()].sort();
                const records = ids.map((id) => nextJourneys.get(id) as ActivationJourneyRecord);
                return `{"contractVersion":${JSON.stringify(ACTIVATION_CONTRACTS_VERSION)},"seq":${nextSeq},"journeys":[${records
                        .map((record) => serializeActivationJourney(record))
                        .join(',')}]}`;
        }

        function ledgerLineBytes(line: ActivationOpsLedgerLine): string {
                return JSON.stringify({
                        seq: line.seq,
                        at: line.at,
                        contractVersion: line.contractVersion,
                        op: line.op,
                        journeyId: line.journeyId,
                        onboardingSessionId: line.onboardingSessionId,
                        leg: line.leg,
                        fromStage: line.fromStage,
                        toStage: line.toStage,
                        law: line.law,
                        payload: line.payload === null ? null : payloadObject(line.payload),
                        harnessId: line.harnessId,
                        validation: line.validation === null ? null : validationObject(line.validation),
                        detail: line.detail,
                });
        }

        /**
         * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
         * first (the ledger is authoritative - the seq advances with the
         * line), the envelope rewrite lands second, the in-memory journeys
         * commit last (in the caller). An append refusal leaves NOTHING
         * applied; an envelope refusal leaves the op applied and the line
         * landed (the refusal discloses it; a reload fails closed with
         * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
         */
        async function persist(line: ActivationOpsLedgerLine, nextJourneys: ReadonlyMap<string, ActivationJourneyRecord>): Promise<PersistResult> {
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)} (nothing was applied)`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `persist: the fs port refused the activation ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextJourneys));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'ACTIVATION_IO',
                                        null,
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextJourneys: ReadonlyMap<string, ActivationJourneyRecord>): void {
                journeys.clear();
                for (const [id, record] of nextJourneys) {
                        journeys.set(id, record);
                }
        }

        function refuseIfDisposed(op: string): ActivationKitRefusal | null {
                if (disposed) {
                        return refused('disposed', null, 'THE DISPOSE LAW', `${op}: the journey kit was disposed - every operation after dispose rejects`);
                }
                return null;
        }

        function lookupJourney(op: string, journeyId: unknown): { journey: ActivationJourneyRecord } | { refusal: ActivationKitRefusal } {
                if (!isJourneyId(journeyId)) {
                        return { refusal: refused('unknown-journey', null, 'THE FAIL-CLOSED LAW', `${op}: no journey with id '${showValue(journeyId)}' (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline)`) };
                }
                const journey = journeys.get(journeyId);
                if (journey === undefined) {
                        return { refusal: refused('unknown-journey', null, 'THE FAIL-CLOSED LAW', `${op}: no journey with id '${journeyId}'`) };
                }
                return { journey };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the op's walk FRONTIER is the
         * last leg of its required-legs row (the contract's frozen table,
         * imported by reference); the journey's walked frontier is the last
         * history note's leg (null ONLY on the begin note). A frontier
         * behind the expectation is the typed premature-leg refusal; a
         * frontier past it is the typed stale-leg refusal (the journey
         * record never walks back; 'active' is terminal).
         */
        function stageGuard(op: ActivationOpName, journey: ActivationJourneyRecord): ActivationKitRefusal | null {
                const required = JOURNEY_OP_REQUIRED_LEGS[op];
                const expectedLeg = required.length === 0 ? null : required[required.length - 1];
                const expectedIndex = expectedLeg === null ? -1 : journeyLegIndex(expectedLeg);
                const frontier = journey.history.length === 0 ? null : journey.history[journey.history.length - 1].leg;
                const frontierIndex = frontier === null ? -1 : journeyLegIndex(frontier);
                if (frontierIndex < expectedIndex) {
                        return refused(
                                'premature-leg',
                                expectedLeg === null ? null : expectedLeg,
                                'THE FORWARD-ONLY LAW',
                                `${op}: the op precedes its walked prerequisites within the frozen leg order - the walk frontier is '${showValue(frontier)}' but '${op}' requires the '${showValue(expectedLeg)}' leg walked first (an incomplete walk never proposes, never activates)`,
                        );
                }
                if (frontierIndex > expectedIndex) {
                        return refused(
                                'stale-leg',
                                expectedLeg === null ? null : expectedLeg,
                                'THE FORWARD-ONLY LAW',
                                `${op}: the op is behind the walk - the walk frontier is '${showValue(frontier)}' but '${op}' runs at the '${showValue(expectedLeg)}' frontier (the journey record never walks back; 'active' is terminal; a changed journey is a NEW journey id)`,
                        );
                }
                return null;
        }

        /** THE FAIL-CLOSED LAW at the authority seam: the catalog re-check through the REAL predicate (imported by reference). */
        function catalogGuard(leg: JourneyLeg): ActivationKitRefusal | null {
                if (!isHarnessCatalogSnapshot(bound.catalog)) {
                        return refused(
                                'malformed-catalog',
                                leg,
                                'THE FAIL-CLOSED LAW',
                                'the injected catalog snapshot no longer satisfies the REAL isHarnessCatalogSnapshot predicate - a malformed authority resolves nothing (fail closed; the journey never asks a malformed authority anything)',
                        );
                }
                return null;
        }

        /**
         * THE EVIDENCE-NOT-AUTHORITY LAW's authority handle: REOPENED from
         * the authority's OWN persisted ledger AT EVERY lifecycle boundary
         * (never cached - a cached handle would freeze the authority's state
         * inside the journey and become a second in-memory lifecycle
         * authority, exactly what THE NO-NEW-AUTHORITY LAW forbids; a fresh
         * reopen re-reads the authority's own truth at every boundary).
         */
        async function ensureHarnessKit(): Promise<{ kit: HarnessKit } | { refusal: ActivationKitRefusal }> {
                const loaded = await loadHarnessKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort, root: bound.root });
                if (!loaded.ok) {
                        return {
                                refusal: refused(
                                        'harness-refused',
                                        null,
                                        'THE VERBATIM-CARRY LAW',
                                        'the REAL DH-001 harness kit refused to reopen over its own persisted ledger - the refusal is carried verbatim (the journey family never re-implements the harness load; the real kit stays the ONLY lifecycle authority)',
                                        undefined,
                                        { harnessRefusal: loaded.refusal },
                                ),
                        };
                }
                return { kit: loaded.kit };
        }

        /** THE REAL-KIT LAW: the onboarding kit is created once per kit instance through the REAL factory (fresh kits) or held from the REAL reopen (reloaded kits). */
        async function ensureOnboardingKit(): Promise<OnboardingKit> {
                if (onboardingKit !== null) {
                        return onboardingKit;
                }
                onboardingKit = createOnboardingKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort, root: bound.root });
                return onboardingKit;
        }

        /** THE REAL-KIT LAW: the roles kit, lazily created (fresh) or reopened (reloaded) through the REAL factory / load surfaces. */
        async function ensureRolesKit(): Promise<RolesKit | null> {
                if (rolesKit !== null) {
                        return rolesKit;
                }
                if (reloaded) {
                        const loaded = await loadRolesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        rolesKit = loaded.kit;
                } else {
                        rolesKit = createRolesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return rolesKit;
        }

        async function ensureOntologyKit(): Promise<OntologyKit | null> {
                if (ontologyKit !== null) {
                        return ontologyKit;
                }
                if (reloaded) {
                        const loaded = await loadOntologyKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        ontologyKit = loaded.kit;
                } else {
                        ontologyKit = createOntologyKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return ontologyKit;
        }

        async function ensureTemplatesKit(): Promise<TemplatesKit | null> {
                if (templatesKit !== null) {
                        return templatesKit;
                }
                if (reloaded) {
                        const loaded = await loadTemplatesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        templatesKit = loaded.kit;
                } else {
                        templatesKit = createTemplatesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return templatesKit;
        }

        async function ensureBodiesKit(): Promise<BodiesKit | null> {
                if (bodiesKit !== null) {
                        return bodiesKit;
                }
                if (reloaded) {
                        const loaded = await loadBodiesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        bodiesKit = loaded.kit;
                } else {
                        bodiesKit = createBodiesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return bodiesKit;
        }

        async function ensurePacksKit(): Promise<PacksKit | null> {
                if (packsKit !== null) {
                        return packsKit;
                }
                if (reloaded) {
                        const loaded = await loadPacksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        packsKit = loaded.kit;
                } else {
                        packsKit = createPacksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return packsKit;
        }

        async function ensureProfilesKit(): Promise<ProfilesKit | null> {
                if (profilesKit !== null) {
                        return profilesKit;
                }
                if (reloaded) {
                        const loaded = await loadProfilesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        profilesKit = loaded.kit;
                } else {
                        profilesKit = createProfilesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return profilesKit;
        }

        async function ensureBenchmarksKit(): Promise<BenchmarksKit | null> {
                if (benchmarksKit !== null) {
                        return benchmarksKit;
                }
                if (reloaded) {
                        const loaded = await loadBenchmarksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return null;
                        }
                        benchmarksKit = loaded.kit;
                } else {
                        benchmarksKit = createBenchmarksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
                }
                return benchmarksKit;
        }

        /** The journey's onboarding session id (the REAL DH-02 session link, recorded at begin). */
        function onboardingSessionIdOf(journey: ActivationJourneyRecord): string {
                const sessionId = journey.onboardingSessionId;
                if (sessionId === null) {
                        // Unreachable through the stage machine (the begin mints the link); the
                        // defensive fail-closed branch mirrors the onboarding kit's own invariant.
                        throw new TypeError('onboardingSessionIdOf: the journey record is internally inconsistent (the begin note minted the onboarding session link)');
                }
                return sessionId;
        }

        return {
                async beginJourney(): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginJourney');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        // THE APPEND-ONLY LEDGER LAW's fresh-kit guard: a fresh kit never
                        // appends over an existing non-empty activation ledger - reopen with
                        // loadActivationKit. The guard fires HERE (the first persisted op of
                        // any journey) so the journey's own guard precedes the real kits'.
                        if (!ledgerGuardDone) {
                                let existing: string | null;
                                try {
                                        existing = await readText(fsPort, ledgerPath);
                                } catch (error) {
                                        return { ok: false, refusal: refused('ACTIVATION_IO', null, 'THE FAIL-CLOSED LAW', `beginJourney: the fs port refused the activation ledger read: ${toMessage(error)}`) };
                                }
                                if (existing !== null && existing.trim().length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        'E_LEDGER_TORN',
                                                        null,
                                                        'THE APPEND-ONLY LEDGER LAW',
                                                        'beginJourney: the activation ledger already carries lines - reopen with loadActivationKit (a fresh kit never appends over an existing ledger)',
                                                ),
                                        };
                                }
                                ledgerGuardDone = true;
                        }
                        // THE FAIL-CLOSED LAW at the authority seam: never construct a real
                        // kit over a malformed catalog (the REAL predicate, imported by reference).
                        const catalogRefusal = catalogGuard(null as unknown as JourneyLeg);
                        if (catalogRefusal !== null) {
                                return { ok: false, refusal: { ...catalogRefusal, message: `beginJourney: ${catalogRefusal.message}` } };
                        }
                        // The journey id mints from the injected rng (never caller-supplied).
                        const hex = bound.rng();
                        if (!/^[0-9a-f]{16}$/.test(hex)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', null, 'THE DETERMINISM LAW', 'beginJourney: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
                        }
                        const journeyId = `${JOURNEY_ID_PREFIX}${hex}`;
                        if (journeys.has(journeyId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', null, 'THE DETERMINISM LAW', 'beginJourney: the injected rng minted a duplicate journey id (the id-minting seam is corrupt)') };
                        }
                        // THE REAL-KIT LAW: the REAL DH-02 onboarding kit (which constructs
                        // the REAL DH-01 harness kit with the same seams).
                        const onboarding = await ensureOnboardingKit();
                        const begun = await onboarding.beginSession();
                        if (!begun.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                null,
                                                'THE VERBATIM-CARRY LAW',
                                                'beginJourney: the REAL DH-02 onboarding kit refused to begin the session - the refusal is carried verbatim (the journey family never re-implements the onboarding begin)',
                                                undefined,
                                                { onboardingRefusal: begun.refusal },
                                        ),
                                };
                        }
                        const onboardingSessionId = begun.session.sessionId;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `began the activation journey (the onboarding session ${onboardingSessionId} begun through the REAL DH-02 kit; the walk enters the selection stage)`;
                        const record: ActivationJourneyRecord = {
                                journeyId,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                stage: 'selection',
                                industry: null,
                                companyProfile: null,
                                workTypes: null,
                                rolesSession: null,
                                recordLinks: null,
                                bindingHarnessId: null,
                                harnessId: null,
                                validation: null,
                                approval: null,
                                activation: null,
                                onboardingSessionId,
                                createdAtIso: at,
                                revision: 1,
                                history: [{ at, leg: null, fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'begin-journey',
                                journeyId,
                                onboardingSessionId,
                                leg: null,
                                fromStage: null,
                                toStage: 'selection',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: null,
                                harnessId: null,
                                validation: null,
                                detail,
                        };
                        const nextJourneys = new Map(journeys);
                        nextJourneys.set(journeyId, record);
                        const persistResult = await persist(line, nextJourneys);
                        if (!persistResult.applied) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        commit(nextJourneys);
                        if (persistResult.refusal !== null) {
                                return { ok: false, refusal: persistResult.refusal };
                        }
                        return journeyOutcome(record);
                },

                async selectIndustry(journeyId: unknown, industry: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('selectIndustry');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('selectIndustry', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('select-industry', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const onboarding = await ensureOnboardingKit();
                        // THE REAL-KIT LAW: the REAL DH-02 walk validates the industry
                        // payload and advances the session; the refusal rides verbatim.
                        const outcome = await onboarding.selectIndustry(onboardingSessionIdOf(journey), industry);
                        if (!outcome.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'industry-selection',
                                                'THE VERBATIM-CARRY LAW',
                                                'selectIndustry: the REAL DH-02 onboarding kit refused the industry selection - the refusal is carried verbatim (the frozen HARNESS_INDUSTRIES list, imported by reference, is the only admissibility); the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: outcome.refusal },
                                        ),
                                };
                        }
                        const session = outcome.session;
                        if (session.industry === null) {
                                // Unreachable through the real kit's own stage machine (a green
                                // selectIndustry always sets the industry); the defensive fail-closed
                                // branch mirrors the onboarding kit's own invariant.
                                return { ok: false, refusal: refused('malformed-record', 'industry-selection', 'THE FAIL-CLOSED LAW', 'selectIndustry: the REAL DH-02 session answered green without the industry set (internally inconsistent - the journey fails closed)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `selected the '${session.industry}' industry through the REAL DH-02 onboarding kit (the frozen DH-01 list, imported by reference)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'selection',
                                industry: session.industry,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'industry-selection', fromStage: 'selection', toStage: 'selection', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'select-industry',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'industry-selection',
                                fromStage: 'selection',
                                toStage: 'selection',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: { industry: session.industry },
                                harnessId: null,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async composeCompany(journeyId: unknown, profile: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('composeCompany');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('composeCompany', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('compose-company', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const onboarding = await ensureOnboardingKit();
                        const outcome = await onboarding.composeCompany(onboardingSessionIdOf(journey), profile);
                        if (!outcome.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'company-composition',
                                                'THE VERBATIM-CARRY LAW',
                                                'composeCompany: the REAL DH-02 onboarding kit refused the company-profile composition - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: outcome.refusal },
                                        ),
                                };
                        }
                        const session = outcome.session;
                        const companyProfile = session.companyProfile as OnboardingCompanyProfile;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `composed the company profile through the REAL DH-02 onboarding kit (displayName carried verbatim; size band '${companyProfile.sizeBand}')`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'selection',
                                companyProfile,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'company-composition', fromStage: 'selection', toStage: 'selection', op: 'compose-company', law: 'THE FORWARD-ONLY LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'compose-company',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'company-composition',
                                fromStage: 'selection',
                                toStage: 'selection',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: { displayName: companyProfile.displayName, sizeBand: companyProfile.sizeBand },
                                harnessId: null,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async selectWorkTypes(journeyId: unknown, workTypes: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('selectWorkTypes');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('selectWorkTypes', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('select-work-types', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const onboarding = await ensureOnboardingKit();
                        const outcome = await onboarding.selectWorkTypes(onboardingSessionIdOf(journey), workTypes);
                        if (!outcome.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'work-type-selection',
                                                'THE VERBATIM-CARRY LAW',
                                                'selectWorkTypes: the REAL DH-02 onboarding kit refused the work-type selection - the refusal is carried verbatim (the frozen DH-01 subset laws: non-empty, members only, duplicate-free, the frozen list order); the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: outcome.refusal },
                                        ),
                                };
                        }
                        const session = outcome.session;
                        const selected = session.workTypes as readonly HarnessWorkType[];
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `selected the work-type subset through the REAL DH-02 onboarding kit (${selected.length} of the frozen 10, the list order preserved)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'selection',
                                workTypes: [...selected],
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'work-type-selection', fromStage: 'selection', toStage: 'selection', op: 'select-work-types', law: 'THE FORWARD-ONLY LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'select-work-types',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'work-type-selection',
                                fromStage: 'selection',
                                toStage: 'selection',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: [...selected],
                                harnessId: null,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async composeRoles(journeyId: unknown, roles: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('composeRoles');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('composeRoles', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('compose-roles', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const industry = journey.industry;
                        if (industry === null) {
                                return { ok: false, refusal: refused('malformed-record', 'role-composition', 'THE FAIL-CLOSED LAW', 'composeRoles: the journey record is internally inconsistent (the industry-selection leg walked but the industry is absent - unreachable through the stage machine; the ledger replay is the cross-check)') };
                        }
                        // THE MULTI-ROLE LAW: the caller supplies the roles (never invented
                        // here); the carrier discipline mirrors the DH-03's own (an array).
                        if (!Array.isArray(roles)) {
                                return { ok: false, refusal: refused('malformed-record', 'role-composition', 'THE FAIL-CLOSED LAW', `composeRoles: the roles payload must be an array of the REAL DH-03 role entries ({ roleKey, summary } - one user, MULTIPLE roles; the caller supplies them, this family never invents them)`, [showValue(roles)]) };
                        }
                        // THE REAL-KIT LAW: the REAL DH-03 roles kit (its floors, its
                        // MAX_ROLES (32) bound, its entry walk - never re-implemented here).
                        const rolesKitInstance = await ensureRolesKit();
                        if (rolesKitInstance === null) {
                                return { ok: false, refusal: rolesReopenRefused() };
                        }
                        const begun = await rolesKitInstance.beginSession(industry);
                        if (!begun.ok) {
                                return { ok: false, refusal: rolesRefused(begun.refusal, 'composeRoles: the REAL DH-03 roles kit refused to begin the role-composition session - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const sessionId = begun.session.sessionId;
                        for (let i = 0; i < roles.length; i += 1) {
                                const added = await rolesKitInstance.addRole(sessionId, roles[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: rolesRefused(added.refusal, `composeRoles: the REAL DH-03 roles kit refused the role entry ${i} - the refusal is carried verbatim (the floors, the entry walk, the MAX_ROLES (32) composition bound are the real kit's own laws); the journey record is unchanged`) };
                                }
                        }
                        const finalized = await rolesKitInstance.finalizeComposition(sessionId);
                        if (!finalized.ok) {
                                return { ok: false, refusal: rolesRefused(finalized.refusal, 'composeRoles: the REAL DH-03 roles kit refused to finalize the composition (the empty floor / the composed-stage law) - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const session = finalized.session;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `composed ${session.roles.length} role(s) through the REAL DH-03 roles kit (THE MULTI-ROLE LAW: one user, multiple roles/specializations; the session ${sessionId} is the journey's composed-roles evidence)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'composed',
                                rolesSession: session,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'role-composition', fromStage: 'selection', toStage: 'composed', op: 'compose-roles', law: 'THE MULTI-ROLE LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'compose-roles',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'role-composition',
                                fromStage: 'selection',
                                toStage: 'composed',
                                law: 'THE MULTI-ROLE LAW',
                                payload: session,
                                harnessId: null,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async composeRecords(journeyId: unknown, content: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('composeRecords');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('composeRecords', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('compose-records', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const rolesSession = journey.rolesSession;
                        if (rolesSession === null) {
                                return { ok: false, refusal: refused('incomplete-composition', 'record-composition', 'THE INCOMPLETE-COMPOSITION LAW', 'composeRecords: the record composition requires the composed roles session (the role-composition leg walked first - the stage machine precedes; this is the defensive re-proof)') };
                        }
                        const industry = journey.industry;
                        if (industry === null) {
                                return { ok: false, refusal: refused('malformed-record', 'record-composition', 'THE FAIL-CLOSED LAW', 'composeRecords: the journey record is internally inconsistent (the industry-selection leg walked but the industry is absent - unreachable through the stage machine)') };
                        }
                        // THE CONTENT LAW + THE IMPORT LAW: the caller-supplied content,
                        // walked by the OWNING families' REAL validators (the contract walk).
                        const walked = validateJourneyRecordContent(content);
                        if (!walked.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'record-refused',
                                                'record-composition',
                                                walked.rejection.law,
                                                `composeRecords: the record content fails the contract walk (each family's entries walked by the OWNING family's REAL validator, imported by reference) - ${walked.rejection.message}; the journey record is unchanged`,
                                                walked.rejection.items,
                                                { contentRejection: walked.rejection },
                                        ),
                                };
                        }
                        const validated = walked.value;
                        // THE LINEAGE LAW: the binding draft mints through the REAL DH-02
                        // composeDraft (the provisional composition - the composed roles with
                        // empty ref families; THE TWO-PHASE LAW: the refs compose gradually).
                        const onboarding = await ensureOnboardingKit();
                        const provisional: OnboardingReviewComposition = {
                                roles: rolesSession.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                                capabilityRefs: [],
                                workflowRefs: [],
                                policyRefs: [],
                                evidenceRefs: [],
                        };
                        const draft = await onboarding.composeDraft(onboardingSessionIdOf(journey), provisional);
                        if (!draft.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'record-composition',
                                                'THE VERBATIM-CARRY LAW',
                                                'composeRecords: the REAL DH-02 onboarding kit refused the binding-draft mint (the provisional composition - the composed roles with empty ref families) - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: draft.refusal },
                                        ),
                                };
                        }
                        const bindingHarnessId = draft.session.harnessId as string;
                        // THE REAL-KIT LAW: the six record kits in the frozen family order,
                        // each bound to the binding draft (the FORM law; the EXISTENCE
                        // binding is this journey's wiring, pinned in the battery).
                        const ontologyKitInstance = await ensureOntologyKit();
                        if (ontologyKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('ontology') };
                        }
                        const begunOntology = await ontologyKitInstance.beginOntology(bindingHarnessId, industry);
                        if (!begunOntology.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunOntology.refusal, 'composeRecords: the REAL DH-04 ontology kit refused to begin the ontology record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const ontologyId = begunOntology.record.ontologyId;
                        for (let i = 0; i < validated.terms.length; i += 1) {
                                const added = await ontologyKitInstance.addTerm(ontologyId, validated.terms[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-04 ontology kit refused the term entry ${i} - the refusal is carried verbatim; the journey record is unchanged`) };
                                }
                        }
                        const finalizedOntology = await ontologyKitInstance.finalizeOntology(ontologyId);
                        if (!finalizedOntology.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedOntology.refusal, 'composeRecords: the REAL DH-04 ontology kit refused to finalize the ontology (the empty-terms floor) - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const ontologyRecord = finalizedOntology.record;

                        const templatesKitInstance = await ensureTemplatesKit();
                        if (templatesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('templates') };
                        }
                        const begunTemplate = await templatesKitInstance.beginTemplate(bindingHarnessId, industry);
                        if (!begunTemplate.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunTemplate.refusal, 'composeRecords: the REAL DH-05 templates kit refused to begin the template record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const templateId = begunTemplate.record.templateId;
                        for (let i = 0; i < validated.tasks.length; i += 1) {
                                const added = await templatesKitInstance.addTask(templateId, validated.tasks[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-05 templates kit refused the task entry ${i} - the refusal is carried verbatim; the journey record is unchanged`) };
                                }
                        }
                        // THE TERM-RESOLUTION LAW through the real kit: the caller-supplied
                        // composed ontology record (as it stood) resolves the termRefs.
                        const finalizedTemplate = await templatesKitInstance.finalizeTemplate(templateId, ontologyRecord);
                        if (!finalizedTemplate.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedTemplate.refusal, 'composeRecords: the REAL DH-05 templates kit refused to finalize the template (THE TERM-RESOLUTION LAW: every termRef must resolve against the composed ontology record) - the refusal is carried verbatim; the journey record is unchanged') };
                        }

                        const bodiesKitInstance = await ensureBodiesKit();
                        if (bodiesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('bodies') };
                        }
                        const begunBodies = await bodiesKitInstance.beginDefaults(bindingHarnessId, industry);
                        if (!begunBodies.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunBodies.refusal, 'composeRecords: the REAL DH-06 bodies kit refused to begin the organization-defaults record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const bodyId = begunBodies.record.bodyId;
                        for (let i = 0; i < validated.bodies.length; i += 1) {
                                const added = await bodiesKitInstance.addBody(bodyId, validated.bodies[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-06 bodies kit refused the body entry ${i} - the refusal is carried verbatim; the journey record is unchanged`) };
                                }
                        }
                        // THE ROLE-RESOLUTION LAW through the real kit: the journey's
                        // composed DH-03 session record (as it stood) resolves the roleRefs.
                        const finalizedBodies = await bodiesKitInstance.finalizeDefaults(bodyId, rolesSession);
                        if (!finalizedBodies.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedBodies.refusal, 'composeRecords: the REAL DH-06 bodies kit refused to finalize the organization defaults (THE ROLE-RESOLUTION LAW: every roleRef must resolve against the composed roles session) - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const bodiesRecord = finalizedBodies.record;

                        const packsKitInstance = await ensurePacksKit();
                        if (packsKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('packs') };
                        }
                        const begunPacks = await packsKitInstance.beginPacks(bindingHarnessId, industry);
                        if (!begunPacks.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunPacks.refusal, 'composeRecords: the REAL DH-07 packs kit refused to begin the capability-packs record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const packsId = begunPacks.record.id;
                        for (let i = 0; i < validated.packs.length; i += 1) {
                                const added = await packsKitInstance.addPack(packsId, validated.packs[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-07 packs kit refused the pack entry ${i} - the refusal is carried verbatim; the journey record is unchanged`) };
                                }
                        }
                        // THE BODY-RESOLUTION LAW through the real kit: the composed bodies
                        // record (as it stood) resolves the bodyRefs.
                        const finalizedPacks = await packsKitInstance.finalizePacks(packsId, bodiesRecord);
                        if (!finalizedPacks.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedPacks.refusal, 'composeRecords: the REAL DH-07 packs kit refused to finalize the capability packs (THE BODY-RESOLUTION LAW: every bodyRef must resolve against the composed organization defaults) - the refusal is carried verbatim; the journey record is unchanged') };
                        }

                        const profilesKitInstance = await ensureProfilesKit();
                        if (profilesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('profiles') };
                        }
                        const begunProfiles = await profilesKitInstance.beginProfiles(bindingHarnessId);
                        if (!begunProfiles.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunProfiles.refusal, 'composeRecords: the REAL DH-08 profiles kit refused to begin the model-policy profiles record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const profilesId = begunProfiles.record.profilesId;
                        for (let i = 0; i < validated.profiles.length; i += 1) {
                                const added = await profilesKitInstance.addProfile(profilesId, validated.profiles[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-08 profiles kit refused the profile entry ${i} - the refusal is carried verbatim (the authority-binding law: the permission / tier / evidence-floor / KPI vocabularies are the REAL imported ones); the journey record is unchanged`) };
                                }
                        }
                        const finalizedProfiles = await profilesKitInstance.finalizeProfiles(profilesId);
                        if (!finalizedProfiles.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedProfiles.refusal, 'composeRecords: the REAL DH-08 profiles kit refused to finalize the profiles (the empty-profiles floor) - the refusal is carried verbatim; the journey record is unchanged') };
                        }

                        const benchmarksKitInstance = await ensureBenchmarksKit();
                        if (benchmarksKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('benchmarks') };
                        }
                        const begunBenchmarks = await benchmarksKitInstance.beginBenchmarks(bindingHarnessId, industry);
                        if (!begunBenchmarks.ok) {
                                return { ok: false, refusal: recordRefusedOf(begunBenchmarks.refusal, 'composeRecords: the REAL DH-09 benchmarks kit refused to begin the benchmarks record - the refusal is carried verbatim; the journey record is unchanged') };
                        }
                        const benchmarksId = begunBenchmarks.record.id;
                        for (let i = 0; i < validated.benchmarks.length; i += 1) {
                                const added = await benchmarksKitInstance.addBenchmark(benchmarksId, validated.benchmarks[i]);
                                if (!added.ok) {
                                        return { ok: false, refusal: recordRefusedOf(added.refusal, `composeRecords: the REAL DH-09 benchmarks kit refused the benchmark entry ${i} - the refusal is carried verbatim (THE SCENARIO-BINDING LAW: the scenario refs bind the REAL imported LAB registry); the journey record is unchanged`) };
                                }
                        }
                        const finalizedBenchmarks = await benchmarksKitInstance.finalizeBenchmarks(benchmarksId);
                        if (!finalizedBenchmarks.ok) {
                                return { ok: false, refusal: recordRefusedOf(finalizedBenchmarks.refusal, 'composeRecords: the REAL DH-09 benchmarks kit refused to finalize the benchmarks (the empty-benchmarks floor) - the refusal is carried verbatim; the journey record is unchanged') };
                        }

                        const links: ComposedRecordLinks = {
                                ontologyId,
                                templateId,
                                bodyId,
                                packsId,
                                profilesId,
                                benchmarksId,
                        };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `composed the six staged records through the REAL DH-04..DH-09 kits, bound to the binding draft ${bindingHarnessId} minted through the REAL DH-02 composeDraft (THE LINEAGE LAW: the records' harness binding; a re-composition mints a NEW binding draft)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'composed',
                                recordLinks: links,
                                bindingHarnessId,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'record-composition', fromStage: 'composed', toStage: 'composed', op: 'compose-records', law: 'THE LINEAGE LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'compose-records',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'record-composition',
                                fromStage: 'composed',
                                toStage: 'composed',
                                law: 'THE LINEAGE LAW',
                                payload: { content: validated, links },
                                harnessId: bindingHarnessId,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async proposeHarness(journeyId: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('proposeHarness');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('proposeHarness', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('propose-harness', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE INCOMPLETE-COMPOSITION LAW (the row's core): the proposal
                        // boundary requires EVERY composition leg walked - the composed
                        // roles, the six record families, the binding draft.
                        const rolesSession = journey.rolesSession;
                        const links = journey.recordLinks;
                        if (rolesSession === null || links === null || journey.bindingHarnessId === null || rolesSession.roles.length === 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'incomplete-composition',
                                                'record-composition',
                                                'THE INCOMPLETE-COMPOSITION LAW',
                                                'proposeHarness: the proposal boundary requires EVERY composition leg walked - the composed roles session, the six record families and the binding draft (an incomplete composition never proposes, never activates; the defensive re-proof behind the stage machine)',
                                                ['rolesSession', 'recordLinks', 'bindingHarnessId'],
                                        ),
                                };
                        }
                        // THE FAIL-CLOSED LAW at the authority seam: a malformed catalog
                        // resolves nothing (the journey never asks a malformed authority).
                        const catalogRefusal = catalogGuard('validation');
                        if (catalogRefusal !== null) {
                                return { ok: false, refusal: catalogRefusal };
                        }
                        // The real kits (the reloaded kit reopens them lazily through their
                        // own load surfaces; a refused reopen is carried verbatim).
                        const templatesKitInstance = await ensureTemplatesKit();
                        if (templatesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('templates') };
                        }
                        const bodiesKitInstance = await ensureBodiesKit();
                        if (bodiesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('bodies') };
                        }
                        const packsKitInstance = await ensurePacksKit();
                        if (packsKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('packs') };
                        }
                        const profilesKitInstance = await ensureProfilesKit();
                        if (profilesKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('profiles') };
                        }
                        const benchmarksKitInstance = await ensureBenchmarksKit();
                        if (benchmarksKitInstance === null) {
                                return { ok: false, refusal: recordReopenRefused('benchmarks') };
                        }
                        // THE EMITS (the real kits' read ops): the composed records' emitted
                        // refs - re-proving the composed stages at the boundary (a
                        // non-composed record's emit refuses premature-op, the incomplete-
                        // composition re-proof through the REAL surface).
                        const workflowOutcome = await templatesKitInstance.emitWorkflowRef(links.templateId);
                        if (!workflowOutcome.ok) {
                                return { ok: false, refusal: emitRefused(workflowOutcome.refusal, 'the workflowRef', links.templateId) };
                        }
                        const organizationOutcome = await bodiesKitInstance.emitOrganizationRef(links.bodyId);
                        if (!organizationOutcome.ok) {
                                return { ok: false, refusal: emitRefused(organizationOutcome.refusal, 'the organizationRef', links.bodyId) };
                        }
                        const capabilityOutcome = await packsKitInstance.emitCapabilityRef(links.packsId);
                        if (!capabilityOutcome.ok) {
                                return { ok: false, refusal: emitRefused(capabilityOutcome.refusal, 'the capabilityRef', links.packsId) };
                        }
                        const policyOutcome = await profilesKitInstance.emitPolicyRef(links.profilesId);
                        if (!policyOutcome.ok) {
                                return { ok: false, refusal: emitRefused(policyOutcome.refusal, 'the policyRef', links.profilesId) };
                        }
                        const profilesEvidenceOutcome = await profilesKitInstance.emitEvidenceRef(links.profilesId);
                        if (!profilesEvidenceOutcome.ok) {
                                return { ok: false, refusal: emitRefused(profilesEvidenceOutcome.refusal, 'the profiles evidenceRef', links.profilesId) };
                        }
                        const benchmarksEvidenceOutcome = await benchmarksKitInstance.emitEvidenceRef(links.benchmarksId);
                        if (!benchmarksEvidenceOutcome.ok) {
                                return { ok: false, refusal: emitRefused(benchmarksEvidenceOutcome.refusal, 'the benchmarks evidenceRef', links.benchmarksId) };
                        }
                        // THE REVIEW COMPOSITION: the journey assembles the composed roles
                        // and the emitted refs (the DH-06 precedent: the organizationRef
                        // rides the capabilityRefs family - the landed DH-02 schema's
                        // capability-side slot; widening DH-02 is a later wave's decision).
                        const composition: OnboardingReviewComposition = {
                                roles: rolesSession.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                                capabilityRefs: [capabilityOutcome.capabilityRef, organizationOutcome.organizationRef],
                                workflowRefs: [workflowOutcome.workflowRef],
                                policyRefs: [policyOutcome.policyRef],
                                evidenceRefs: [profilesEvidenceOutcome.evidenceRef, benchmarksEvidenceOutcome.evidenceRef],
                        };
                        // THE REAL-KIT LAW: the FINAL draft mints through the REAL DH-02
                        // composeDraft (the full composition - the emitted refs; THE
                        // REGISTRY LINEAGE LAW: a re-mint is a NEW harness id; the real
                        // validateOnboardingReviewComposition walk fires INSIDE).
                        const onboarding = await ensureOnboardingKit();
                        const draft = await onboarding.composeDraft(onboardingSessionIdOf(journey), composition);
                        if (!draft.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'proposal',
                                                'THE VERBATIM-CARRY LAW',
                                                'proposeHarness: the REAL DH-02 onboarding kit refused the full-composition draft mint (the REAL validateOnboardingReviewComposition walk fires inside) - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: draft.refusal },
                                        ),
                                };
                        }
                        const harnessId = draft.session.harnessId as string;
                        // THE REAL-KIT LAW + THE TWO-PHASE LAW: the propose is the REAL
                        // draft->proposed advance through the onboarding kit (the FULL
                        // validateDomainHarnessDescriptor boundary - the NO-DANGLING-REF
                        // check fires THERE against the injected catalog snapshot).
                        const proposed = await onboarding.proposeSession(onboardingSessionIdOf(journey));
                        if (!proposed.ok) {
                                const harnessRefusal = proposed.refusal.harnessRefusal;
                                if (proposed.refusal.reason === 'harness-kit-refused' && harnessRefusal !== undefined && harnessRefusal.reason === 'VALIDATION_REFUSED') {
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        'dangling-ref-at-proposal',
                                                        'validation',
                                                        'THE NO-DANGLING-REF LAW',
                                                        'proposeHarness: the REAL DH-01 draft->proposed boundary refused the FULL validation (a ref does not resolve in the catalog snapshot) - the REAL refusal is carried verbatim (the onboarding refusal carrying the DH-01 refusal carrying the complete typed rejection table); the REAL harness record stays at draft and the journey record is unchanged',
                                                        undefined,
                                                        { onboardingRefusal: proposed.refusal },
                                                ),
                                        };
                                }
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'onboarding-refused',
                                                'validation',
                                                'THE VERBATIM-CARRY LAW',
                                                'proposeHarness: the REAL DH-02 onboarding kit refused the propose advance - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { onboardingRefusal: proposed.refusal },
                                        ),
                                };
                        }
                        // THE EVIDENCE-NOT-AUTHORITY LAW: the validation evidence is the
                        // REAL authority's own answer - the journey reopens the real DH-01
                        // kit from its OWN persisted ledger and reads the record's state
                        // and lastValidation (the full green outcome at propose).
                        const harnessHandle = await ensureHarnessKit();
                        if ('refusal' in harnessHandle) {
                                return { ok: false, refusal: harnessHandle.refusal };
                        }
                        const inspected = await harnessHandle.kit.inspectHarness(harnessId);
                        if (!inspected.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'harness-refused',
                                                'validation',
                                                'THE VERBATIM-CARRY LAW',
                                                'proposeHarness: the REAL DH-01 kit refused the inspect over the proposed harness - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { harnessRefusal: inspected.refusal },
                                        ),
                                };
                        }
                        const validation = inspected.record.lastValidation;
                        if (inspected.record.state !== 'proposed' || !validation.ok || validation.mode !== 'full') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unsafe-proposal',
                                                'validation',
                                                'THE EVIDENCE-NOT-AUTHORITY LAW',
                                                `proposeHarness: the REAL DH-01 kit's record for ${harnessId} is not at 'proposed' with a green FULL validation outcome (the authority's own state is the truth; the journey fails closed)`,
                                                [inspected.record.state],
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `proposed the harness through the REAL DH-02 proposeSession boundary (${harnessId} advanced to proposed; the FULL validateDomainHarnessDescriptor walk green over the injected catalog snapshot; the journey's proposal leg's evidence - the review composition with the emitted refs - is the ledger line's payload)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'proposed',
                                harnessId,
                                validation,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'validation', fromStage: 'composed', toStage: 'proposed', op: 'propose-harness', law: 'THE TWO-PHASE LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'propose-harness',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'validation',
                                fromStage: 'composed',
                                toStage: 'proposed',
                                law: 'THE TWO-PHASE LAW',
                                payload: composition,
                                harnessId,
                                validation,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async approveHarness(journeyId: unknown, decision: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('approveHarness');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('approveHarness', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        const stageRefusal = stageGuard('approve-harness', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const harnessId = journey.harnessId;
                        if (harnessId === null) {
                                return { ok: false, refusal: refused('incomplete-composition', 'approval', 'THE INCOMPLETE-COMPOSITION LAW', 'approveHarness: the approval boundary requires the proposal leg walked (the harness link is absent - the defensive re-proof behind the stage machine)') };
                        }
                        const catalogRefusal = catalogGuard('approval');
                        if (catalogRefusal !== null) {
                                return { ok: false, refusal: catalogRefusal };
                        }
                        // THE EVIDENCE-NOT-AUTHORITY LAW: the real authority handle,
                        // reopened from its OWN persisted ledger.
                        const harnessHandle = await ensureHarnessKit();
                        if ('refusal' in harnessHandle) {
                                return { ok: false, refusal: harnessHandle.refusal };
                        }
                        // The pre-inspect (a pure read): the descriptor baseline for the
                        // catalog-binding classification AND the record-unchanged pin.
                        const inspected = await harnessHandle.kit.inspectHarness(harnessId);
                        if (!inspected.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'harness-refused',
                                                'approval',
                                                'THE VERBATIM-CARRY LAW',
                                                'approveHarness: the REAL DH-01 kit refused the inspect over the proposed harness - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { harnessRefusal: inspected.refusal },
                                        ),
                                };
                        }
                        const descriptor = inspected.record.descriptor;
                        // THE APPROVAL-BEFORE-ACTIVATION LAW: the caller-supplied approval
                        // decision is REQUIRED (no approval input, no activation); the
                        // decision is RECORDED in the journey evidence, never brokered -
                        // the REAL kit's own decision record (its canonical walk) is the
                        // authority and the journey's mirror.
                        const advanced = await harnessHandle.kit.advanceHarness(harnessId, 'approved', decision);
                        if (!advanced.ok) {
                                const advanceRefusal = advanced.refusal;
                                if (advanceRefusal.reason === 'CATALOG_BINDING_REFUSED') {
                                        // THE CATALOG-BINDING LAW classification through the REAL
                                        // full-validation walk (imported by reference, never
                                        // re-implemented): a capabilityRef that no longer RESOLVES
                                        // in the catalog snapshot is the absent-refusal; one that
                                        // resolves but sits below approved/enabled/available is the
                                        // unapproved-capability refusal (the row's core law).
                                        const walk = validateDomainHarnessDescriptor(descriptor, bound.catalog);
                                        const absent = !walk.ok && walk.rejections.some((rejection) => rejection.reason === 'dangling-ref' && rejection.family === 'capabilityRefs');
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        absent ? 'catalog-binding-refused' : 'unapproved-capability',
                                                        'approval',
                                                        'THE CATALOG-BINDING LAW',
                                                        `approveHarness: the REAL DH-01 approve boundary refused - a harness is NEVER approved over an unapproved capability${absent ? ' (a capabilityRef ABSENT from the catalog snapshot - fail-closed escalation)' : ' (a capabilityRef sits below approved/enabled/available in the catalog snapshot)'} - the REAL refusal is carried verbatim; the REAL harness record stays at its pre-refusal state and the journey record is unchanged`,
                                                        undefined,
                                                        { harnessRefusal: advanceRefusal },
                                                ),
                                        };
                                }
                                if (advanceRefusal.reason === 'MALFORMED_DECISION') {
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        'malformed-decision',
                                                        'approval',
                                                        'THE FAIL-CLOSED LAW',
                                                        'approveHarness: the REAL DH-01 kit refused the caller-supplied approval decision (the frozen { approvedBy, note? } shape) - the refusal is carried verbatim; the journey record is unchanged',
                                                        undefined,
                                                        { harnessRefusal: advanceRefusal },
                                                ),
                                        };
                                }
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'harness-refused',
                                                'approval',
                                                'THE VERBATIM-CARRY LAW',
                                                'approveHarness: the REAL DH-01 kit refused the proposed->approved advance - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { harnessRefusal: advanceRefusal },
                                        ),
                                };
                        }
                        // THE EVIDENCE-NOT-AUTHORITY LAW: the approval evidence is the real
                        // kit's OWN canonical decision record (the last transition note's
                        // decision) - recorded, never brokered.
                        const approval = advanced.record.history[advanced.record.history.length - 1].decision as Readonly<Record<string, string>>;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `approved the harness through the REAL DH-01 advanceHarness boundary (${harnessId} advanced to approved over the catalog-boundary law; the approval decision is RECORDED as evidence, never brokered)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'approved',
                                approval,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'approval', fromStage: 'proposed', toStage: 'approved', op: 'approve-harness', law: 'THE APPROVAL-BEFORE-ACTIVATION LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'approve-harness',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'approval',
                                fromStage: 'proposed',
                                toStage: 'approved',
                                law: 'THE APPROVAL-BEFORE-ACTIVATION LAW',
                                payload: approval,
                                harnessId,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async activateHarness(journeyId: unknown, decision: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('activateHarness');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('activateHarness', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const journey = lookup.journey;
                        // THE APPROVAL-BEFORE-ACTIVATION LAW: no approval leg walked, no
                        // activation (the typed law fires HERE - the specific reason, never
                        // the generic premature-leg, at this boundary).
                        if (journey.approval === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'approval-missing',
                                                'activation',
                                                'THE APPROVAL-BEFORE-ACTIVATION LAW',
                                                'activateHarness: activation attempted without the approval leg walked - no approval input, no activation (the approval decision is RECORDED evidence, never brokered; the REAL harness record must sit at approved before this boundary opens)',
                                        ),
                                };
                        }
                        const stageRefusal = stageGuard('activate-harness', journey);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const harnessId = journey.harnessId;
                        if (harnessId === null) {
                                return { ok: false, refusal: refused('incomplete-composition', 'activation', 'THE INCOMPLETE-COMPOSITION LAW', 'activateHarness: the activation boundary requires the proposal leg walked (the harness link is absent - the defensive re-proof behind the stage machine)') };
                        }
                        const catalogRefusal = catalogGuard('activation');
                        if (catalogRefusal !== null) {
                                return { ok: false, refusal: catalogRefusal };
                        }
                        const harnessHandle = await ensureHarnessKit();
                        if ('refusal' in harnessHandle) {
                                return { ok: false, refusal: harnessHandle.refusal };
                        }
                        // THE FAIL-CLOSED LAW's double-check (the row's core): the REAL
                        // harness record must sit at 'approved' - an incomplete or unsafe
                        // proposal NEVER activates; there is NO code path from an unsafe
                        // proposal to an active harness (the record-unchanged law: the
                        // advance is never even attempted).
                        const inspected = await harnessHandle.kit.inspectHarness(harnessId);
                        if (!inspected.ok) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'harness-refused',
                                                'activation',
                                                'THE VERBATIM-CARRY LAW',
                                                'activateHarness: the REAL DH-01 kit refused the inspect over the approved harness - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { harnessRefusal: inspected.refusal },
                                        ),
                                };
                        }
                        if (inspected.record.state !== 'approved') {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unsafe-proposal',
                                                'activation',
                                                'THE FAIL-CLOSED LAW',
                                                `activateHarness: the REAL harness record sits at '${inspected.record.state}' - an incomplete or unsafe proposal NEVER activates (the fail-closed double-check against the authority's own state; there is NO code path from an unsafe proposal to an active harness; the authority's own state is the truth and the journey evidence never overrides it)`,
                                                [inspected.record.state],
                                        ),
                                };
                        }
                        // THE REAL-KIT LAW: the terminal usable state through the REAL
                        // authority's own advance surface.
                        const advanced = await harnessHandle.kit.advanceHarness(harnessId, 'active', decision);
                        if (!advanced.ok) {
                                const advanceRefusal = advanced.refusal;
                                if (advanceRefusal.reason === 'MALFORMED_DECISION') {
                                        return {
                                                ok: false,
                                                refusal: refused(
                                                        'malformed-decision',
                                                        'activation',
                                                        'THE FAIL-CLOSED LAW',
                                                        'activateHarness: the REAL DH-01 kit refused the caller-supplied activation decision (the frozen { activatedBy } shape) - the refusal is carried verbatim; the journey record is unchanged',
                                                        undefined,
                                                        { harnessRefusal: advanceRefusal },
                                                ),
                                        };
                                }
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'harness-refused',
                                                'activation',
                                                'THE VERBATIM-CARRY LAW',
                                                'activateHarness: the REAL DH-01 kit refused the approved->active advance - the refusal is carried verbatim; the journey record is unchanged',
                                                undefined,
                                                { harnessRefusal: advanceRefusal },
                                        ),
                                };
                        }
                        const activation = advanced.record.history[advanced.record.history.length - 1].decision as Readonly<Record<string, string>>;
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `activated the harness through the REAL DH-01 advanceHarness boundary (${harnessId} advanced to active - the terminal usable state; the activation decision is RECORDED as evidence, never brokered)`;
                        const record: ActivationJourneyRecord = {
                                ...journey,
                                stage: 'active',
                                activation,
                                revision: journey.revision + 1,
                                history: [...journey.history, { at, leg: 'activation', fromStage: 'approved', toStage: 'active', op: 'activate-harness', law: 'THE FAIL-CLOSED LAW', detail }],
                        };
                        const line: ActivationOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: ACTIVATION_CONTRACTS_VERSION,
                                op: 'activate-harness',
                                journeyId: journey.journeyId,
                                onboardingSessionId: journey.onboardingSessionId as string,
                                leg: 'activation',
                                fromStage: 'approved',
                                toStage: 'active',
                                law: 'THE FAIL-CLOSED LAW',
                                payload: activation,
                                harnessId,
                                validation: null,
                                detail,
                        };
                        return applyLeg(record, line);
                },

                async inspectJourney(journeyId: unknown): Promise<JourneyOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectJourney');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupJourney('inspectJourney', journeyId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return journeyOutcome(lookup.journey);
                },

                async listJourneys(filter?: unknown): Promise<JourneyListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listJourneys');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', 'listJourneys: the filter must be an object (or absent)') };
                                }
                                const filterRecord = filter as Record<string, unknown>;
                                const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry');
                                if (unknownFields.length > 0) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', 'listJourneys: the filter carries an unknown field (stage / industry only)', unknownFields) };
                                }
                                if (filterRecord.stage !== undefined && !isActivationJourneyStage(filterRecord.stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', 'listJourneys: the stage filter value is not a member of the frozen ACTIVATION_STAGES list') };
                                }
                                if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', null, 'THE FAIL-CLOSED LAW', 'listJourneys: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
                                }
                        }
                        const ids = [...journeys.keys()].sort();
                        const records: ActivationJourneyRecord[] = [];
                        for (const id of ids) {
                                const journey = journeys.get(id) as ActivationJourneyRecord;
                                if (filter !== undefined) {
                                        const filterRecord = filter as Record<string, unknown>;
                                        if (filterRecord.stage !== undefined && journey.stage !== filterRecord.stage) {
                                                continue;
                                        }
                                        if (filterRecord.industry !== undefined && journey.industry !== filterRecord.industry) {
                                                continue;
                                        }
                                }
                                records.push(copyJourney(journey));
                        }
                        return { ok: true, journeys: records };
                },

                dispose(): void {
                        disposed = true;
                },
        };

        // --- the leg applier (the shared persistence tail of every applied leg) ---

        async function applyLeg(record: ActivationJourneyRecord, line: ActivationOpsLedgerLine): Promise<JourneyOutcome> {
                const nextJourneys = new Map(journeys);
                nextJourneys.set(record.journeyId, record);
                const persistResult = await persist(line, nextJourneys);
                if (!persistResult.applied) {
                        return { ok: false, refusal: persistResult.refusal };
                }
                commit(nextJourneys);
                if (persistResult.refusal !== null) {
                        return { ok: false, refusal: persistResult.refusal };
                }
                return journeyOutcome(record);
        }

        // --- the verbatim-carry refusal builders ---

        function rolesRefused(rolesRefusal: RolesKitRefusal, message: string): ActivationKitRefusal {
                return refused('roles-refused', 'role-composition', 'THE VERBATIM-CARRY LAW', message, undefined, { rolesRefusal });
        }

        function rolesReopenRefused(): ActivationKitRefusal {
                // Unreachable through the shipped battery surfaces (the reloaded kit's lazy
                // roles reopen fails only over a torn roles ledger, which the onboarding /
                // harness replays surface first); the branch is the honest fail-closed guard.
                return refused('roles-refused', 'role-composition', 'THE VERBATIM-CARRY LAW', `composeRoles: the REAL DH-03 roles kit refused to reopen over its own persisted ledger (a torn roles ledger is surfaced by the family's own load surface; the journey never re-implements the roles load)`);
        }

        function recordRefusedOf(recordRefusal: RecordFamilyKitRefusal, message: string): ActivationKitRefusal {
                return refused('record-refused', 'record-composition', 'THE VERBATIM-CARRY LAW', message, undefined, { recordRefusal });
        }

        function recordReopenRefused(family: string): ActivationKitRefusal {
                return refused(
                        'record-refused',
                        'record-composition',
                        'THE VERBATIM-CARRY LAW',
                        `composeRecords: the REAL DH-04..DH-09 ${family} kit refused to reopen over its own persisted ledger (a torn record ledger is surfaced by the family's own load surface; the journey never re-implements the record load)`,
                );
        }

        function emitRefused(recordRefusal: RecordFamilyKitRefusal, refName: string, recordId: string): ActivationKitRefusal {
                if (recordRefusal.reason === 'premature-op') {
                        // THE INCOMPLETE-COMPOSITION LAW re-proof through the REAL emit
                        // surface: a non-composed record refuses the emit (fail closed).
                        return refused(
                                'incomplete-composition',
                                'record-composition',
                                'THE INCOMPLETE-COMPOSITION LAW',
                                `proposeHarness: the emit of ${refName} from the record ${recordId} refused - the record is not at the composed stage (the proposal boundary requires EVERY composition leg walked through the REAL families' own surfaces); the journey record is unchanged`,
                                undefined,
                                { recordRefusal },
                        );
                }
                return refused(
                        'record-refused',
                        'record-composition',
                        'THE VERBATIM-CARRY LAW',
                        `proposeHarness: the REAL record kit refused the emit of ${refName} from the record ${recordId} - the refusal is carried verbatim; the journey record is unchanged`,
                        undefined,
                        { recordRefusal },
                );
        }
}

// --- the canonical payload / validation objects (the ledger line's bytes) ---

function payloadObject(payload: NonNullable<ActivationOpsLedgerLine['payload']>): unknown {
        if (payload === null) {
                return null;
        }
        if (Array.isArray(payload)) {
                return [...payload];
        }
        if ('industry' in (payload as Record<string, unknown>) && Object.keys(payload as Record<string, unknown>).length === 1) {
                return { industry: (payload as OnboardingIndustryPayload).industry };
        }
        if ('displayName' in (payload as Record<string, unknown>)) {
                const profile = payload as OnboardingCompanyProfile;
                return { displayName: profile.displayName, sizeBand: profile.sizeBand };
        }
        if ('sessionId' in (payload as Record<string, unknown>)) {
                return rolesSessionObject(payload as RoleCompositionSession);
        }
        if ('content' in (payload as Record<string, unknown>)) {
                const records = payload as JourneyRecordsPayload;
                return { content: recordContentObject(records.content), links: linksObject(records.links) };
        }
        if ('roles' in (payload as Record<string, unknown>)) {
                return reviewCompositionObject(payload as OnboardingReviewComposition);
        }
        return { ...(payload as Readonly<Record<string, string>>) };
}

function rolesSessionObject(session: RoleCompositionSession): Record<string, unknown> {
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

function recordContentObject(content: JourneyRecordContent): Record<string, unknown> {
        return {
                terms: content.terms.map((term) => ({ term: term.term, definition: term.definition })),
                tasks: content.tasks.map((task) => ({ taskKey: task.taskKey, summary: task.summary, termRefs: [...task.termRefs] })),
                bodies: content.bodies.map((body) => ({ bodyKey: body.bodyKey, summary: body.summary, roleRefs: [...body.roleRefs] })),
                packs: content.packs.map((pack) => ({ packKey: pack.packKey, summary: pack.summary, bodyRefs: [...pack.bodyRefs] })),
                profiles: content.profiles.map((profile) => ({
                        profileKey: profile.profileKey,
                        summary: profile.summary,
                        permissionRefs: [...profile.permissionRefs],
                        approvalTiers: [...profile.approvalTiers],
                        evidenceFloor: profile.evidenceFloor,
                        kpiDimensions: [...profile.kpiDimensions],
                })),
                benchmarks: content.benchmarks.map((benchmark) => ({
                        benchmarkKey: benchmark.benchmarkKey,
                        summary: benchmark.summary,
                        hypothesis: benchmark.hypothesis,
                        scenarioRefs: [...benchmark.scenarioRefs],
                        kpiDimensions: [...benchmark.kpiDimensions],
                        expectedOutcome: benchmark.expectedOutcome,
                        limitations: benchmark.limitations,
                        evidenceLevel: benchmark.evidenceLevel,
                })),
        };
}

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

function reviewCompositionObject(composition: OnboardingReviewComposition): Record<string, unknown> {
        return {
                roles: composition.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                capabilityRefs: [...composition.capabilityRefs],
                workflowRefs: [...composition.workflowRefs],
                policyRefs: [...composition.policyRefs],
                evidenceRefs: [...composition.evidenceRefs],
        };
}

function validationObject(outcome: HarnessValidationOutcome): Record<string, unknown> {
        if (!outcome.ok) {
                return {
                        ok: false,
                        mode: outcome.mode,
                        rejections: outcome.rejections.map((rejection) => ({
                                reason: rejection.reason,
                                law: rejection.law,
                                ...(rejection.family === undefined ? {} : { family: rejection.family }),
                                items: [...rejection.items],
                                detail: rejection.detail,
                        })),
                };
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

// --- the ledger replay (the authoritative surface's re-proof) ---

interface ReplayOk {
        readonly lines: readonly ActivationOpsLedgerLine[];
        readonly journeys: ReadonlyMap<string, ActivationJourneyRecord>;
}

/**
 * THE APPEND-ONLY LEDGER LAW's replay: every line re-validated - the
 * frozen fourteen-key line schema, the seq (equal to the line
 * number), the contract version, the op name, the journey id form,
 * the op<->leg table (the line's leg is the op's LAST leg), the net
 * stage edge through the contract's own tables and machine (a
 * forward row OR a self-edge - the gradual-composition law), the
 * stage CHAIN (fromStage = the journey's current stage), the
 * frontier discipline (THE FORWARD-ONLY LAW), the payload walks
 * through the REAL family validators, THE INCOMPLETE-COMPOSITION
 * LAW (a propose line requires the compose-records line), THE
 * APPROVAL-BEFORE-ACTIVATION LAW (an activate line requires the
 * approve line) - all re-proven FROM THE LEDGER ALONE. Any violation
 * is the torn-detail string (the typed E_LEDGER_TORN at the load
 * boundary).
 */
function replayActivationLedger(ledgerText: string | null): ReplayOk | string {
        if (ledgerText === null) {
                return { lines: [], journeys: new Map<string, ActivationJourneyRecord>() };
        }
        const lines = ledgerText.split('\n').filter((line) => line.trim().length > 0);
        const journeys = new Map<string, ActivationJourneyRecord>();
        const replayed: ActivationOpsLedgerLine[] = [];
        for (let i = 0; i < lines.length; i += 1) {
                let parsed: unknown;
                try {
                        parsed = JSON.parse(lines[i]);
                } catch (error) {
                        return `replayActivationLedger: line ${i + 1} is not valid JSON: ${toMessage(error)} (a torn write - never a silent partial replay)`;
                }
                if (!isRecord(parsed)) {
                        return `replayActivationLedger: line ${i + 1} is not a JSON object (a torn write)`;
                }
                const line = parsed as Record<string, unknown>;
                const keys = Object.keys(line);
                const expected = [...ACTIVATION_LEDGER_LINE_SCHEMA_KEYS];
                if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                        return `replayActivationLedger: line ${i + 1} does not carry the frozen fourteen-key ledger-line schema in the canonical fixed-key order`;
                }
                if (line.seq !== i + 1) {
                        return `replayActivationLedger: line ${i + 1} carries seq ${showValue(line.seq)} - the seq must equal the line number (the append-only law)`;
                }
                if (line.contractVersion !== ACTIVATION_CONTRACTS_VERSION) {
                        return `replayActivationLedger: line ${i + 1} carries contract version '${showValue(line.contractVersion)}' - only '${ACTIVATION_CONTRACTS_VERSION}' is known (THE SINGLE-VERSION LAW's live station)`;
                }
                if (typeof line.at !== 'string' || line.at.length === 0) {
                        return `replayActivationLedger: line ${i + 1} carries no clock reading`;
                }
                if (!isActivationOpName(line.op)) {
                        return `replayActivationLedger: line ${i + 1} carries an unknown op ${showValue(line.op)}`;
                }
                const op = line.op as ActivationOpName;
                if (!isJourneyId(line.journeyId)) {
                        return `replayActivationLedger: line ${i + 1} carries a malformed journey id ${showValue(line.journeyId)} (the flauz:jrn:<16-hex> form)`;
                }
                const journeyId = line.journeyId as string;
                if (typeof line.onboardingSessionId !== 'string' || !isOnboardingSessionId(line.onboardingSessionId)) {
                        return `replayActivationLedger: line ${i + 1} carries a malformed onboarding session link ${showValue(line.onboardingSessionId)} (the REAL DH-02 isOnboardingSessionId predicate, imported by reference)`;
                }
                const onboardingSessionId = line.onboardingSessionId as string;
                // The op's line leg: the LAST of the op's own legs (null only on begin).
                const opLegs = JOURNEY_OP_LEGS[op];
                const lineLeg = opLegs.length === 0 ? null : opLegs[opLegs.length - 1];
                if (line.leg !== lineLeg) {
                        return `replayActivationLedger: line ${i + 1} carries the leg '${showValue(line.leg)}' under op '${op}' - the line lands on the op's LAST leg '${showValue(lineLeg)}' (the frozen op<->leg table)`;
                }
                if (typeof line.law !== 'string' || line.law.length === 0 || typeof line.detail !== 'string' || line.detail.length === 0) {
                        return `replayActivationLedger: line ${i + 1} carries no provenance (the law and detail sentences are required)`;
                }
                // The journey fold's guards (the stage machine + the fail-closed laws,
                // re-proven from the ledger alone).
                const journey = journeys.get(journeyId);
                if (op === 'begin-journey') {
                        if (journey !== undefined) {
                                return `replayActivationLedger: line ${i + 1} begins the journey ${journeyId} a second time (the journey lineage law)`;
                        }
                        if (line.payload !== null || line.harnessId !== null || line.validation !== null) {
                                return `replayActivationLedger: line ${i + 1} (begin-journey) carries a non-null payload / harnessId / validation column (the begin line mints only the session link)`;
                        }
                        if (line.fromStage !== null || line.toStage !== 'selection') {
                                return `replayActivationLedger: line ${i + 1} (begin-journey) must walk the null -> selection net edge`;
                        }
                } else {
                        if (journey === undefined) {
                                return `replayActivationLedger: line ${i + 1} walks the journey ${journeyId} before its begin line (the journey lineage law)`;
                        }
                        if (journey.onboardingSessionId !== onboardingSessionId) {
                                return `replayActivationLedger: line ${i + 1} carries the onboarding session link ${onboardingSessionId} - the journey's link is ${journey.onboardingSessionId} (a drift is a torn ledger)`;
                        }
                        // THE FORWARD-ONLY LAW's frontier discipline (the contract's table).
                        const required = JOURNEY_OP_REQUIRED_LEGS[op];
                        const expectedLeg = required.length === 0 ? null : required[required.length - 1];
                        const expectedIndex = expectedLeg === null ? -1 : journeyLegIndex(expectedLeg);
                        const frontier = journey.history.length === 0 ? null : journey.history[journey.history.length - 1].leg;
                        const frontierIndex = frontier === null ? -1 : journeyLegIndex(frontier);
                        if (frontierIndex < expectedIndex) {
                                return `replayActivationLedger: line ${i + 1} (${op}) precedes its walked prerequisites within the frozen leg order (THE FORWARD-ONLY LAW re-proven from the ledger alone)`;
                        }
                        if (frontierIndex > expectedIndex) {
                                return `replayActivationLedger: line ${i + 1} (${op}) is behind the walk (the journey record never walks back; THE FORWARD-ONLY LAW re-proven from the ledger alone)`;
                        }
                        // The net stage edge: the chain + the contract's own machine.
                        if (line.fromStage !== journey.stage) {
                                return `replayActivationLedger: line ${i + 1} (${op}) walks from stage '${showValue(line.fromStage)}' - the journey's current stage is '${journey.stage}' (the stage chain never breaks)`;
                        }
                        const legStage = lineLeg === null ? 'selection' : JOURNEY_LEG_STAGES[lineLeg];
                        if (line.toStage !== legStage) {
                                return `replayActivationLedger: line ${i + 1} (${op}) walks to stage '${showValue(line.toStage)}' - the frozen leg<->stage table lands '${legStage}'`;
                        }
                        if (line.fromStage !== line.toStage) {
                                const verdict = canTransitionActivationStage(line.fromStage, line.toStage);
                                if (!verdict.ok) {
                                        return `replayActivationLedger: line ${i + 1} (${op}) walks the illegal stage edge '${showValue(line.fromStage)}' -> '${showValue(line.toStage)}' (${verdict.detail})`;
                                }
                        }
                        // THE INCOMPLETE-COMPOSITION LAW: the propose line requires the
                        // record-composition line (the composed links + the binding draft).
                        if (op === 'propose-harness' && (journey.recordLinks === null || journey.bindingHarnessId === null || journey.rolesSession === null)) {
                                return `replayActivationLedger: line ${i + 1} (propose-harness) arrives without the compose-records line (THE INCOMPLETE-COMPOSITION LAW re-proven from the ledger alone - an incomplete composition never proposes, never activates)`;
                        }
                        // THE APPROVAL-BEFORE-ACTIVATION LAW: the activate line requires
                        // the approve line (the recorded approval evidence).
                        if (op === 'activate-harness' && journey.approval === null) {
                                return `replayActivationLedger: line ${i + 1} (activate-harness) arrives without the approve-harness line (THE APPROVAL-BEFORE-ACTIVATION LAW re-proven from the ledger alone - no approval input, no activation)`;
                        }
                }
                // The payload walks (the REAL family validators, imported by reference).
                const payloadError = walkLinePayload(op, line.payload);
                if (payloadError !== null) {
                        return `replayActivationLedger: line ${i + 1} (${op}) ${payloadError}`;
                }
                if ((op === 'propose-harness') !== (line.validation !== null)) {
                        return `replayActivationLedger: line ${i + 1} (${op}) must carry the validation column ${op === 'propose-harness' ? 'with the REAL full-green outcome' : 'as null'} (the proposal boundary's evidence)`;
                }
                if (line.validation !== null) {
                        const validationError = walkLineValidation(line.validation);
                        if (validationError !== null) {
                                return `replayActivationLedger: line ${i + 1} (${op}) ${validationError}`;
                        }
                }
                if (line.harnessId !== null && !isHarnessId(line.harnessId)) {
                        return `replayActivationLedger: line ${i + 1} carries a malformed harness id ${showValue(line.harnessId)} (the REAL DH-01 flauz:hrn:<16-hex> alphabet)`;
                }
                // The fold: apply the line to the journey record (the begin line
                // constructs the fresh record; every other op folds over the begun one -
                // the undefined case was refused above).
                const next = foldLine(journey, line, op, lineLeg);
                journeys.set(journeyId, next);
                replayed.push(line as unknown as ActivationOpsLedgerLine);
        }
        return { lines: replayed, journeys };
}

/** The per-op payload walk (the REAL family validators, imported by reference). */
function walkLinePayload(op: ActivationOpName, payload: unknown): string | null {
        if (op === 'begin-journey') {
                return payload === null ? null : 'carries a non-null payload (the begin line mints only the session link)';
        }
        if (op === 'select-industry') {
                const walked = validateOnboardingIndustryPayload(payload);
                return walked.ok ? null : `carries an industry payload that fails the REAL DH-02 walk (${walked.refusal.reason}: ${walked.refusal.message})`;
        }
        if (op === 'compose-company') {
                const walked = validateOnboardingCompanyProfile(payload);
                return walked.ok ? null : `carries a company profile that fails the REAL DH-02 walk (${walked.refusal.reason}: ${walked.refusal.message})`;
        }
        if (op === 'select-work-types') {
                const walked = validateOnboardingWorkTypes(payload);
                return walked.ok ? null : `carries a work-type selection that fails the REAL DH-02 walk (${walked.refusal.reason}: ${walked.refusal.message})`;
        }
        if (op === 'compose-roles') {
                const walked = validateRoleCompositionSession(payload);
                if (!walked.ok) {
                        return `carries a roles session that fails the REAL DH-03 walk (${walked.rejections[0].reason}: ${walked.rejections[0].detail})`;
                }
                if (walked.value.stage !== 'composed') {
                        return `carries a roles session at the '${walked.value.stage}' stage - the journey records ONLY composed sessions (THE MULTI-ROLE LAW's evidence)`;
                }
                return null;
        }
        if (op === 'compose-records') {
                if (!isRecord(payload)) {
                        return 'carries a non-object records payload';
                }
                const keys = Object.keys(payload as Record<string, unknown>);
                if (keys.length !== 2 || keys[0] !== 'content' || keys[1] !== 'links') {
                        return 'carries a records payload outside the frozen { content, links } two-key schema';
                }
                const records = payload as Record<string, unknown>;
                const linkKeys = Object.keys(records.links as Record<string, unknown>);
                const expectedLinks = [...COMPOSED_RECORD_LINKS_SCHEMA_KEYS];
                if (linkKeys.length !== expectedLinks.length || linkKeys.some((key, index) => key !== expectedLinks[index])) {
                        return 'carries composed links outside the frozen six-key link schema';
                }
                const content = validateJourneyRecordContent(records.content);
                if (!content.ok) {
                        return `carries record content that fails the contract walk (${content.rejection.reason}: ${content.rejection.message})`;
                }
                return null;
        }
        if (op === 'propose-harness') {
                const walked = validateOnboardingReviewComposition(payload);
                return walked.ok ? null : `carries a review composition that fails the REAL DH-02 walk (${walked.refusal.reason}: ${walked.refusal.message})`;
        }
        // approve-harness / activate-harness: the decision mirrors.
        const target = op === 'approve-harness' ? 'approved' : 'active';
        const mirror = validateJourneyDecisionMirror(payload, target);
        return mirror.ok ? null : `carries a ${target} decision mirror that fails the walk (${mirror.message})`;
}

/** The propose line's validation column: the REAL outcome predicate + the full-green law. */
function walkLineValidation(validation: unknown): string | null {
        if (!isHarnessValidationOutcome(validation)) {
                return 'carries a validation column that fails the REAL DH-01 isHarnessValidationOutcome predicate (imported by reference)';
        }
        const outcome = validation as HarnessValidationOutcome;
        if (!outcome.ok || outcome.mode !== 'full') {
                return 'carries a validation column that is not the green FULL outcome (the journey records ONLY the proposal boundary\'s green full validation)';
        }
        return null;
}

/** The fold: applies one replayed line to the journey record (the same transitions the kit applies; the begin line folds over an undefined journey). */
function foldLine(journey: ActivationJourneyRecord | undefined, line: Record<string, unknown>, op: ActivationOpName, leg: JourneyLeg | null): ActivationJourneyRecord {
        const note: ActivationJourneyNote = {
                at: line.at as string,
                leg,
                fromStage: line.fromStage as ActivationJourneyStage | null,
                toStage: line.toStage as ActivationJourneyStage,
                op,
                law: line.law as string,
                detail: line.detail as string,
        };
        if (op === 'begin-journey') {
                return {
                        journeyId: line.journeyId as string,
                        contractVersion: ACTIVATION_CONTRACTS_VERSION,
                        stage: 'selection',
                        industry: null,
                        companyProfile: null,
                        workTypes: null,
                        rolesSession: null,
                        recordLinks: null,
                        bindingHarnessId: null,
                        harnessId: null,
                        validation: null,
                        approval: null,
                        activation: null,
                        onboardingSessionId: line.onboardingSessionId as string,
                        createdAtIso: line.at as string,
                        revision: 1,
                        history: [note],
                };
        }
        // Every non-begin line folds over the BEGUN journey (the replay refused
        // the walk-before-begin case above; the cast is the narrowed invariant).
        const begun = journey as ActivationJourneyRecord;
        const base = {
                ...begun,
                revision: begun.revision + 1,
                history: [...begun.history, note],
        };
        if (op === 'select-industry') {
                return { ...base, stage: 'selection', industry: (line.payload as OnboardingIndustryPayload).industry };
        }
        if (op === 'compose-company') {
                return { ...base, stage: 'selection', companyProfile: line.payload as OnboardingCompanyProfile };
        }
        if (op === 'select-work-types') {
                return { ...base, stage: 'selection', workTypes: [...(line.payload as readonly HarnessWorkType[])] };
        }
        if (op === 'compose-roles') {
                return { ...base, stage: 'composed', rolesSession: line.payload as RoleCompositionSession };
        }
        if (op === 'compose-records') {
                const records = line.payload as JourneyRecordsPayload;
                return { ...base, stage: 'composed', recordLinks: records.links, bindingHarnessId: line.harnessId as string };
        }
        if (op === 'propose-harness') {
                return { ...base, stage: 'proposed', harnessId: line.harnessId as string, validation: line.validation as HarnessValidationOutcome };
        }
        if (op === 'approve-harness') {
                return { ...base, stage: 'approved', approval: line.payload as Readonly<Record<string, string>> };
        }
        return { ...base, stage: 'active', activation: line.payload as Readonly<Record<string, string>> };
}

/** The envelope cross-check: byte-for-byte against the replay-built state (never silently rebuilt). */
function crossCheckEnvelope(envelopeText: string | null, seq: number, journeys: ReadonlyMap<string, ActivationJourneyRecord>): { reason: 'E_LEDGER_TORN' | 'E_ENVELOPE_MISMATCH'; message: string } | null {
        const expected = `{"contractVersion":${JSON.stringify(ACTIVATION_CONTRACTS_VERSION)},"seq":${seq},"journeys":[${[...journeys.keys()]
                .sort()
                .map((id) => serializeActivationJourney(journeys.get(id) as ActivationJourneyRecord))
                .join(',')}]}`;
        if (envelopeText === null) {
                if (seq === 0) {
                        return null;
                }
                return {
                        reason: 'E_ENVELOPE_MISMATCH',
                        message: 'crossCheckEnvelope: the activation envelope is missing while the ledger carries lines (never silently rebuilt - reopen requires the honest envelope)',
                };
        }
        if (envelopeText !== expected) {
                return {
                        reason: 'E_ENVELOPE_MISMATCH',
                        message: 'crossCheckEnvelope: the activation envelope diverges from the ledger replay (the envelope is the mirror, the ledger is the authority - never silently rebuilt)',
                };
        }
        return null;
}

// --- the shared helpers (the family pattern's private block) ---

function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
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
