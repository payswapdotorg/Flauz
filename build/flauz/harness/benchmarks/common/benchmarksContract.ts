/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-009 domain benchmark/simulation-worlds contract family: the typed
 * benchmark-definition layer for the Domain Harness OS direction
 * (WORK-REGISTRY.md - registry row DH-009 "domain benchmark /
 * simulation worlds"; ARCHITECTURE-LOCK.md 12.5: a harness may compose
 * "benchmark/simulation worlds" - a harness layer over the universal
 * Flauz core, never a fork; 12.6: no new authority). A harness is
 * domain-specific through its industry label (DH-01), its onboarding
 * record (DH-02), its named roles (DH-03), its domain terms (DH-04),
 * its task/workflow templates (DH-05), its organization's default
 * agent bodies (DH-06) and its default capability packs (DH-007) -
 * and through its BENCHMARKS: the named, testable, reproducible
 * benchmark definitions the domain's work is measured against. This
 * family is the DOMAIN-SIDE BENCHMARK LAYER: a typed, staged,
 * deterministic benchmark-record family bound to a harness, composing
 * benchmark entries (configuration only) whose scenario references
 * bind to the REAL LAB-003 task-world registry (the frozen world
 * descriptors + the deterministic seeded instance generator -
 * IMPORTED from the real module, never re-implemented, never
 * re-declared, never transcribed), with the family's validation,
 * serialization and persistence laws.
 *
 * THE IMPORT LAW (binding, this wave's charter): the scenario
 * registry (getScenario over the REAL TASK_WORLDS catalog), the
 * evaluation vocabulary (the REAL EvalDimension union), the evidence
 * ladder (the REAL LabEvidenceLevel union), the LAB_CONTRACTS_VERSION
 * pin, the frozen industry vocabulary, the harness-id alphabet and
 * the seven landed family versions are the LANDED surfaces - imported
 * from the real modules, never re-declared, re-implemented or
 * shadowed (the battery pins the imports). The eval-dimension and
 * evidence-ladder vocabularies are TYPE-ONLY exports in the real
 * module, so their runtime lists are DERIVED here through the
 * compile-time census pattern: a Record keyed by the REAL imported
 * type forces every member to appear exactly once (a drift in the
 * real union fails tsc in THIS module - the transcription trap is
 * closed by the compiler, and the battery pins the census).
 *
 * LAWS (the DH-009 work order; the landed family precedents,
 * inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a benchmark entry
 *   is CONFIGURATION (a benchmarkKey plus a human summary plus a
 *   testable hypothesis plus its scenario references plus its KPI
 *   dimensions plus the expected outcome plus the limitations
 *   disclosure plus the evidence level, EXACTLY eight keys); it
 *   grants NOTHING by itself and EXECUTES nothing by itself. The
 *   structural engine's benchmark station: any additional key on a
 *   benchmark entry is the typed no-fork rejection.
 * - THE TESTABLE-HYPOTHESIS LAW (binding, this wave's honesty): the
 *   hypothesis is a statement a run can CONFIRM or REFUTE, never a
 *   marketing claim; the expectedOutcome states what the hypothesis
 *   predicts, in a form an evaluation can confirm or refute (the
 *   mechanical bound is the non-empty 300-character control-free
 *   string; the honesty discipline is the README disclosure and the
 *   battery's fixture voice).
 * - THE LIMITATIONS DISCLOSURE (binding): every entry carries its
 *   own non-empty limitations statement - the honest name of what
 *   this benchmark does NOT cover; a benchmark without limitations
 *   text is a typed refusal (never a silent success).
 * - THE SCENARIO-BINDING LAW (binding, the wave's authority law):
 *   scenarioRefs is a NON-EMPTY, duplicate-free string array whose
 *   every member MUST resolve against the REAL imported LAB-003
 *   task-world registry through getScenario (imported by reference -
 *   never a transcribed id list, never a second registry; a
 *   fabricated scenario id is the typed dangling-scenario-ref
 *   refusal, proven at the entry walk (addBenchmark) and RE-proven
 *   at the finalize boundary and in the ledger replay - THE
 *   TWO-PHASE LAW of this family). The empty-scenario floor fires at
 *   the ENTRY level (a benchmark with no scenario measures nothing)
 *   - this differs deliberately from the honest-gap empty-refs law
 *   of the earlier families: a benchmark entry naming zero scenarios
 *   is a typed refusal, never a legal gap.
 * - THE KPI-VOCABULARY LAW (binding): kpiDimensions is a non-empty,
 *   duplicate-free array whose every member is a REAL EvalDimension
 *   (the imported evaluation vocabulary, membership through the
 *   compile-time census); a benchmark measuring nothing is a typed
 *   refusal.
 * - THE EVIDENCE-CEILING LAW (binding, this wave's honesty): the
 *   evidenceLevel of a benchmark DEFINITION is 'fixture' or
 *   'simulated' ONLY - the honest rungs for a definition family. A
 *   real ladder member above the ceiling ('local-real' /
 *   'runtime-real' / 'live-provider' / 'production-real') is the
 *   typed evidence-promotion refusal (a benchmark DEFINITION is
 *   never runtime evidence - never overstated); a value that is not
 *   even a real ladder member is the typed bad-evidence-level
 *   refusal. The ladder itself is the REAL imported LabEvidenceLevel
 *   union; the allowed subset is the family's frozen ceiling, typed
 *   against the real union.
 * - THE FROZEN-VOCABULARY LAW (binding): the record admits ONLY the
 *   landed HARNESS_INDUSTRIES members, and the harnessId must satisfy
 *   the REAL DH-01 harness-id alphabet (the FORM law - the EXISTENCE
 *   binding is the caller's wiring, never this layer's).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW (binding):
 *   composing -> composed; 'composed' is TERMINAL (a frozen record;
 *   every mutating op on a composed record refuses with the stage
 *   law); a changed benchmark is a NEW benchmark, never a mutation
 *   of a composed one.
 * - THE BENCHMARK LAWS (binding, frozen constants): the benchmarkKey
 *   is non-empty, at most BENCHMARK_KEY_MAX_LENGTH (64) characters,
 *   carries NO leading or trailing whitespace and no control
 *   characters; the summary is non-empty, at most
 *   BENCHMARK_SUMMARY_MAX_LENGTH (200) characters and carries no
 *   control characters; the hypothesis, the expectedOutcome and the
 *   limitations are non-empty, at most 300 characters each and carry
 *   no control characters; the record holds at most MAX_BENCHMARKS
 *   (64) benchmarks; benchmarkKeys are unique within the record; at
 *   least one benchmark at finalize (the empty floor fires THERE,
 *   never the record shape - a composing record may hold zero).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes; the instance
 *   generation is the REAL imported deterministic generator (same
 *   seed -> byte-identical instances).
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed record
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal; multi-offense validations report the COMPLETE rejection
 *   table in the frozen walk order.
 * - THE SINGLE-VERSION LAW (binding): BENCHMARKS_CONTRACTS_VERSION
 *   is '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION,
 *   ROLES_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION,
 *   TEMPLATES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION and
 *   PACKS_CONTRACTS_VERSION (the seven landed family versions) and
 *   LAB_CONTRACTS_VERSION (the real lab contracts pin) are declared
 *   ONCE in THEIR modules and re-carried here by reference (the
 *   battery pins every copy equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessId, isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import { getScenario } from '../../../lab/common/taskWorlds.js';
import type { EvalDimension, LabEvidenceLevel } from '../../../lab/common/labContracts.js';

/**
 * THE IMPORT LAW's re-export block: the REAL DH-01 harness-id
 * alphabet and the frozen industry vocabulary, the seven landed
 * contract versions, and the REAL LAB contracts version pin are
 * re-exported BY REFERENCE (the same bindings, never re-declared
 * copies). The battery pins referential identity against the real
 * modules.
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
export { LAB_CONTRACTS_VERSION } from '../../../lab/common/labContracts.js';

/**
 * THE IMPORT LAW's compile-time census for the REAL evaluation
 * vocabulary: EvalDimension is a TYPE-ONLY export of the real lab
 * contracts module, so its runtime list is DERIVED from a Record
 * keyed by the REAL imported type - the compiler forces every member
 * to appear exactly once (a drift in the real union fails tsc in
 * THIS module; the battery pins the derived list).
 */
const EVAL_DIMENSION_CENSUS: Record<EvalDimension, true> = {
        success: true,
        quality: true,
        latency: true,
        cost: true,
};

/** The REAL evaluation-dimension vocabulary, derived from the imported type (never transcribed). */
export const EVAL_DIMENSIONS: readonly EvalDimension[] = Object.keys(EVAL_DIMENSION_CENSUS) as readonly EvalDimension[];

/** Pure predicate over the REAL evaluation-dimension vocabulary (the derived import census). */
export function isEvalDimension(value: unknown): value is EvalDimension {
        return (EVAL_DIMENSIONS as readonly string[]).includes(value as string);
}

/**
 * THE IMPORT LAW's compile-time census for the REAL evidence ladder:
 * LabEvidenceLevel is a TYPE-ONLY export of the real lab contracts
 * module, so the ladder is DERIVED from a Record keyed by the REAL
 * imported type - the compiler forces every rung to appear exactly
 * once, in the frozen ladder order (a drift in the real union fails
 * tsc in THIS module; the battery pins the derived ladder).
 */
const LAB_EVIDENCE_LEVEL_CENSUS: Record<LabEvidenceLevel, true> = {
        fixture: true,
        simulated: true,
        'local-real': true,
        'runtime-real': true,
        'live-provider': true,
        'production-real': true,
};

/**
 * The REAL six-rung evidence ladder, derived from the imported type
 * (never transcribed) in the frozen ladder order: 'fixture' <
 * 'simulated' < 'local-real' < 'runtime-real' < 'live-provider' <
 * 'production-real'.
 */
export const LAB_EVIDENCE_LEVELS: readonly LabEvidenceLevel[] = Object.keys(
        LAB_EVIDENCE_LEVEL_CENSUS,
) as readonly LabEvidenceLevel[];

/** Pure predicate over the REAL six-rung evidence ladder (the derived import census). */
export function isLabEvidenceLevel(value: unknown): value is LabEvidenceLevel {
        return (LAB_EVIDENCE_LEVELS as readonly string[]).includes(value as string);
}

/**
 * THE EVIDENCE-CEILING LAW's allowed subset: the family's frozen
 * ceiling for a benchmark DEFINITION's evidence level - 'fixture' or
 * 'simulated' ONLY (the honest rungs for a definition family; the
 * four higher rungs are the typed evidence-promotion refusals - a
 * benchmark DEFINITION is never runtime evidence).
 */
export const BENCHMARK_EVIDENCE_LEVEL_CEILING: readonly LabEvidenceLevel[] = ['fixture', 'simulated'];

/**
 * The family's evidence-level type: the ceiling subset, TYPED against
 * the REAL imported ladder union (Extract - if the real ladder drops
 * a rung, tsc fails in THIS module).
 */
export type BenchmarkEvidenceLevel = Extract<LabEvidenceLevel, 'fixture' | 'simulated'>;

/** Pure predicate over the family's evidence ceiling (the allowed subset of the REAL ladder). */
export function isBenchmarkEvidenceLevel(value: unknown): value is BenchmarkEvidenceLevel {
        return (BENCHMARK_EVIDENCE_LEVEL_CEILING as readonly string[]).includes(value as string);
}

/**
 * The ladder rank of a REAL evidence level (its index in the frozen
 * REAL ladder order; -1 when the value is not a real rung). The
 * promotion walk compares ranks against the family ceiling.
 */
export function labEvidenceLevelRank(value: unknown): number {
        if (typeof value !== 'string') {
                return -1;
        }
        return (LAB_EVIDENCE_LEVELS as readonly string[]).indexOf(value);
}

/** THE SINGLE-VERSION LAW: BENCHMARKS_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const BENCHMARKS_CONTRACTS_VERSION = '1.0.0';

/**
 * The domain benchmark-record id prefix (this family's namespace;
 * the same id law as flauz:hrn: / flauz:onb: / flauz:rol: /
 * flauz:ont: / flauz:tpl: / flauz:bod: / flauz:pak: - the kit mints
 * <prefix><16 lowercase hex> from the injected rng).
 */
export const BENCHMARK_ID_PREFIX = 'flauz:ben:';

/**
 * The closed frozen stage vocabulary: the benchmark walk's two
 * stages. 'composed' is TERMINAL (a frozen record; every mutating op
 * on a composed record refuses with the stage law; THE APPEND-ONLY
 * LINEAGE LAW: a changed benchmark is a NEW benchmark, never a
 * mutation of a composed one).
 */
export const BENCHMARK_STAGES = [
        'composing',
        'composed',
] as const;
export type BenchmarkStage = (typeof BENCHMARK_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isBenchmarkStage(value: unknown): value is BenchmarkStage {
        return (BENCHMARK_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface BenchmarkStageTransition {
        readonly from: BenchmarkStage;
        readonly to: BenchmarkStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; a
 * changed benchmark is a NEW benchmark (THE APPEND-ONLY LINEAGE
 * LAW). Widening the map is a versioned contract decision.
 */
export const BENCHMARK_FORWARD_TRANSITIONS = [
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
export type BenchmarkStageVerdict =
        | { readonly ok: true; readonly from: BenchmarkStage; readonly to: BenchmarkStage; readonly row: number }
        | {
                        readonly ok: false;
                        readonly reason: 'ILLEGAL_TRANSITION';
                        readonly from: unknown;
                        readonly to: unknown;
                        readonly whitelistRow: number | null;
                        readonly expectedTo: BenchmarkStage | null;
                        readonly detail: string;
                };

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check (mirroring the landed family semantics exactly).
 * The only legal transition is composing->composed; every other edge
 * (self-loops, composed->anything, unknown stages, non-strings) is
 * the typed ILLEGAL_TRANSITION rejection naming the violated
 * whitelist row.
 */
export function canTransitionBenchmarkStage(from: unknown, to: unknown): BenchmarkStageVerdict {
        const transitions = BENCHMARK_FORWARD_TRANSITIONS as readonly BenchmarkStageTransition[];
        let rowNumber = 0;
        for (let i = 0; i < transitions.length; i += 1) {
                if (transitions[i].from === from) {
                        rowNumber = i + 1;
                        break;
                }
        }
        if (!isBenchmarkStage(from) || !isBenchmarkStage(to)) {
                return {
                        ok: false,
                        reason: 'ILLEGAL_TRANSITION',
                        from,
                        to,
                        whitelistRow: rowNumber > 0 ? rowNumber : null,
                        expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
                        detail: `canTransitionBenchmarkStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen BENCHMARK_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
                        detail: `canTransitionBenchmarkStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the record is FROZEN; a changed benchmark is a NEW benchmark, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
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
                        detail: `canTransitionBenchmarkStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
                };
        }
        return { ok: true, from, to, row: rowNumber };
}

/**
 * The benchmark laws (all frozen constants): the benchmarkKey is
 * non-empty, at most 64 characters, carries NO leading/trailing
 * whitespace and no control characters; the summary is non-empty, at
 * most 200 characters and carries no control characters; the
 * hypothesis, the expectedOutcome and the limitations are non-empty,
 * at most 300 characters each and carry no control characters; the
 * record holds at most MAX_BENCHMARKS (64) benchmarks.
 */
export const BENCHMARK_KEY_MAX_LENGTH = 64;

/** The summary bound (non-empty, at most 200 characters, no control characters). */
export const BENCHMARK_SUMMARY_MAX_LENGTH = 200;

/** THE TESTABLE-HYPOTHESIS LAW's mechanical bound (non-empty, at most 300 characters, no control characters). */
export const BENCHMARK_HYPOTHESIS_MAX_LENGTH = 300;

/** The expected-outcome bound (non-empty, at most 300 characters, no control characters). */
export const BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH = 300;

/** THE LIMITATIONS DISCLOSURE's bound (non-empty, at most 300 characters, no control characters). */
export const BENCHMARK_LIMITATIONS_MAX_LENGTH = 300;

/** The composition bound (at most 64 benchmarks; the empty floor fires at finalize). */
export const MAX_BENCHMARKS = 64;

/**
 * The frozen benchmark ops ledger vocabulary (the ledger line ops).
 */
export const BENCHMARK_OP_NAMES = [
        'begin-benchmarks',
        'add-benchmark',
        'replace-benchmark-summary',
        'remove-benchmark',
        'finalize-benchmarks',
] as const;
export type BenchmarkOpName = (typeof BENCHMARK_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isBenchmarkOpName(value: unknown): value is BenchmarkOpName {
        return (BENCHMARK_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the record history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the benchmark ops are the
 * composing->composing self edge - the organization composes its
 * benchmark definitions gradually), which op and which law granted
 * it, and the deterministic detail sentence.
 */
export interface BenchmarkTransitionNote {
        readonly at: string;
        readonly fromStage: BenchmarkStage | null;
        readonly toStage: BenchmarkStage;
        readonly op: BenchmarkOpName;
        readonly law: string;
        readonly detail: string;
}

/**
 * THE BENCHMARK LAWS' configuration entry: a benchmarkKey plus a
 * human summary plus a testable hypothesis plus its scenario
 * references plus its KPI dimensions plus the expected outcome plus
 * the limitations disclosure plus the evidence level, EXACTLY eight
 * keys (THE NO-FORK LAW's benchmark station: any additional key is
 * the typed no-fork rejection). A benchmark is CONFIGURATION; it
 * grants NOTHING and EXECUTES NOTHING by itself.
 */
export interface BenchmarkEntry {
        readonly benchmarkKey: string;
        readonly summary: string;
        readonly hypothesis: string;
        readonly scenarioRefs: readonly string[];
        readonly kpiDimensions: readonly EvalDimension[];
        readonly expectedOutcome: string;
        readonly limitations: string;
        readonly evidenceLevel: BenchmarkEvidenceLevel;
}

/**
 * The persisted per-record honest record (THE SIX-KEY MODEL): the id,
 * the bound harness id (the REAL DH-01 flauz:hrn:<16-hex> form - the
 * FORM law here; the EXISTENCE binding is the caller's wiring, and
 * the AGREEMENT with the bound harness's own industry is the caller's
 * composition law, both pinned in the battery through the real kits),
 * the industry that scopes the benchmark definitions (one REAL
 * HARNESS_INDUSTRIES member, imported by reference), the stage, the
 * composed benchmarks (MAY be empty while composing - the empty floor
 * fires at finalize, never the record shape), and the full op history
 * with provenance. The record carries NO contractVersion field: THE
 * SINGLE-VERSION LAW is enforced at the kit-layer persistence
 * surfaces (every ledger line and the envelope carry
 * BENCHMARKS_CONTRACTS_VERSION; a drift there is the typed
 * version-mismatch). Stage-vs-payload consistency is the ledger
 * replay's cross-check, never this shape's (the DH-01 guard
 * discipline).
 */
export interface BenchmarksRecord {
        readonly id: string;
        readonly harnessId: string;
        readonly industry: HarnessIndustry;
        readonly stage: BenchmarkStage;
        readonly benchmarks: readonly BenchmarkEntry[];
        readonly history: readonly BenchmarkTransitionNote[];
}

/** The frozen record schema keys, in the canonical fixed-key-order (the serialization order). */
export const BENCHMARKS_RECORD_SCHEMA_KEYS = [
        'id',
        'harnessId',
        'industry',
        'stage',
        'benchmarks',
        'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const BENCHMARKS_NOTE_SCHEMA_KEYS = [
        'at',
        'fromStage',
        'toStage',
        'op',
        'law',
        'detail',
] as const;

/** The frozen benchmark-entry schema keys, in the canonical fixed-key-order (THE EIGHT-KEY STATION). */
export const BENCHMARK_ENTRY_SCHEMA_KEYS = [
        'benchmarkKey',
        'summary',
        'hypothesis',
        'scenarioRefs',
        'kpiDimensions',
        'expectedOutcome',
        'limitations',
        'evidenceLevel',
] as const;

/** Pure predicate: a well-formed benchmark record id (flauz:ben:<16-hex>). */
export function isBenchmarkId(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (!value.startsWith(BENCHMARK_ID_PREFIX)) {
                return false;
        }
        const hex = value.slice(BENCHMARK_ID_PREFIX.length);
        return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of benchmark rejection reasons, in the exact
 * walk order (the work order's thirty-one stations are the complete
 * closed walk - the pure record vocabulary; the kit-layer stations -
 * unknown-record, version-mismatch, empty-benchmarks,
 * premature-op, stale-stage, unknown-benchmark, the
 * evaluation/inventory/gap stations, DISPOSED, CORRUPT_SEAM,
 * E_LEDGER_TORN, E_ENVELOPE_MISMATCH, BENCHMARKS_IO and
 * UNKNOWN_FILTER - are declared ONCE in the kit module, this wave's
 * placement of the landed family precedent's single-declaration
 * discipline one level up; the validation walks collect EVERY
 * violated law into the typed rejection table, the table's records
 * appearing in this order):
 *   malformed-record              - the candidate is not a plain
 *                                   object, a carrier carries the
 *                                   wrong structural type (a
 *                                   non-array benchmarks / history
 *                                   carrier), or a benchmark entry
 *                                   is not a plain object / one of
 *                                   its five string-leg carriers is
 *                                   not a string (the entry-level
 *                                   array-leg carriers are their own
 *                                   stations, never a double
 *                                   report);
 *   no-fork                       - THE NO-FORK LAW's benchmark
 *                                   station: a benchmark entry
 *                                   carries a key beyond the frozen
 *                                   eight (a benchmark is
 *                                   CONFIGURATION - it grants
 *                                   NOTHING and EXECUTES NOTHING by
 *                                   itself);
 *   unknown-key                   - a key outside the frozen six-key
 *                                   record schema;
 *   missing-key                   - a required record key is absent;
 *   bad-harness-id                - the bound harnessId is not the
 *                                   REAL DH-01 flauz:hrn:<16-hex>
 *                                   form (imported by reference -
 *                                   the FORM law; the EXISTENCE
 *                                   binding is the caller's wiring,
 *                                   never this layer's);
 *   bad-industry                  - THE FROZEN-VOCABULARY LAW: the
 *                                   industry is not a member of the
 *                                   DH-01 list (imported by
 *                                   reference);
 *   bad-stage                     - the stage is not a member of the
 *                                   frozen BENCHMARK_STAGES list;
 *   bad-history                   - a history note fails the frozen
 *                                   six-key note shape;
 *   benchmark-key-length          - a benchmarkKey is empty or
 *                                   longer than
 *                                   BENCHMARK_KEY_MAX_LENGTH (64)
 *                                   characters;
 *   benchmark-key-whitespace      - a benchmarkKey carries leading
 *                                   or trailing whitespace;
 *   benchmark-key-control-chars   - a benchmarkKey carries control
 *                                   characters (C0/DEL/C1);
 *   summary-length                - a summary is empty or longer
 *                                   than BENCHMARK_SUMMARY_MAX_LENGTH
 *                                   (200) characters;
 *   summary-control-chars         - a summary carries control
 *                                   characters (C0/DEL/C1);
 *   hypothesis-length             - THE TESTABLE-HYPOTHESIS LAW's
 *                                   mechanical bound: a hypothesis
 *                                   is empty or longer than
 *                                   BENCHMARK_HYPOTHESIS_MAX_LENGTH
 *                                   (300) characters;
 *   hypothesis-control-chars      - a hypothesis carries control
 *                                   characters (C0/DEL/C1);
 *   bad-scenario-refs-carrier     - a scenarioRefs carrier is not an
 *                                   array, or a member is not a
 *                                   string;
 *   empty-scenario-refs           - THE SCENARIO-BINDING LAW's entry
 *                                   floor: a benchmark entry names
 *                                   ZERO scenarios (a benchmark with
 *                                   no scenario measures nothing -
 *                                   the typed refusal, never the
 *                                   honest-gap law of the earlier
 *                                   families);
 *   duplicate-scenario-ref        - a benchmark's scenarioRefs carry
 *                                   repeats;
 *   dangling-scenario-ref         - THE SCENARIO-BINDING LAW: a
 *                                   scenarioRef does not resolve
 *                                   against the REAL imported LAB
 *                                   task-world registry (getScenario
 *                                   - imported by reference, never a
 *                                   transcribed list);
 *   bad-kpi-dimensions-carrier    - a kpiDimensions carrier is not
 *                                   an array, or a member is not a
 *                                   string;
 *   empty-kpi-dimensions          - THE KPI-VOCABULARY LAW's entry
 *                                   floor: a benchmark entry measures
 *                                   nothing (a benchmark with no KPI
 *                                   dimension is a typed refusal);
 *   unknown-kpi-dimension         - a kpiDimensions member is not a
 *                                   REAL EvalDimension (the derived
 *                                   import census);
 *   duplicate-kpi-dimension       - a kpiDimensions array carries
 *                                   repeats;
 *   expected-outcome-length       - an expectedOutcome is empty or
 *                                   longer than
 *                                   BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH
 *                                   (300) characters;
 *   expected-outcome-control-chars - an expectedOutcome carries
 *                                   control characters (C0/DEL/C1);
 *   limitations-length            - THE LIMITATIONS DISCLOSURE's
 *                                   bound: a limitations statement is
 *                                   empty or longer than
 *                                   BENCHMARK_LIMITATIONS_MAX_LENGTH
 *                                   (300) characters;
 *   limitations-control-chars     - a limitations statement carries
 *                                   control characters (C0/DEL/C1);
 *   bad-evidence-level            - the evidenceLevel is not a
 *                                   member of the REAL six-rung
 *                                   LabEvidenceLevel ladder (the
 *                                   derived import census);
 *   evidence-promotion            - THE EVIDENCE-CEILING LAW: the
 *                                   evidenceLevel IS a real ladder
 *                                   rung but sits ABOVE the family's
 *                                   frozen ceiling ('fixture' /
 *                                   'simulated') - a benchmark
 *                                   DEFINITION is never runtime
 *                                   evidence, never overstated;
 *   duplicate-benchmark-key       - benchmarkKeys are not unique
 *                                   within the record;
 *   max-benchmarks                - the record carries more than
 *                                   MAX_BENCHMARKS (64) benchmarks
 *                                   (the composition bound).
 * Widening or reordering the list is a versioned contract decision.
 */
export const BENCHMARKS_REJECTION_REASONS = [
        'malformed-record',
        'no-fork',
        'unknown-key',
        'missing-key',
        'bad-harness-id',
        'bad-industry',
        'bad-stage',
        'bad-history',
        'benchmark-key-length',
        'benchmark-key-whitespace',
        'benchmark-key-control-chars',
        'summary-length',
        'summary-control-chars',
        'hypothesis-length',
        'hypothesis-control-chars',
        'bad-scenario-refs-carrier',
        'empty-scenario-refs',
        'duplicate-scenario-ref',
        'dangling-scenario-ref',
        'bad-kpi-dimensions-carrier',
        'empty-kpi-dimensions',
        'unknown-kpi-dimension',
        'duplicate-kpi-dimension',
        'expected-outcome-length',
        'expected-outcome-control-chars',
        'limitations-length',
        'limitations-control-chars',
        'bad-evidence-level',
        'evidence-promotion',
        'duplicate-benchmark-key',
        'max-benchmarks',
] as const;
export type BenchmarksRejectionReason = (typeof BENCHMARKS_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isBenchmarksRejectionReason(value: unknown): value is BenchmarksRejectionReason {
        return (BENCHMARKS_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface BenchmarksRejection {
        readonly reason: BenchmarksRejectionReason;
        readonly law: string;
        readonly items?: readonly string[];
        readonly detail: string;
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * landed shape carrying the complete-table law): ok carries the
 * canonical value; refusal carries the COMPLETE typed rejection
 * table in the frozen walk order - never first-only.
 */
export type BenchmarksValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly BenchmarksRejection[] };

/**
 * The benchmarkKey station walk (the split-station key laws, the
 * family's per-key validator): malformed-record (the non-string
 * carrier) -> benchmark-key-length (the bound) ->
 * benchmark-key-whitespace (the padding) ->
 * benchmark-key-control-chars (the C0/DEL/C1 set), the complete
 * table over ONE key. Ok carries the benchmarkKey string.
 */
export function validateBenchmarkKey(benchmarkKey: unknown): BenchmarksValidationOutcome<string> {
        const rejections: BenchmarksRejection[] = [];
        if (typeof benchmarkKey !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['benchmarkKey'],
                        detail: 'validateBenchmarkKey: the benchmarkKey must be a string (the benchmark\'s identity key)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = textLengthViolationsOf(benchmarkKey, BENCHMARK_KEY_MAX_LENGTH);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'benchmark-key-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validateBenchmarkKey: the benchmarkKey must be a non-empty string of at most ${BENCHMARK_KEY_MAX_LENGTH} characters`,
                });
        }
        if (benchmarkKey !== benchmarkKey.trim()) {
                rejections.push({
                        reason: 'benchmark-key-whitespace',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['leading/trailing whitespace'],
                        detail: 'validateBenchmarkKey: the benchmarkKey must carry no leading or trailing whitespace',
                });
        }
        const keyControls = controlCharactersOf(benchmarkKey);
        if (keyControls.length > 0) {
                rejections.push({
                        reason: 'benchmark-key-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: keyControls,
                        detail: 'validateBenchmarkKey: the benchmarkKey must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: benchmarkKey };
}

/**
 * The summary station walk (the kit's replaceBenchmarkSummary
 * station): malformed-record (the non-string carrier) ->
 * summary-length (the bound) -> summary-control-chars (the
 * C0/DEL/C1 set). Ok carries the summary string.
 */
export function validateBenchmarkSummary(summary: unknown): BenchmarksValidationOutcome<string> {
        const rejections: BenchmarksRejection[] = [];
        if (typeof summary !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['summary'],
                        detail: 'validateBenchmarkSummary: the summary must be a string (the benchmark\'s human summary)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = textLengthViolationsOf(summary, BENCHMARK_SUMMARY_MAX_LENGTH);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'summary-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validateBenchmarkSummary: the summary must be a non-empty string of at most ${BENCHMARK_SUMMARY_MAX_LENGTH} characters`,
                });
        }
        const summaryControls = controlCharactersOf(summary);
        if (summaryControls.length > 0) {
                rejections.push({
                        reason: 'summary-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: summaryControls,
                        detail: 'validateBenchmarkSummary: the summary must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: summary };
}

/**
 * THE TESTABLE-HYPOTHESIS LAW's station walk: malformed-record (the
 * non-string carrier) -> hypothesis-length (the bound) ->
 * hypothesis-control-chars (the C0/DEL/C1 set). Ok carries the
 * hypothesis string.
 */
export function validateBenchmarkHypothesis(hypothesis: unknown): BenchmarksValidationOutcome<string> {
        const rejections: BenchmarksRejection[] = [];
        if (typeof hypothesis !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['hypothesis'],
                        detail: 'validateBenchmarkHypothesis: the hypothesis must be a string (THE TESTABLE-HYPOTHESIS LAW - a statement a run can confirm or refute, never a marketing claim)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = textLengthViolationsOf(hypothesis, BENCHMARK_HYPOTHESIS_MAX_LENGTH);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'hypothesis-length',
                        law: 'THE TESTABLE-HYPOTHESIS LAW',
                        items: lengthViolations,
                        detail: `validateBenchmarkHypothesis: the hypothesis must be a non-empty string of at most ${BENCHMARK_HYPOTHESIS_MAX_LENGTH} characters (a statement a run can confirm or refute)`,
                });
        }
        const hypothesisControls = controlCharactersOf(hypothesis);
        if (hypothesisControls.length > 0) {
                rejections.push({
                        reason: 'hypothesis-control-chars',
                        law: 'THE TESTABLE-HYPOTHESIS LAW',
                        items: hypothesisControls,
                        detail: 'validateBenchmarkHypothesis: the hypothesis must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: hypothesis };
}

/**
 * The expected-outcome station walk: malformed-record (the
 * non-string carrier) -> expected-outcome-length (the bound) ->
 * expected-outcome-control-chars (the C0/DEL/C1 set). Ok carries the
 * expectedOutcome string.
 */
export function validateBenchmarkExpectedOutcome(expectedOutcome: unknown): BenchmarksValidationOutcome<string> {
        const rejections: BenchmarksRejection[] = [];
        if (typeof expectedOutcome !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['expectedOutcome'],
                        detail: 'validateBenchmarkExpectedOutcome: the expectedOutcome must be a string (what the hypothesis predicts, stated so an evaluation can confirm or refute it)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = textLengthViolationsOf(expectedOutcome, BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'expected-outcome-length',
                        law: 'THE FAIL-CLOSED LAW',
                        items: lengthViolations,
                        detail: `validateBenchmarkExpectedOutcome: the expectedOutcome must be a non-empty string of at most ${BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH} characters`,
                });
        }
        const outcomeControls = controlCharactersOf(expectedOutcome);
        if (outcomeControls.length > 0) {
                rejections.push({
                        reason: 'expected-outcome-control-chars',
                        law: 'THE FAIL-CLOSED LAW',
                        items: outcomeControls,
                        detail: 'validateBenchmarkExpectedOutcome: the expectedOutcome must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: expectedOutcome };
}

/**
 * THE LIMITATIONS DISCLOSURE's station walk: malformed-record (the
 * non-string carrier) -> limitations-length (the bound) ->
 * limitations-control-chars (the C0/DEL/C1 set). Ok carries the
 * limitations string.
 */
export function validateBenchmarkLimitations(limitations: unknown): BenchmarksValidationOutcome<string> {
        const rejections: BenchmarksRejection[] = [];
        if (typeof limitations !== 'string') {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['limitations'],
                        detail: 'validateBenchmarkLimitations: the limitations must be a string (THE LIMITATIONS DISCLOSURE - the honest statement of what this benchmark does NOT cover)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const lengthViolations = textLengthViolationsOf(limitations, BENCHMARK_LIMITATIONS_MAX_LENGTH);
        if (lengthViolations.length > 0) {
                rejections.push({
                        reason: 'limitations-length',
                        law: 'THE LIMITATIONS DISCLOSURE',
                        items: lengthViolations,
                        detail: `validateBenchmarkLimitations: the limitations must be a non-empty string of at most ${BENCHMARK_LIMITATIONS_MAX_LENGTH} characters (the honest statement of what this benchmark does NOT cover)`,
                });
        }
        const limitationsControls = controlCharactersOf(limitations);
        if (limitationsControls.length > 0) {
                rejections.push({
                        reason: 'limitations-control-chars',
                        law: 'THE LIMITATIONS DISCLOSURE',
                        items: limitationsControls,
                        detail: 'validateBenchmarkLimitations: the limitations must carry no control characters (C0/DEL/C1)',
                });
        }
        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: limitations };
}

/**
 * The single-benchmark station walk (the kit's addBenchmark station,
 * the family's per-payload validator architecture): malformed-record
 * (the non-object entry, the non-string string-leg carriers) ->
 * no-fork -> benchmark-key-length -> benchmark-key-whitespace ->
 * benchmark-key-control-chars -> summary-length ->
 * summary-control-chars -> hypothesis-length ->
 * hypothesis-control-chars -> bad-scenario-refs-carrier ->
 * empty-scenario-refs -> duplicate-scenario-ref ->
 * dangling-scenario-ref (THE SCENARIO-BINDING LAW against the REAL
 * imported getScenario) -> bad-kpi-dimensions-carrier ->
 * empty-kpi-dimensions -> unknown-kpi-dimension ->
 * duplicate-kpi-dimension -> expected-outcome-length ->
 * expected-outcome-control-chars -> limitations-length ->
 * limitations-control-chars -> bad-evidence-level ->
 * evidence-promotion (THE EVIDENCE-CEILING LAW), the complete table
 * over ONE entry. Ok carries the canonical eight-key copy.
 */
export function validateBenchmarkEntry(benchmark: unknown): BenchmarksValidationOutcome<BenchmarkEntry> {
        const rejections: BenchmarksRejection[] = [];
        if (!isRecord(benchmark)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['benchmark'],
                        detail: 'validateBenchmarkEntry: every benchmark entry must be a plain object of exactly { benchmarkKey, summary, hypothesis, scenarioRefs, kpiDimensions, expectedOutcome, limitations, evidenceLevel } (a benchmark is configuration; it grants NOTHING and executes NOTHING by itself)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = benchmark as Record<string, unknown>;

        // station 1 (malformed-record): the five string-leg carriers.
        const carrierViolations: string[] = [];
        for (const leg of ['benchmarkKey', 'summary', 'hypothesis', 'expectedOutcome', 'limitations'] as const) {
                if (typeof record[leg] !== 'string') {
                        carrierViolations.push(leg);
                }
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: 'validateBenchmarkEntry: the benchmarkKey, summary, hypothesis, expectedOutcome and limitations must be strings (the benchmark\'s five text legs)',
                });
        }

        // station 2 (no-fork): THE NO-FORK LAW's benchmark station.
        const extraKeys = Object.keys(record).filter((key) => !(BENCHMARK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (extraKeys.length > 0) {
                rejections.push({
                        reason: 'no-fork',
                        law: 'THE NO-FORK LAW',
                        items: extraKeys,
                        detail: `validateBenchmarkEntry: a benchmark is CONFIGURATION (a benchmarkKey, a summary, a testable hypothesis, its scenario references, its KPI dimensions, the expected outcome, the limitations disclosure and the evidence level) - it grants NOTHING and executes NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a benchmark entry`,
                });
        }

        // stations 3-11: the per-leg law walks, each only when its carrier is walkable
        // (the benchmarkKey leg is the only one with its own whitespace station).
        if (typeof record.benchmarkKey === 'string') {
                collectTextStation(rejections, 'validateBenchmarkEntry', 'benchmarkKey', record.benchmarkKey, BENCHMARK_KEY_MAX_LENGTH, 'benchmark-key-length', 'benchmark-key-whitespace', 'benchmark-key-control-chars', 'the benchmarkKey');
        }
        if (typeof record.summary === 'string') {
                collectTextStation(rejections, 'validateBenchmarkEntry', 'summary', record.summary, BENCHMARK_SUMMARY_MAX_LENGTH, 'summary-length', 'summary-control-chars', 'summary-control-chars', 'the summary');
        }
        if (typeof record.hypothesis === 'string') {
                collectTextStation(rejections, 'validateBenchmarkEntry', 'hypothesis', record.hypothesis, BENCHMARK_HYPOTHESIS_MAX_LENGTH, 'hypothesis-length', 'hypothesis-control-chars', 'hypothesis-control-chars', 'the hypothesis');
        }

        // stations 12-15 (the scenario-binding legs), only when the carrier is an array.
        if (Array.isArray(record.scenarioRefs)) {
                const scenarioRefs = record.scenarioRefs as unknown[];
                const nonStringMembers: string[] = [];
                for (let i = 0; i < scenarioRefs.length; i += 1) {
                        if (typeof scenarioRefs[i] !== 'string') {
                                nonStringMembers.push(`scenarioRefs[${i}]`);
                        }
                }
                if (nonStringMembers.length > 0) {
                        pushOnce(rejections, 'bad-scenario-refs-carrier', 'THE FAIL-CLOSED LAW', nonStringMembers, 'validateBenchmarkEntry: every scenarioRefs member must be a string (the scenario-reference alphabet)');
                }
                if (scenarioRefs.length === 0) {
                        pushOnce(rejections, 'empty-scenario-refs', 'THE SCENARIO-BINDING LAW', ['scenarioRefs'], 'validateBenchmarkEntry: the scenarioRefs must name at least one REAL task-world scenario (a benchmark with no scenario measures nothing - the entry-level floor, never the honest-gap law of the earlier families)');
                }
                const stringRefs = scenarioRefs.filter((ref): ref is string => typeof ref === 'string');
                const duplicateRefs = findDuplicates(stringRefs);
                if (duplicateRefs.length > 0) {
                        pushOnce(rejections, 'duplicate-scenario-ref', 'THE FAIL-CLOSED LAW', duplicateRefs, 'validateBenchmarkEntry: the scenarioRefs array must be duplicate-free (a scenario reference appears once per benchmark)');
                }
                // THE SCENARIO-BINDING LAW: every member MUST resolve against the REAL
                // imported LAB task-world registry (getScenario, imported by reference -
                // never a transcribed list).
                const dangling: string[] = [];
                for (const ref of stringRefs) {
                        if (getScenario(ref) === undefined) {
                                dangling.push(ref);
                        }
                }
                if (dangling.length > 0) {
                        pushOnce(rejections, 'dangling-scenario-ref', 'THE SCENARIO-BINDING LAW', dangling, `validateBenchmarkEntry: every scenarioRef must resolve against the REAL LAB-003 task-world registry (imported through getScenario - never a transcribed list; the fabricated id(s) ${showList(dangling)} resolve to nothing)`);
                }
        } else if (hasOwn(record, 'scenarioRefs')) {
                pushOnce(rejections, 'bad-scenario-refs-carrier', 'THE FAIL-CLOSED LAW', ['scenarioRefs'], 'validateBenchmarkEntry: the scenarioRefs must be a string array (the benchmark\'s scenario references over the REAL LAB-003 task-world registry; NEVER empty - a benchmark with no scenario measures nothing)');
        }

        // stations 16-19 (the KPI-vocabulary legs), only when the carrier is an array.
        if (Array.isArray(record.kpiDimensions)) {
                const kpiDimensions = record.kpiDimensions as unknown[];
                const nonStringMembers: string[] = [];
                for (let i = 0; i < kpiDimensions.length; i += 1) {
                        if (typeof kpiDimensions[i] !== 'string') {
                                nonStringMembers.push(`kpiDimensions[${i}]`);
                        }
                }
                if (nonStringMembers.length > 0) {
                        pushOnce(rejections, 'bad-kpi-dimensions-carrier', 'THE FAIL-CLOSED LAW', nonStringMembers, 'validateBenchmarkEntry: every kpiDimensions member must be a string (the REAL evaluation vocabulary)');
                }
                if (kpiDimensions.length === 0) {
                        pushOnce(rejections, 'empty-kpi-dimensions', 'THE KPI-VOCABULARY LAW', ['kpiDimensions'], 'validateBenchmarkEntry: the kpiDimensions must name at least one REAL EvalDimension (a benchmark measuring nothing is a typed refusal)');
                }
                const stringDimensions = kpiDimensions.filter((dimension): dimension is string => typeof dimension === 'string');
                const unknownDimensions = stringDimensions.filter((dimension) => !isEvalDimension(dimension));
                if (unknownDimensions.length > 0) {
                        pushOnce(rejections, 'unknown-kpi-dimension', 'THE KPI-VOCABULARY LAW', unknownDimensions, 'validateBenchmarkEntry: every kpiDimensions member must be a REAL EvalDimension (the imported evaluation vocabulary - success / quality / latency / cost, derived from the real type census)');
                }
                const duplicateDimensions = findDuplicates(stringDimensions);
                if (duplicateDimensions.length > 0) {
                        pushOnce(rejections, 'duplicate-kpi-dimension', 'THE FAIL-CLOSED LAW', duplicateDimensions, 'validateBenchmarkEntry: the kpiDimensions array must be duplicate-free (a KPI dimension appears once per benchmark)');
                }
        } else if (hasOwn(record, 'kpiDimensions')) {
                pushOnce(rejections, 'bad-kpi-dimensions-carrier', 'THE FAIL-CLOSED LAW', ['kpiDimensions'], 'validateBenchmarkEntry: the kpiDimensions must be an array of REAL EvalDimension members (the imported evaluation vocabulary; NEVER empty - a benchmark measuring nothing is a typed refusal)');
        }

        // stations 20-23: the remaining text legs.
        if (typeof record.expectedOutcome === 'string') {
                collectTextStation(rejections, 'validateBenchmarkEntry', 'expectedOutcome', record.expectedOutcome, BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH, 'expected-outcome-length', 'expected-outcome-control-chars', 'expected-outcome-control-chars', 'the expectedOutcome');
        }
        if (typeof record.limitations === 'string') {
                collectTextStation(rejections, 'validateBenchmarkEntry', 'limitations', record.limitations, BENCHMARK_LIMITATIONS_MAX_LENGTH, 'limitations-length', 'limitations-control-chars', 'limitations-control-chars', 'the limitations');
        }

        // stations 24-25 (the evidence ceiling), only when the leg is present.
        if (hasOwn(record, 'evidenceLevel')) {
                const evidenceLevel = record.evidenceLevel;
                if (!isLabEvidenceLevel(evidenceLevel)) {
                        pushOnce(rejections, 'bad-evidence-level', 'THE FAIL-CLOSED LAW', [showValue(evidenceLevel)], 'validateBenchmarkEntry: the evidenceLevel must be a member of the REAL six-rung LabEvidenceLevel ladder (fixture / simulated / local-real / runtime-real / live-provider / production-real - imported by reference)');
                } else if (!isBenchmarkEvidenceLevel(evidenceLevel)) {
                        pushOnce(rejections, 'evidence-promotion', 'THE EVIDENCE-CEILING LAW', [evidenceLevel], `validateBenchmarkEntry: the evidenceLevel '${evidenceLevel}' is a real ladder rung but sits ABOVE the family's frozen ceiling ('fixture' / 'simulated') - a benchmark DEFINITION is never runtime evidence, never overstated`);
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return {
                ok: true,
                value: {
                        benchmarkKey: record.benchmarkKey as string,
                        summary: record.summary as string,
                        hypothesis: record.hypothesis as string,
                        scenarioRefs: [...(record.scenarioRefs as string[])],
                        kpiDimensions: [...(record.kpiDimensions as EvalDimension[])],
                        expectedOutcome: record.expectedOutcome as string,
                        limitations: record.limitations as string,
                        evidenceLevel: record.evidenceLevel as BenchmarkEvidenceLevel,
                },
        };
}

/**
 * The deep record walk (pure): the strict thirty-one-station walk
 * over the honest record, THE STATIONS IN THE FROZEN ORDER (the
 * station-major discipline: each station is visited once, in the
 * BENCHMARKS_REJECTION_REASONS order, and names every offense it
 * sees) - malformed-record (the record, its carriers and its
 * benchmark entries), no-fork (every benchmark entry's extra keys,
 * before the record schema stations), unknown-key, missing-key,
 * bad-harness-id (THE REAL DH-01 harness-id alphabet import - the
 * FORM law), bad-industry (THE FROZEN-VOCABULARY LAW against the
 * REAL import), bad-stage, bad-history, the benchmark family laws
 * (the per-entry leg laws in the frozen entry-key order,
 * duplicate-benchmark-key, max-benchmarks). THE COMPLETE TABLE:
 * every violated station is reported, in the frozen walk order.
 * Empty benchmarks are LEGAL here (the floor fires at finalize,
 * never the record shape); stage-vs-payload consistency is the
 * ledger replay's cross-check, never this walk's. Ok carries the
 * canonical fixed-key-order copy.
 */
export function validateBenchmarksRecord(value: unknown): BenchmarksValidationOutcome<BenchmarksRecord> {
        const rejections: BenchmarksRejection[] = [];
        if (!isRecord(value)) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: ['record'],
                        detail: 'validateBenchmarksRecord: the record must be a plain object (never a silent partial verdict)',
                });
                return { ok: false, mode: 'shape', rejections };
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);

        // station 1 (malformed-record): the record's own carriers and the benchmark
        // entries' structural shapes (the entry-level array-leg carriers are their OWN
        // stations - bad-scenario-refs-carrier / bad-kpi-dimensions-carrier - mirroring
        // the landed family's split-station discipline, never a double report).
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'benchmarks') && !Array.isArray(record.benchmarks)) {
                carrierViolations.push('benchmarks');
        }
        if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
                carrierViolations.push('history');
        }
        if (Array.isArray(record.benchmarks)) {
                const benchmarks = record.benchmarks as unknown[];
                for (let i = 0; i < benchmarks.length; i += 1) {
                        const benchmark = benchmarks[i];
                        if (!isRecord(benchmark)) {
                                carrierViolations.push(`benchmarks[${i}]`);
                                continue;
                        }
                        const entry = benchmark as Record<string, unknown>;
                        for (const leg of ['benchmarkKey', 'summary', 'hypothesis', 'expectedOutcome', 'limitations'] as const) {
                                if (hasOwn(entry, leg) && typeof entry[leg] !== 'string') {
                                        carrierViolations.push(`benchmarks[${i}]:${leg}`);
                                }
                        }
                }
        }
        if (carrierViolations.length > 0) {
                rejections.push({
                        reason: 'malformed-record',
                        law: 'THE FAIL-CLOSED LAW',
                        items: carrierViolations,
                        detail: `validateBenchmarksRecord: a structural shape is malformed - the offending part(s) ${showList(carrierViolations)} (the record and every benchmark entry must be plain objects, the benchmarks / history carriers must be arrays, and the five text-leg carriers must be strings - never a silent partial verdict)`,
                });
        }

        // station 2 (no-fork): THE NO-FORK LAW's benchmark station, over every
        // walkable benchmark entry (before the record schema stations - the frozen
        // walk order).
        if (Array.isArray(record.benchmarks)) {
                const noForkItems: string[] = [];
                const benchmarks = record.benchmarks as unknown[];
                for (let i = 0; i < benchmarks.length; i += 1) {
                        if (!isRecord(benchmarks[i])) {
                                continue;
                        }
                        const extraKeys = Object.keys(benchmarks[i] as Record<string, unknown>).filter((key) => !(BENCHMARK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        for (const extraKey of extraKeys) {
                                noForkItems.push(`benchmarks[${i}]:${extraKey}`);
                        }
                }
                if (noForkItems.length > 0) {
                        rejections.push({
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: noForkItems,
                                detail: `validateBenchmarksRecord: a benchmark is CONFIGURATION - it grants NOTHING and executes NOTHING by itself; the extra key(s) ${showList(noForkItems)} are execution material and cannot appear on a benchmark entry`,
                        });
                }
        }

        // station 3 (unknown-key): the strict six-key schema is closed.
        const unknownKeys = keys.filter((key) => !(BENCHMARKS_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                rejections.push({
                        reason: 'unknown-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: unknownKeys,
                        detail: `validateBenchmarksRecord: the record schema is closed (THE SIX-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                });
        }

        // station 4 (missing-key): the strict schema requires every key.
        const missingKeys = (BENCHMARKS_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                rejections.push({
                        reason: 'missing-key',
                        law: 'THE FAIL-CLOSED LAW',
                        items: missingKeys,
                        detail: `validateBenchmarksRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
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
                        detail: 'validateBenchmarksRecord: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller\'s wiring, never this layer\'s)',
                });
        }

        // station 6 (bad-industry): THE FROZEN-VOCABULARY LAW against the REAL import.
        if (hasOwn(record, 'industry') && !isHarnessIndustry(record.industry)) {
                rejections.push({
                        reason: 'bad-industry',
                        law: 'THE FROZEN-VOCABULARY LAW',
                        items: [showValue(record.industry)],
                        detail: 'validateBenchmarksRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the benchmark definitions are industry-scoped)',
                });
        }

        // station 7 (bad-stage).
        // (the absent-key discipline: an absent stage is station 4's missing-key,
        // never a cascade here.)
        if (hasOwn(record, 'stage') && !isBenchmarkStage(record.stage)) {
                rejections.push({
                        reason: 'bad-stage',
                        law: 'THE FORWARD-ONLY LAW',
                        items: [showValue(record.stage)],
                        detail: 'validateBenchmarksRecord: the stage must be a member of the frozen BENCHMARK_STAGES list (composing -> composed; composed is TERMINAL)',
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
                                detail: 'validateBenchmarksRecord: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
                        });
                }
        }

        // stations 9-29 (the per-entry benchmark family laws), only walkable when the
        // carrier is an array; the per-entry stations skip the entries already refused
        // by station 1's shape walk (never a cascade over a malformed entry).
        if (Array.isArray(record.benchmarks)) {
                const benchmarks = record.benchmarks as unknown[];
                const walkable: { entry: Record<string, unknown>; index: number }[] = [];
                for (let i = 0; i < benchmarks.length; i += 1) {
                        if (isRecord(benchmarks[i])) {
                                walkable.push({ entry: benchmarks[i] as Record<string, unknown>, index: i });
                        }
                }

                // station 9 (benchmark-key-length): the bound, per walkable entry.
                const keyLengthItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.benchmarkKey !== 'string') {
                                continue;
                        }
                        const violations = textLengthViolationsOf(entry.benchmarkKey, BENCHMARK_KEY_MAX_LENGTH);
                        for (const violation of violations) {
                                keyLengthItems.push(`benchmarks[${index}]:${violation}`);
                        }
                }
                if (keyLengthItems.length > 0) {
                        rejections.push({
                                reason: 'benchmark-key-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyLengthItems,
                                detail: `validateBenchmarksRecord: every benchmarkKey must be a non-empty string of at most ${BENCHMARK_KEY_MAX_LENGTH} characters`,
                        });
                }

                // station 10 (benchmark-key-whitespace): the padding, per walkable entry.
                const keyWhitespaceItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.benchmarkKey !== 'string') {
                                continue;
                        }
                        if (entry.benchmarkKey !== entry.benchmarkKey.trim()) {
                                keyWhitespaceItems.push(`benchmarks[${index}]:leading/trailing whitespace`);
                        }
                }
                if (keyWhitespaceItems.length > 0) {
                        rejections.push({
                                reason: 'benchmark-key-whitespace',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyWhitespaceItems,
                                detail: 'validateBenchmarksRecord: every benchmarkKey must carry no leading or trailing whitespace',
                        });
                }

                // station 11 (benchmark-key-control-chars): the C0/DEL/C1 set, per walkable entry.
                const keyControlItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.benchmarkKey !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf(entry.benchmarkKey);
                        for (const control of controls) {
                                keyControlItems.push(`benchmarks[${index}]:${control}`);
                        }
                }
                if (keyControlItems.length > 0) {
                        rejections.push({
                                reason: 'benchmark-key-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyControlItems,
                                detail: 'validateBenchmarksRecord: every benchmarkKey must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 12 (summary-length): the bound, per walkable entry.
                const summaryLengthItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.summary !== 'string') {
                                continue;
                        }
                        const violations = textLengthViolationsOf(entry.summary, BENCHMARK_SUMMARY_MAX_LENGTH);
                        for (const violation of violations) {
                                summaryLengthItems.push(`benchmarks[${index}]:${violation}`);
                        }
                }
                if (summaryLengthItems.length > 0) {
                        rejections.push({
                                reason: 'summary-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryLengthItems,
                                detail: `validateBenchmarksRecord: every summary must be a non-empty string of at most ${BENCHMARK_SUMMARY_MAX_LENGTH} characters`,
                        });
                }

                // station 13 (summary-control-chars): the C0/DEL/C1 set, per walkable entry.
                const summaryControlItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.summary !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf(entry.summary);
                        for (const control of controls) {
                                summaryControlItems.push(`benchmarks[${index}]:${control}`);
                        }
                }
                if (summaryControlItems.length > 0) {
                        rejections.push({
                                reason: 'summary-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: summaryControlItems,
                                detail: 'validateBenchmarksRecord: every summary must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 14 (hypothesis-length): THE TESTABLE-HYPOTHESIS LAW's bound, per walkable entry.
                const hypothesisLengthItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.hypothesis !== 'string') {
                                continue;
                        }
                        const violations = textLengthViolationsOf(entry.hypothesis, BENCHMARK_HYPOTHESIS_MAX_LENGTH);
                        for (const violation of violations) {
                                hypothesisLengthItems.push(`benchmarks[${index}]:${violation}`);
                        }
                }
                if (hypothesisLengthItems.length > 0) {
                        rejections.push({
                                reason: 'hypothesis-length',
                                law: 'THE TESTABLE-HYPOTHESIS LAW',
                                items: hypothesisLengthItems,
                                detail: `validateBenchmarksRecord: every hypothesis must be a non-empty string of at most ${BENCHMARK_HYPOTHESIS_MAX_LENGTH} characters (a statement a run can confirm or refute)`,
                        });
                }

                // station 15 (hypothesis-control-chars): the C0/DEL/C1 set, per walkable entry.
                const hypothesisControlItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.hypothesis !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf(entry.hypothesis);
                        for (const control of controls) {
                                hypothesisControlItems.push(`benchmarks[${index}]:${control}`);
                        }
                }
                if (hypothesisControlItems.length > 0) {
                        rejections.push({
                                reason: 'hypothesis-control-chars',
                                law: 'THE TESTABLE-HYPOTHESIS LAW',
                                items: hypothesisControlItems,
                                detail: 'validateBenchmarksRecord: every hypothesis must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 16 (bad-scenario-refs-carrier): the carrier and its members, per walkable entry.
                const scenarioCarrierItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.scenarioRefs)) {
                                scenarioCarrierItems.push(`benchmarks[${index}]:scenarioRefs`);
                                continue;
                        }
                        const scenarioRefs = entry.scenarioRefs as unknown[];
                        for (let j = 0; j < scenarioRefs.length; j += 1) {
                                if (typeof scenarioRefs[j] !== 'string') {
                                        scenarioCarrierItems.push(`benchmarks[${index}]:scenarioRefs[${j}]`);
                                }
                        }
                }
                if (scenarioCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-scenario-refs-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: scenarioCarrierItems,
                                detail: 'validateBenchmarksRecord: every scenarioRefs must be a string array whose members are strings (the benchmark\'s scenario references over the REAL LAB-003 task-world registry)',
                        });
                }

                // station 17 (empty-scenario-refs): THE SCENARIO-BINDING LAW's entry floor, per walkable entry.
                const emptyScenarioItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.scenarioRefs)) {
                                continue;
                        }
                        if ((entry.scenarioRefs as unknown[]).length === 0) {
                                emptyScenarioItems.push(`benchmarks[${index}]:scenarioRefs`);
                        }
                }
                if (emptyScenarioItems.length > 0) {
                        rejections.push({
                                reason: 'empty-scenario-refs',
                                law: 'THE SCENARIO-BINDING LAW',
                                items: emptyScenarioItems,
                                detail: 'validateBenchmarksRecord: every benchmark entry must name at least one REAL task-world scenario (a benchmark with no scenario measures nothing - the entry-level floor, never the honest-gap law of the earlier families)',
                        });
                }

                // station 18 (duplicate-scenario-ref): the per-benchmark uniqueness law.
                const duplicateScenarioItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.scenarioRefs)) {
                                continue;
                        }
                        const scenarioRefs = (entry.scenarioRefs as unknown[]).filter((ref): ref is string => typeof ref === 'string');
                        const duplicates = findDuplicates(scenarioRefs);
                        for (const duplicate of duplicates) {
                                duplicateScenarioItems.push(`benchmarks[${index}]:${duplicate}`);
                        }
                }
                if (duplicateScenarioItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-scenario-ref',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicateScenarioItems,
                                detail: 'validateBenchmarksRecord: every scenarioRefs array must be duplicate-free (a scenario reference appears once per benchmark)',
                        });
                }

                // station 19 (dangling-scenario-ref): THE SCENARIO-BINDING LAW against the REAL
                // imported getScenario, per walkable entry.
                const danglingItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.scenarioRefs)) {
                                continue;
                        }
                        const scenarioRefs = (entry.scenarioRefs as unknown[]).filter((ref): ref is string => typeof ref === 'string');
                        for (const ref of scenarioRefs) {
                                if (getScenario(ref) === undefined) {
                                        danglingItems.push(`benchmarks[${index}]:${ref}`);
                                }
                        }
                }
                if (danglingItems.length > 0) {
                        rejections.push({
                                reason: 'dangling-scenario-ref',
                                law: 'THE SCENARIO-BINDING LAW',
                                items: danglingItems,
                                detail: `validateBenchmarksRecord: every scenarioRef must resolve against the REAL LAB-003 task-world registry (imported through getScenario - never a transcribed list; the offending ref(s) ${showList(danglingItems)} resolve to nothing)`,
                        });
                }

                // station 20 (bad-kpi-dimensions-carrier): the carrier and its members, per walkable entry.
                const kpiCarrierItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.kpiDimensions)) {
                                kpiCarrierItems.push(`benchmarks[${index}]:kpiDimensions`);
                                continue;
                        }
                        const kpiDimensions = entry.kpiDimensions as unknown[];
                        for (let j = 0; j < kpiDimensions.length; j += 1) {
                                if (typeof kpiDimensions[j] !== 'string') {
                                        kpiCarrierItems.push(`benchmarks[${index}]:kpiDimensions[${j}]`);
                                }
                        }
                }
                if (kpiCarrierItems.length > 0) {
                        rejections.push({
                                reason: 'bad-kpi-dimensions-carrier',
                                law: 'THE FAIL-CLOSED LAW',
                                items: kpiCarrierItems,
                                detail: 'validateBenchmarksRecord: every kpiDimensions must be a string array whose members are strings (the REAL evaluation vocabulary)',
                        });
                }

                // station 21 (empty-kpi-dimensions): THE KPI-VOCABULARY LAW's entry floor, per walkable entry.
                const emptyKpiItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.kpiDimensions)) {
                                continue;
                        }
                        if ((entry.kpiDimensions as unknown[]).length === 0) {
                                emptyKpiItems.push(`benchmarks[${index}]:kpiDimensions`);
                        }
                }
                if (emptyKpiItems.length > 0) {
                        rejections.push({
                                reason: 'empty-kpi-dimensions',
                                law: 'THE KPI-VOCABULARY LAW',
                                items: emptyKpiItems,
                                detail: 'validateBenchmarksRecord: every benchmark entry must name at least one REAL EvalDimension (a benchmark measuring nothing is a typed refusal)',
                        });
                }

                // station 22 (unknown-kpi-dimension): THE KPI-VOCABULARY LAW against the REAL
                // import census, per walkable entry.
                const unknownDimensionItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.kpiDimensions)) {
                                continue;
                        }
                        const kpiDimensions = (entry.kpiDimensions as unknown[]).filter((dimension): dimension is string => typeof dimension === 'string');
                        for (const dimension of kpiDimensions) {
                                if (!isEvalDimension(dimension)) {
                                        unknownDimensionItems.push(`benchmarks[${index}]:${dimension}`);
                                }
                        }
                }
                if (unknownDimensionItems.length > 0) {
                        rejections.push({
                                reason: 'unknown-kpi-dimension',
                                law: 'THE KPI-VOCABULARY LAW',
                                items: unknownDimensionItems,
                                detail: 'validateBenchmarksRecord: every kpiDimensions member must be a REAL EvalDimension (the imported evaluation vocabulary, derived from the real type census)',
                        });
                }

                // station 23 (duplicate-kpi-dimension): the per-benchmark uniqueness law.
                const duplicateDimensionItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!Array.isArray(entry.kpiDimensions)) {
                                continue;
                        }
                        const kpiDimensions = (entry.kpiDimensions as unknown[]).filter((dimension): dimension is string => typeof dimension === 'string');
                        const duplicates = findDuplicates(kpiDimensions);
                        for (const duplicate of duplicates) {
                                duplicateDimensionItems.push(`benchmarks[${index}]:${duplicate}`);
                        }
                }
                if (duplicateDimensionItems.length > 0) {
                        rejections.push({
                                reason: 'duplicate-kpi-dimension',
                                law: 'THE FAIL-CLOSED LAW',
                                items: duplicateDimensionItems,
                                detail: 'validateBenchmarksRecord: every kpiDimensions array must be duplicate-free (a KPI dimension appears once per benchmark)',
                        });
                }

                // station 24 (expected-outcome-length): the bound, per walkable entry.
                const outcomeLengthItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.expectedOutcome !== 'string') {
                                continue;
                        }
                        const violations = textLengthViolationsOf(entry.expectedOutcome, BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH);
                        for (const violation of violations) {
                                outcomeLengthItems.push(`benchmarks[${index}]:${violation}`);
                        }
                }
                if (outcomeLengthItems.length > 0) {
                        rejections.push({
                                reason: 'expected-outcome-length',
                                law: 'THE FAIL-CLOSED LAW',
                                items: outcomeLengthItems,
                                detail: `validateBenchmarksRecord: every expectedOutcome must be a non-empty string of at most ${BENCHMARK_EXPECTED_OUTCOME_MAX_LENGTH} characters`,
                        });
                }

                // station 25 (expected-outcome-control-chars): the C0/DEL/C1 set, per walkable entry.
                const outcomeControlItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.expectedOutcome !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf(entry.expectedOutcome);
                        for (const control of controls) {
                                outcomeControlItems.push(`benchmarks[${index}]:${control}`);
                        }
                }
                if (outcomeControlItems.length > 0) {
                        rejections.push({
                                reason: 'expected-outcome-control-chars',
                                law: 'THE FAIL-CLOSED LAW',
                                items: outcomeControlItems,
                                detail: 'validateBenchmarksRecord: every expectedOutcome must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 26 (limitations-length): THE LIMITATIONS DISCLOSURE's bound, per walkable entry.
                const limitationsLengthItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.limitations !== 'string') {
                                continue;
                        }
                        const violations = textLengthViolationsOf(entry.limitations, BENCHMARK_LIMITATIONS_MAX_LENGTH);
                        for (const violation of violations) {
                                limitationsLengthItems.push(`benchmarks[${index}]:${violation}`);
                        }
                }
                if (limitationsLengthItems.length > 0) {
                        rejections.push({
                                reason: 'limitations-length',
                                law: 'THE LIMITATIONS DISCLOSURE',
                                items: limitationsLengthItems,
                                detail: `validateBenchmarksRecord: every limitations statement must be a non-empty string of at most ${BENCHMARK_LIMITATIONS_MAX_LENGTH} characters (the honest statement of what this benchmark does NOT cover)`,
                        });
                }

                // station 27 (limitations-control-chars): the C0/DEL/C1 set, per walkable entry.
                const limitationsControlItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (typeof entry.limitations !== 'string') {
                                continue;
                        }
                        const controls = controlCharactersOf(entry.limitations);
                        for (const control of controls) {
                                limitationsControlItems.push(`benchmarks[${index}]:${control}`);
                        }
                }
                if (limitationsControlItems.length > 0) {
                        rejections.push({
                                reason: 'limitations-control-chars',
                                law: 'THE LIMITATIONS DISCLOSURE',
                                items: limitationsControlItems,
                                detail: 'validateBenchmarksRecord: every limitations statement must carry no control characters (C0/DEL/C1)',
                        });
                }

                // station 28 (bad-evidence-level): the REAL ladder membership, per walkable entry.
                const badEvidenceItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!hasOwn(entry, 'evidenceLevel')) {
                                continue;
                        }
                        if (!isLabEvidenceLevel(entry.evidenceLevel)) {
                                badEvidenceItems.push(`benchmarks[${index}]:${showValue(entry.evidenceLevel)}`);
                        }
                }
                if (badEvidenceItems.length > 0) {
                        rejections.push({
                                reason: 'bad-evidence-level',
                                law: 'THE FAIL-CLOSED LAW',
                                items: badEvidenceItems,
                                detail: 'validateBenchmarksRecord: every evidenceLevel must be a member of the REAL six-rung LabEvidenceLevel ladder (imported by reference)',
                        });
                }

                // station 29 (evidence-promotion): THE EVIDENCE-CEILING LAW, per walkable entry.
                const promotionItems: string[] = [];
                for (const { entry, index } of walkable) {
                        if (!hasOwn(entry, 'evidenceLevel')) {
                                continue;
                        }
                        const evidenceLevel = entry.evidenceLevel;
                        if (isLabEvidenceLevel(evidenceLevel) && !isBenchmarkEvidenceLevel(evidenceLevel)) {
                                promotionItems.push(`benchmarks[${index}]:${evidenceLevel}`);
                        }
                }
                if (promotionItems.length > 0) {
                        rejections.push({
                                reason: 'evidence-promotion',
                                law: 'THE EVIDENCE-CEILING LAW',
                                items: promotionItems,
                                detail: `validateBenchmarksRecord: every evidenceLevel must sit at or below the family's frozen ceiling ('fixture' / 'simulated') - a benchmark DEFINITION is never runtime evidence, never overstated (the offending rung(s) ${showList(promotionItems)})`,
                        });
                }

                // station 30 (duplicate-benchmark-key): the record-wide uniqueness law.
                const benchmarkKeyDuplicates = findDuplicates(
                        walkable
                                .filter(({ entry }) => typeof entry.benchmarkKey === 'string')
                                .map(({ entry }) => entry.benchmarkKey as string),
                );
                if (benchmarkKeyDuplicates.length > 0) {
                        rejections.push({
                                reason: 'duplicate-benchmark-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: benchmarkKeyDuplicates,
                                detail: 'validateBenchmarksRecord: benchmarkKeys must be unique within the record (a benchmark appears once)',
                        });
                }

                // station 31 (max-benchmarks): the composition bound.
                if (benchmarks.length > MAX_BENCHMARKS) {
                        rejections.push({
                                reason: 'max-benchmarks',
                                law: 'THE FAIL-CLOSED LAW',
                                items: [`${benchmarks.length} benchmarks`],
                                detail: `validateBenchmarksRecord: the record carries at most MAX_BENCHMARKS (${MAX_BENCHMARKS}) benchmarks (the composition bound)`,
                        });
                }
        }

        if (rejections.length > 0) {
                return { ok: false, mode: 'shape', rejections };
        }
        return { ok: true, value: canonicalBenchmarksRecord(record as unknown as BenchmarksRecord) };
}

/**
 * Pure deep shape guard: a well-formed benchmarks record (the deep
 * walk above, green). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isBenchmarksRecord(value: unknown): value is BenchmarksRecord {
        return validateBenchmarksRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * benchmarks record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the landed family algorithm: the frozen per-shape key
 * orders applied deeply, never an alphabetic re-sort). The record
 * keys emit in the BENCHMARKS_RECORD_SCHEMA_KEYS order, the
 * benchmark entries in the frozen eight-key order, and the history
 * notes in the BENCHMARKS_NOTE_SCHEMA_KEYS order. Throws TypeError
 * on a malformed record (never dishonest bytes).
 */
export function serializeBenchmarksRecord(record: unknown): string {
        if (!isBenchmarksRecord(record)) {
                throw new TypeError(
                        'serializeBenchmarksRecord: record must satisfy isBenchmarksRecord - no dishonest benchmarks record ever gets canonical bytes',
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
 *   unknown-key              - an extra key at the record, benchmark
 *                              or note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const BENCHMARKS_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type BenchmarksParseRejectionReason = (typeof BENCHMARKS_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isBenchmarksParseRejectionReason(value: unknown): value is BenchmarksParseRejectionReason {
        return (BENCHMARKS_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface BenchmarksParseRejection {
        readonly reason: BenchmarksParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type BenchmarksParseOutcome =
        | { readonly ok: true; readonly record: BenchmarksRecord }
        | { readonly ok: false; readonly rejection: BenchmarksParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / benchmark / note
 * level), or invalid content (the deep record walk) - each a typed
 * rejection naming the drift; never a silent partial parse.
 * First-failure-is-the-verdict, in the frozen
 * BENCHMARKS_PARSE_REJECTION_REASONS order.
 */
export function parseBenchmarksRecord(bytes: unknown): BenchmarksParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseBenchmarksRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
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
                                detail: `parseBenchmarksRecord: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseBenchmarksRecord: the bytes must carry a JSON object (the record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of BENCHMARKS_RECORD_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseBenchmarksRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.id !== 'string' || typeof record.harnessId !== 'string' || typeof record.industry !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.benchmarks) || !Array.isArray(record.history)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseBenchmarksRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(BENCHMARKS_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseBenchmarksRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict six-key record schema is closed)`,
                        },
                };
        }
        const benchmarks = record.benchmarks as unknown[];
        for (let i = 0; i < benchmarks.length; i += 1) {
                const benchmark = benchmarks[i];
                if (isRecord(benchmark)) {
                        const extraEntryKeys = Object.keys(benchmark as Record<string, unknown>).filter((key) => !(BENCHMARK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
                        if (extraEntryKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseBenchmarksRecord: the benchmark entry benchmarks[${i}] carries the unknown key '${extraEntryKeys[0]}' (a benchmark is the frozen eight keys only)`,
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
                                (key) => !(BENCHMARKS_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraNoteKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseBenchmarksRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateBenchmarksRecord(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseBenchmarksRecord: the parsed record fails the deep record walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
                        },
                };
        }
        return { ok: true, record: deep.value };
}

// --- internal helpers (never exported; the family's mirrored idioms) ---

/**
 * Collects one text leg's split stations (the bound and the
 * control-character set) into the rejection table (the entry walk's
 * shared idiom over the five text legs; each leg names its own
 * frozen reasons).
 */
function collectTextStation(
        rejections: BenchmarksRejection[],
        functionName: string,
        legName: string,
        text: string,
        maxLength: number,
        lengthReason: BenchmarksRejectionReason,
        whitespaceReason: BenchmarksRejectionReason,
        controlReason: BenchmarksRejectionReason,
        label: string,
): void {
        const lengthViolations = textLengthViolationsOf(text, maxLength);
        if (lengthViolations.length > 0) {
                pushOnce(rejections, lengthReason, 'THE FAIL-CLOSED LAW', lengthViolations, `${functionName}: ${label} must be a non-empty string of at most ${maxLength} characters`);
        }
        if (legName === 'benchmarkKey' && text !== text.trim()) {
                pushOnce(rejections, whitespaceReason, 'THE FAIL-CLOSED LAW', ['leading/trailing whitespace'], `${functionName}: ${label} must carry no leading or trailing whitespace`);
        }
        const controls = controlCharactersOf(text);
        if (controls.length > 0) {
                pushOnce(rejections, controlReason, 'THE FAIL-CLOSED LAW', controls, `${functionName}: ${label} must carry no control characters (C0/DEL/C1)`);
        }
}

/** Appends one rejection (the single-station idiom; the reason already frozen). */
function pushOnce(
        rejections: BenchmarksRejection[],
        reason: BenchmarksRejectionReason,
        law: string,
        items: readonly string[],
        detail: string,
): void {
        rejections.push({ reason, law, items, detail });
}

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

/** The text-leg bound violations (empty, over-length), as deterministic item strings. */
function textLengthViolationsOf(text: string, maxLength: number): string[] {
        const violations: string[] = [];
        if (text.length === 0) {
                violations.push('empty');
        }
        if (text.length > maxLength) {
                violations.push(`${text.length} chars`);
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
function isWellFormedNote(value: unknown): value is BenchmarkTransitionNote {
        if (!isRecord(value)) {
                return false;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...BENCHMARKS_NOTE_SCHEMA_KEYS].sort();
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
        if (record.fromStage !== null && !isBenchmarkStage(record.fromStage)) {
                return false;
        }
        if (!isBenchmarkStage(record.toStage)) {
                return false;
        }
        if (!isBenchmarkOpName(record.op)) {
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
function canonicalBenchmarksRecord(record: BenchmarksRecord): BenchmarksRecord {
        return canonicalRecordObject(record) as unknown as BenchmarksRecord;
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: BenchmarksRecord): Record<string, unknown> {
        return {
                id: record.id,
                harnessId: record.harnessId,
                industry: record.industry,
                stage: record.stage,
                benchmarks: record.benchmarks.map((benchmark) => ({
                        benchmarkKey: benchmark.benchmarkKey,
                        summary: benchmark.summary,
                        hypothesis: benchmark.hypothesis,
                        scenarioRefs: [...benchmark.scenarioRefs],
                        kpiDimensions: [...benchmark.kpiDimensions],
                        expectedOutcome: benchmark.expectedOutcome,
                        limitations: benchmark.limitations,
                        evidenceLevel: benchmark.evidenceLevel,
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
