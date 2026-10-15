/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-009 domain benchmark/simulation-worlds kit: the deterministic
 * staged-record runtime over the benchmarks contract vocabulary AND
 * the REAL DH-01 harness surfaces AND the REAL LAB-003 task-world
 * registry (imported, never re-implemented - THE IMPORT LAW, this
 * wave's charter; the registry is deterministic by construction -
 * NO catalog injection, so there is no second world authority, per
 * ARCHITECTURE-LOCK 12.6). The kit walks a record begin ->
 * addBenchmark / replaceBenchmarkSummary / removeBenchmark ->
 * finalizeBenchmarks: beginBenchmarks binds the record to a harness
 * through the REAL DH-01 harness-id alphabet (the FORM law -
 * isHarnessId, imported by reference; the EXISTENCE binding is the
 * caller's wiring and the AGREEMENT with the bound harness's own
 * industry is the caller's composition law, both pinned in the
 * battery through the real DH-01 kit) and mints the
 * flauz:ben:<16-hex> id from the injected rng (the benchmark
 * definitions are industry-scoped over the REAL frozen
 * HARNESS_INDUSTRIES list, imported by reference); the benchmark ops
 * apply the benchmark laws (shape, bounds, uniqueness, the
 * MAX_BENCHMARKS bound, THE SCENARIO-BINDING LAW against the REAL
 * imported getScenario - a fabricated scenario id refuses at add);
 * finalizeBenchmarks freezes the record (composing -> composed,
 * TERMINAL - the empty-benchmarks floor fires there, never the
 * record shape) AND re-proves the boundary laws: every scenarioRef
 * re-proven against the REAL getScenario (the typed
 * dangling-scenario-ref refusal naming each offending ref once, in
 * first-seen order - THE TWO-PHASE LAW: the add-time proof is
 * re-proven at the boundary), the complete-table record walk over
 * the composed record (the vocabulary legs re-proven: the KPI
 * dimensions against the REAL evaluation vocabulary and the evidence
 * ceiling against the REAL ladder), then the compose lands. THE
 * REMOVE+RE-ADD LAW: a benchmark's key is its identity - immutable
 * once added; only the summary is replaceable while composing.
 *
 * THE DETERMINISTIC EVALUATION SURFACE (the wave's measurement
 * layer, all over the frozen COMPOSED record - a composing record's
 * scenario set may still change, so its streams and scores are not
 * yet stable):
 * - instantiateBenchmark(benchmarksId, benchmarkKey, seed, count)
 *   delegates to the REAL generateInstances(scenarioId, seed, count)
 *   for each of the benchmark's scenarioRefs, in entry order (THE
 *   REPRODUCIBILITY LAW: same seed -> byte-identical instances - the
 *   battery pins two seeds; a pure read: no clock, no rng, no ledger
 *   line).
 * - evaluateBenchmark(benchmarksId, benchmarkKey, measures,
 *   evidenceLevelClaim?) composes typed EvalScore rows over the REAL
 *   EvalScore shape - the caller supplies the raw measure values and
 *   the kit NEVER invents scores (THE HONEST-MEASURE LAW: every
 *   declared KPI dimension must carry exactly one caller row - a
 *   missing row is the typed missing-measure refusal, never a
 *   zero-filled invention; a row outside the benchmark's declared
 *   KPI dimensions is the typed undeclared-dimension refusal; a
 *   non-REAL dimension is unknown-dimension; a non-finite value is
 *   malformed-measure-value). The typed benchmark-result record
 *   carries its evidenceLevel, NEVER above 'simulated' - the
 *   family's ceiling: an absent claim inherits the benchmark's own
 *   rung; a claim at or below the benchmark's rung is carried
 *   verbatim; a claim above the benchmark's rung is the typed
 *   evidence-promotion refusal (THE EVIDENCE-CEILING LAW - a
 *   benchmark run is never promoted above the DEFINITION's rung, and
 *   a definition never sits above the ceiling); a claim that is not
 *   even a real ladder rung is the typed bad-evidence-level refusal.
 * - reportCapabilityGaps(benchmarksId, inventory) - THE CAPABILITY-
 *   GAP HONESTY LAW: the typed gap ledger naming every benchmark
 *   scenario requirement (each scenarioRef) and every capability
 *   requirement (each resolved scenario's REAL taskTypeId, through
 *   the imported getScenario) NOT present in the CALLER-SUPPLIED
 *   inventory - honestly, never silently dropped, never invented; a
 *   benchmark with nothing missing carries no gap row (a zero-gap
 *   ledger is the green path); a malformed inventory is the typed
 *   malformed-inventory refusal.
 *
 * emitEvidenceRef emits the composed record's id as the evidenceRef
 * string - a pure read, only from a COMPOSED record (mirroring the
 * landed DH-005 emitWorkflowRef pattern); the emitted reference
 * rides the REAL DH-02 review composition's evidenceRefs family
 * (validateOnboardingReviewComposition - imported by the battery,
 * never re-implemented here).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * family laws EXACTLY): the same .flauz/harness subtree, distinct
 * files - the append-only ops ledger
 * .flauz/harness/benchmarks-ops.jsonl (one canonical JSON line per
 * applied op, the seq strictly increasing and equal to the line
 * number) and the envelope .flauz/harness/benchmarks-records.json
 * ({ contractVersion, seq, records }). The ledger is authoritative;
 * the finalize line carries a NULL payload (the boundary authority
 * is the REAL imported task-world registry, never a caller-supplied
 * record - this wave's honest deviation from the DH-006/DH-007
 * finalize-payload precedent: the registry is code, not data, so it
 * cannot be ledger-carried; the replay re-proves the boundary laws
 * from the ledger's own payloads THROUGH the imported registry);
 * loadBenchmarksKit replays it and cross-checks the envelope
 * byte-for-byte (a torn or missing line is the typed E_LEDGER_TORN;
 * a divergent envelope is the typed E_ENVELOPE_MISMATCH - never
 * silently rebuilt; every add/replace line's payload re-walked, the
 * replace line's immutable-parts cross-checked, the remove line's
 * entry-as-it-stood cross-checked, the finalize floor + scenario
 * binding + vocabulary legs re-proved). A version-bearing surface
 * (a ledger line or the envelope) carrying another contract version
 * is the typed version-mismatch - THE SINGLE-VERSION LAW's live
 * station in this family (the six-key record carries no version
 * field). Lazy persistence (the subtree lands with the first applied
 * op); a fresh kit never appends over a non-empty benchmarks ledger
 * - reopen with loadBenchmarksKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE IMPORT
 * LAW, THE SCENARIO-BINDING LAW, THE KPI-VOCABULARY LAW, THE
 * EVIDENCE-CEILING LAW, THE HONEST-MEASURE LAW, THE CAPABILITY-GAP
 * HONESTY LAW, THE REPRODUCIBILITY LAW, THE FORWARD-ONLY LAW / THE
 * APPEND-ONLY LINEAGE LAW, THE REMOVE+RE-ADD LAW, THE NO-FORK LAW,
 * THE TESTABLE-HYPOTHESIS LAW, THE LIMITATIONS DISCLOSURE, THE
 * CONTENT LAW (no per-industry benchmark content is shipped - the
 * wave is the LAYER, the machinery; the caller composes the
 * benchmarks; this family never invents them), THE DETERMINISM LAW
 * (no Math.random, no Date.now, no new Date(...) and no process.env
 * in this module - law comments excepted; the clock, the rng and
 * the fsPort are INJECTED seams; the factory consumes exactly ONE
 * clock read and ONE rng read; the read ops consume NONE), THE
 * FAIL-CLOSED LAW (factory misuse throws TypeError; every domain
 * refusal is a typed record { reason, law, detail, items? }; a
 * refused op leaves the record unchanged; payload-walk refusals
 * carry the COMPLETE contract rejection table), THE SINGLE-VERSION
 * LAW (the re-export chain), THE APPEND-ONLY LEDGER LAW, THE DISPOSE
 * LAW (every operation after disposeBenchmarks rejects with the
 * typed DISPOSED refusal).
 */

import {
        MAX_BENCHMARKS,
        BENCHMARKS_CONTRACTS_VERSION,
        BENCHMARK_ID_PREFIX,
        BENCHMARKS_REJECTION_REASONS,
        isEvalDimension,
        isHarnessId,
        isHarnessIndustry,
        isBenchmarkId,
        isBenchmarkOpName,
        isBenchmarkStage,
        isLabEvidenceLevel,
        labEvidenceLevelRank,
        serializeBenchmarksRecord,
        validateBenchmarkEntry,
        validateBenchmarkSummary,
        validateBenchmarksRecord,
} from './benchmarksContract.js';
import type {
        BenchmarkEntry,
        BenchmarkOpName,
        BenchmarkStage,
        BenchmarkTransitionNote,
        BenchmarksRecord,
        BenchmarksRejection,
} from './benchmarksContract.js';
import { generateInstances, getScenario } from '../../../lab/common/taskWorlds.js';
import type { WorldInstance } from '../../../lab/common/taskWorlds.js';
import type { EvalScore, LabEvidenceLevel } from '../../../lab/common/labContracts.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { BENCHMARKS_CONTRACTS_VERSION } from './benchmarksContract.js';

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

/** THE SINGLE-VERSION LAW (the re-export chain): the REAL LAB contracts version pin, re-carried by reference. */
export { LAB_CONTRACTS_VERSION } from '../../../lab/common/labContracts.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as the landed families, distinct file). */
export const BENCHMARKS_ENVELOPE_RELATIVE_PATH = '.flauz/harness/benchmarks-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const BENCHMARKS_LEDGER_RELATIVE_PATH = '.flauz/harness/benchmarks-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the industry on begin, the benchmark entry on the
 * benchmark ops, and NULL on finalize - the boundary authority is
 * the REAL imported task-world registry, never a caller-supplied
 * record).
 */
export const BENCHMARKS_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'benchmarksId',
        'harnessId',
        'fromStage',
        'toStage',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const BENCHMARKS_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only benchmark ops ledger line (the canonical persisted
 * op): the seq (equal to the line number), the clock reading, the
 * contract version, the op name, the record id, the BOUND harness id
 * (the REAL DH-01 flauz:hrn:<16-hex> form, carried on every line),
 * the stage edge walked (fromStage null ONLY on the begin line; the
 * benchmark ops walk the composing->composing self edge - the
 * organization composes its benchmark definitions gradually), the
 * granting law, the canonical op payload (the industry on begin; the
 * added / replacement / removed-as-it-stood benchmark entry on the
 * benchmark ops; null on finalize - the boundary authority is the
 * imported registry), and the deterministic detail sentence.
 */
export interface BenchmarksOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: BenchmarkOpName;
        readonly benchmarksId: string;
        readonly harnessId: string;
        readonly fromStage: BenchmarkStage | null;
        readonly toStage: BenchmarkStage;
        readonly law: string;
        readonly payload: HarnessIndustry | BenchmarkEntry | null;
        readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * BENCHMARKS_REJECTION_REASONS; the contract's thirty-one stations
 * are the PURE record walk - this wave's work order froze that list -
 * so the kit-layer domain stations are declared ONCE here, the landed
 * family precedent's single-declaration discipline placed one level
 * up):
 *   unknown-record        - no record resolves under the id (a
 *                           malformed id fails closed as unknown);
 *   version-mismatch      - THE SINGLE-VERSION LAW: a
 *                           version-bearing persisted surface (a
 *                           ledger line or the envelope) carries a
 *                           contract version other than
 *                           BENCHMARKS_CONTRACTS_VERSION (the
 *                           six-key record carries no version field -
 *                           THIS is the law's live station);
 *   empty-benchmarks      - THE BENCHMARK LAWS' floor: the finalize
 *                           boundary requires at least one composed
 *                           benchmark (a composing record may hold
 *                           zero);
 *   premature-op          - THE FORWARD-ONLY LAW: the op precedes its
 *                           precondition (an evidence ref emitted, a
 *                           benchmark instantiated, an evaluation
 *                           composed or a gap ledger reported while
 *                           the record is still at 'composing' - the
 *                           measurement surface runs ONLY over a
 *                           frozen COMPOSED definition);
 *   stale-stage           - THE FORWARD-ONLY LAW: the op is behind
 *                           the walk (a mutating op on a composed
 *                           record - 'composed' is TERMINAL, the
 *                           record is FROZEN; a changed benchmark is
 *                           a NEW record, THE APPEND-ONLY LINEAGE
 *                           LAW);
 *   unknown-benchmark     - the benchmarkKey names no benchmark in
 *                           the record (a malformed benchmarkKey
 *                           fails closed as unknown);
 *   bad-instance-request  - THE REPRODUCIBILITY LAW: the
 *                           instantiation request is malformed (the
 *                           seed is not an integer, or the count is
 *                           not a positive integer);
 *   malformed-measures    - THE HONEST-MEASURE LAW: the
 *                           caller-supplied measures are not an
 *                           array of EvalScore-shaped rows ({ dimension,
 *                           value, unit? } - a row is not an object, a
 *                           row carries an unknown key, the dimension
 *                           is not a string, the value is not a
 *                           number, or the unit is not a non-empty
 *                           string);
 *   unknown-dimension     - THE HONEST-MEASURE LAW: a measure row's
 *                           dimension is not a REAL EvalDimension
 *                           (the imported evaluation vocabulary);
 *   undeclared-dimension  - THE HONEST-MEASURE LAW: a measure row's
 *                           dimension is a REAL EvalDimension but
 *                           sits outside the benchmark's declared
 *                           kpiDimensions (only the declared KPIs are
 *                           scored);
 *   malformed-measure-value - THE HONEST-MEASURE LAW: a measure
 *                           row's value is not a finite number
 *                           (NaN / Infinity / -Infinity refused);
 *   missing-measure       - THE HONEST-MEASURE LAW: a declared KPI
 *                           dimension carries no caller row - the kit
 *                           NEVER invents the missing score (never a
 *                           zero-filled invention);
 *   duplicate-measure     - THE HONEST-MEASURE LAW: two measure rows
 *                           claim the same dimension;
 *   malformed-inventory   - THE CAPABILITY-GAP HONESTY LAW: the
 *                           caller-supplied capability inventory is
 *                           not a string array (a fabricated shape
 *                           resolves nothing, never a silent skip);
 *   DISPOSED              - THE DISPOSE LAW: the kit was disposed;
 *                           every operation after disposeBenchmarks
 *                           rejects;
 *   CORRUPT_SEAM          - THE DETERMINISM LAW: the injected clock or
 *                           rng returned a malformed value mid-op (an
 *                           empty clock reading, a non-16-hex rng
 *                           output, a duplicate minted record id);
 *   E_LEDGER_TORN         - THE APPEND-ONLY LEDGER LAW: a torn or
 *                           missing benchmarks ledger line, a
 *                           structurally invalid or out-of-order
 *                           line, an unknown op or an illegal stage
 *                           edge inside the ledger, a payload that
 *                           fails its walk (the replay re-proves THE
 *                           SCENARIO-BINDING LAW and the vocabulary
 *                           legs from the ledger alone), or a fresh
 *                           kit attempting to append over an existing
 *                           non-empty benchmarks ledger (reopen with
 *                           loadBenchmarksKit);
 *   E_ENVELOPE_MISMATCH   - THE APPEND-ONLY LEDGER LAW: the
 *                           benchmarks envelope diverges from the
 *                           ledger replay (or is missing / malformed
 *                           while the ledger carries lines) - never
 *                           silently rebuilt;
 *   BENCHMARKS_IO         - THE FAIL-CLOSED LAW: the injected fs port
 *                           refused a read / append / write / mkdir
 *                           on the benchmarks family's own files;
 *   UNKNOWN_FILTER        - THE FAIL-CLOSED LAW:
 *                           listBenchmarksSessions received an
 *                           unknown filter field or a non-member
 *                           filter value.
 */
export const BENCHMARKS_KIT_EXTRA_REFUSAL_REASONS = [
        'unknown-record',
        'version-mismatch',
        'empty-benchmarks',
        'premature-op',
        'stale-stage',
        'unknown-benchmark',
        'bad-instance-request',
        'malformed-measures',
        'unknown-dimension',
        'undeclared-dimension',
        'malformed-measure-value',
        'missing-measure',
        'duplicate-measure',
        'malformed-inventory',
        'DISPOSED',
        'CORRUPT_SEAM',
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'BENCHMARKS_IO',
        'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 31 domain reasons plus the kit-layer extras. */
export const BENCHMARKS_KIT_REFUSAL_REASONS = [
        ...BENCHMARKS_REJECTION_REASONS,
        ...BENCHMARKS_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type BenchmarksKitRefusalReason = (typeof BENCHMARKS_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isBenchmarksKitRefusalReason(value: unknown): value is BenchmarksKitRefusalReason {
        return (BENCHMARKS_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface BenchmarksKitRefusal {
        readonly reason: BenchmarksKitRefusalReason;
        readonly law: string;
        readonly detail: string;
        readonly items?: readonly string[];
        /** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
        readonly rejections?: readonly BenchmarksRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog and NO world authority: THE IMPORT LAW - the scenario
 * registry is the REAL imported LAB-003 module (deterministic by
 * construction, no catalog injection; the measurement and gap
 * surfaces read it directly).
 */
export interface BenchmarksKitOptions {
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
export type BenchmarksRecordOutcome =
        | { readonly ok: true; readonly record: BenchmarksRecord }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/** The ref outcome: ok carries the emitted evidenceRef string; failure carries the typed refusal. */
export type BenchmarksRefOutcome =
        | { readonly ok: true; readonly evidenceRef: string }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/**
 * One scenario's deterministic instance stream inside an
 * instantiation bundle (the REAL WorldInstance rows, generated by the
 * REAL imported generator).
 */
export interface BenchmarkScenarioInstances {
        readonly scenarioId: string;
        readonly instances: readonly WorldInstance[];
}

/**
 * THE REPRODUCIBILITY LAW's bundle: the instantiated benchmark, the
 * pinned seed, the requested per-scenario count, and the per-scenario
 * instance streams (one per scenarioRef, in the benchmark's entry
 * order; same seed -> byte-identical bundle).
 */
export interface BenchmarkInstanceBundle {
        readonly benchmarkKey: string;
        readonly seed: number;
        readonly count: number;
        readonly scenarioInstances: readonly BenchmarkScenarioInstances[];
}

/** The instantiation outcome: ok carries the bundle; failure carries the typed refusal. */
export type BenchmarkInstancesOutcome =
        | { readonly ok: true; readonly bundle: BenchmarkInstanceBundle }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/**
 * THE HONEST-MEASURE LAW's typed benchmark-result record: the
 * benchmarks record id, the bound harness id, the evaluated
 * benchmarkKey, the composed EvalScore rows (caller-supplied values,
 * canonical kpiDimensions order), and the result's evidenceLevel -
 * NEVER above 'simulated' (the family's ceiling; the claim walk's
 * honest floor).
 */
export interface BenchmarkEvaluationResult {
        readonly benchmarksId: string;
        readonly harnessId: string;
        readonly benchmarkKey: string;
        readonly scores: readonly EvalScore[];
        readonly evidenceLevel: LabEvidenceLevel;
}

/** The evaluation outcome: ok carries the result record; failure carries the typed refusal. */
export type BenchmarkEvaluationOutcome =
        | { readonly ok: true; readonly result: BenchmarkEvaluationResult }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/**
 * THE CAPABILITY-GAP HONESTY LAW's gap row: the benchmark key and
 * its missing requirements (every scenarioRef and every resolved
 * scenario's taskTypeId NOT present in the caller-supplied
 * inventory, each named once, first-seen order) - the frozen
 * two-key shape.
 */
export interface BenchmarkGap {
        readonly benchmarkKey: string;
        readonly missing: readonly string[];
}

/** The capability-gap outcome: ok carries the gap ledger (empty = the zero-gap green path); failure carries the typed refusal. */
export type BenchmarkGapsOutcome =
        | { readonly ok: true; readonly gaps: readonly BenchmarkGap[] }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/** The list outcome: ok carries the id-ordered honest records; failure carries the typed refusal. */
export type BenchmarksListOutcome =
        | { readonly ok: true; readonly records: readonly BenchmarksRecord[] }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type BenchmarksLoadOutcome =
        | { readonly ok: true; readonly kit: BenchmarksKit }
        | { readonly ok: false; readonly refusal: BenchmarksKitRefusal };

/**
 * The deterministic domain-benchmarks kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the record unchanged (inspectable before and
 * after). The read surface (emitEvidenceRef / instantiateBenchmark /
 * evaluateBenchmark / reportCapabilityGaps / inspectBenchmarks /
 * listBenchmarksSessions) consumes NO clock read and NO rng read and
 * lands NO ledger line.
 */
export interface BenchmarksKit {
        beginBenchmarks(harnessId: unknown, industry: unknown): Promise<BenchmarksRecordOutcome>;
        addBenchmark(benchmarksId: unknown, benchmark: unknown): Promise<BenchmarksRecordOutcome>;
        replaceBenchmarkSummary(benchmarksId: unknown, benchmarkKey: unknown, summary: unknown): Promise<BenchmarksRecordOutcome>;
        removeBenchmark(benchmarksId: unknown, benchmarkKey: unknown): Promise<BenchmarksRecordOutcome>;
        finalizeBenchmarks(benchmarksId: unknown): Promise<BenchmarksRecordOutcome>;
        emitEvidenceRef(benchmarksId: unknown): Promise<BenchmarksRefOutcome>;
        instantiateBenchmark(benchmarksId: unknown, benchmarkKey: unknown, seed: unknown, count: unknown): Promise<BenchmarkInstancesOutcome>;
        evaluateBenchmark(benchmarksId: unknown, benchmarkKey: unknown, measures: unknown, evidenceLevelClaim?: unknown): Promise<BenchmarkEvaluationOutcome>;
        reportCapabilityGaps(benchmarksId: unknown, inventory: unknown): Promise<BenchmarkGapsOutcome>;
        inspectBenchmarks(benchmarksId: unknown): Promise<BenchmarksRecordOutcome>;
        listBenchmarksSessions(filter?: unknown): Promise<BenchmarksListOutcome>;
        disposeBenchmarks(): void;
}

/**
 * Creates a domain-benchmarks kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02/DH-03/
 * DH-04/DH-05/DH-06/DH-007 factory walk EXACTLY (the same
 * preconditions, the same message shapes, the createBenchmarksKit
 * prefix): the options shape (clock / rng), the clock's first read
 * (a non-empty ISO string), the rng's first read (exactly 16
 * lowercase hex chars - the id-minting law), and the fsPort/root
 * pairing (both or neither; the port must expose readFile /
 * writeFile / appendFile / mkdir). The factory consumes exactly ONE
 * clock read and ONE rng read (there is no inner kit to re-validate
 * the seams - the battery pins the exact count). The kit starts with
 * ZERO records; persistence is LAZY (the .flauz/harness subtree lands
 * with the first applied op; a fresh kit never appends over an
 * existing non-empty benchmarks ledger - reopen with
 * loadBenchmarksKit).
 */
export function createBenchmarksKit(options: BenchmarksKitOptions): BenchmarksKit {
        const bound = validateKitOptions(options, false, 'createBenchmarksKit');
        return buildBenchmarksKit(bound, { seq: 0, records: new Map<string, BenchmarksRecord>() });
}

/**
 * Reopens a persisted domain-benchmarks kit: replays the append-only
 * benchmarks ops ledger (the authoritative surface - each line
 * re-validated: the frozen eleven-key line schema, the REAL DH-01
 * harness-id alphabet on every line, the op's stage edge, the
 * payload's full walk (THE SCENARIO-BINDING LAW re-proved from the
 * ledger alone), the MAX_BENCHMARKS bound, the replace line's
 * immutable-parts cross-check, the remove line's entry-as-it-stood
 * cross-check, the finalize floor AND the finalize boundary laws -
 * every scenarioRef re-proven against the REAL getScenario, the
 * vocabulary legs re-proven), and cross-checks the envelope
 * byte-for-byte against the replay-built state. A torn or missing
 * benchmarks ledger line is the typed E_LEDGER_TORN; a divergent,
 * missing or malformed envelope is the typed E_ENVELOPE_MISMATCH
 * (never silently rebuilt); a version-bearing surface carrying
 * another contract version is the typed version-mismatch (THE
 * SINGLE-VERSION LAW's live station); a refused fs port is the typed
 * BENCHMARKS_IO. A fresh root (no files) reopens as an empty kit.
 * The options require BOTH fsPort and root (the load is a
 * persistence-surface operation).
 */
export async function loadBenchmarksKit(options: BenchmarksKitOptions): Promise<BenchmarksLoadOutcome> {
        const bound = validateKitOptions(options, true, 'loadBenchmarksKit');
        const fsPort = bound.fsPort as HarnessFsPort;
        const ledgerPath = `${bound.root}/${BENCHMARKS_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}`;
        try {
                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `loadBenchmarksKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `loadBenchmarksKit: the fs port refused the benchmarks ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `loadBenchmarksKit: the fs port refused the benchmarks envelope read: ${toMessage(error)}`) };
        }
        const replay = replayBenchmarksLedger(ledgerText);
        if (!('lines' in replay)) {
                return { ok: false, refusal: replay };
        }
        const crossCheck = crossCheckBenchmarksEnvelope(envelopeText, replay.lines.length, replay.records);
        if (crossCheck !== null) {
                return { ok: false, refusal: crossCheck };
        }
        return { ok: true, kit: buildBenchmarksKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly fsPort: HarnessFsPort | null;
        readonly root: string | null;
}

interface BenchmarksKitState {
        readonly seq: number;
        readonly records: ReadonlyMap<string, BenchmarksRecord>;
}

/** The persist fold's result: applied means the benchmarks ledger line landed (the ledger is authoritative). */
type PersistResult =
        | { readonly applied: false; readonly refusal: BenchmarksKitRefusal }
        | { readonly applied: true; readonly refusal: BenchmarksKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: BenchmarksKitRefusal };

function validateKitOptions(options: BenchmarksKitOptions, requirePersistence: boolean, factoryName: 'createBenchmarksKit' | 'loadBenchmarksKit'): BoundOptions {
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
                        `${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${BENCHMARK_ID_PREFIX}<16-hex>)`,
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
        reason: BenchmarksKitRefusalReason,
        law: string,
        detail: string,
        items?: readonly string[],
): BenchmarksKitRefusal {
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
        outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly BenchmarksRejection[] },
): BenchmarksKitRefusal {
        const first = outcome.rejections[0];
        return {
                reason: first.reason,
                law: first.law,
                detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
                items: first.items,
                rejections: outcome.rejections,
        };
}

function buildBenchmarksKit(bound: BoundOptions, seed: BenchmarksKitState): BenchmarksKit {
        let disposed = false;
        let mutableSeq = seed.seq;
        const records = new Map<string, BenchmarksRecord>(seed.records);
        const persisted = bound.fsPort !== null && bound.root !== null;
        const fsPort = bound.fsPort;
        const ledgerPath = bound.root !== null ? `${bound.root}/${BENCHMARKS_LEDGER_RELATIVE_PATH}` : '';
        const envelopePath = bound.root !== null ? `${bound.root}/${BENCHMARKS_ENVELOPE_RELATIVE_PATH}` : '';
        let dirEnsured = false;
        // A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
        // (its ledger preexists; only a fresh createBenchmarksKit guards the append).
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

        function copyRecord(record: BenchmarksRecord): BenchmarksRecord {
                return JSON.parse(serializeBenchmarksRecord(record)) as BenchmarksRecord;
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
        async function persist(line: BenchmarksOpsLedgerLine, nextRecords: Map<string, BenchmarksRecord>): Promise<PersistResult> {
                if (!persisted || fsPort === null) {
                        mutableSeq = line.seq;
                        return { applied: true, refusal: null };
                }
                if (!ledgerGuardDone) {
                        let existing: string | null;
                        try {
                                existing = await readText(fsPort, ledgerPath);
                        } catch (error) {
                                return { applied: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the benchmarks ledger read: ${toMessage(error)}`) };
                        }
                        if (existing !== null && existing.trim().length > 0) {
                                return {
                                        applied: false,
                                        refusal: refused(
                                                'E_LEDGER_TORN',
                                                'THE APPEND-ONLY LEDGER LAW',
                                                'persist: the benchmarks ledger already carries lines - reopen with loadBenchmarksKit (a fresh kit never appends over an existing ledger)',
                                        ),
                                };
                        }
                        ledgerGuardDone = true;
                }
                if (!dirEnsured) {
                        try {
                                await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                        } catch (error) {
                                return { applied: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
                        }
                        dirEnsured = true;
                }
                try {
                        await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
                } catch (error) {
                        return { applied: false, refusal: refused('BENCHMARKS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the benchmarks ledger append: ${toMessage(error)} (nothing was applied)`) };
                }
                mutableSeq = line.seq;
                try {
                        await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
                } catch (error) {
                        return {
                                applied: true,
                                refusal: refused(
                                        'BENCHMARKS_IO',
                                        'THE FAIL-CLOSED LAW',
                                        `persist: the benchmarks ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
                                ),
                        };
                }
                return { applied: true, refusal: null };
        }

        function commit(nextRecords: Map<string, BenchmarksRecord>): void {
                records.clear();
                for (const [id, record] of nextRecords) {
                        records.set(id, record);
                }
        }

        function recordOutcome(record: BenchmarksRecord): BenchmarksRecordOutcome {
                return { ok: true, record: copyRecord(record) };
        }

        /** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
        function refuseIfDisposed(opName: string): BenchmarksKitRefusal | null {
                if (disposed) {
                        return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after disposeBenchmarks rejects`);
                }
                return null;
        }

        /** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
        function lookupRecord(opName: string, benchmarksId: unknown): { record: BenchmarksRecord } | { refusal: BenchmarksKitRefusal } {
                if (!isBenchmarkId(benchmarksId)) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(benchmarksId)}' (a malformed id fails closed as unknown-record)`) };
                }
                const record = records.get(benchmarksId);
                if (record === undefined) {
                        return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${benchmarksId}'`) };
                }
                return { record };
        }

        /**
         * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
         * 'composing' stage (a composed record is past them - stale-stage,
         * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
         */
        function stageGuard(opName: string, record: BenchmarksRecord): BenchmarksKitRefusal | null {
                if (record.stage === 'composing') {
                        return null;
                }
                return refused(
                        'stale-stage',
                        'THE FORWARD-ONLY LAW',
                        `${opName}: the record is at the '${record.stage}' stage - the record is FROZEN ('composed' is TERMINAL; a changed benchmark is a NEW benchmark, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
                        [record.stage],
                );
        }

        /**
         * THE FORWARD-ONLY LAW's measurement guard: the read surface
         * (emit / instantiate / evaluate / gaps) runs ONLY over a frozen
         * COMPOSED definition (a composing record's scenario set may
         * still change - its streams and scores are not yet stable).
         */
        function composedGuard(opName: string, record: BenchmarksRecord): BenchmarksKitRefusal | null {
                if (record.stage === 'composed') {
                        return null;
                }
                return refused(
                        'premature-op',
                        'THE FORWARD-ONLY LAW',
                        `${opName}: the record is at the '${record.stage}' stage - the measurement surface runs ONLY over a frozen COMPOSED definition (finalizeBenchmarks first; a composing record's scenario set may still change)`,
                        [record.stage],
                );
        }

        /** The benchmark lookup for replace / remove / instantiate / evaluate (a malformed benchmarkKey fails closed as unknown-benchmark). */
        function findBenchmark(record: BenchmarksRecord, benchmarkKey: unknown): BenchmarkEntry | null {
                if (typeof benchmarkKey !== 'string') {
                        return null;
                }
                const found = record.benchmarks.find((entry) => entry.benchmarkKey === benchmarkKey);
                return found === undefined ? null : found;
        }

        return {
                async beginBenchmarks(harnessId: unknown, industry: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('beginBenchmarks');
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
                                                `beginBenchmarks: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
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
                                                `beginBenchmarks: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the benchmark definitions are industry-scoped)`,
                                                [showValue(industry)],
                                        ),
                                };
                        }
                        const hex = bound.rng();
                        if (!/^[0-9a-f]{16}$/.test(hex)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginBenchmarks: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
                        }
                        const benchmarksId = `${BENCHMARK_ID_PREFIX}${hex}`;
                        if (records.has(benchmarksId)) {
                                return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginBenchmarks: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `began the domain-benchmarks record bound to harness '${harnessId}' over the '${industry}' industry (the walk enters the composing stage with ZERO benchmarks; the caller composes the definitions - this family never invents them, THE CONTENT LAW)`;
                        const record: BenchmarksRecord = {
                                id: benchmarksId,
                                harnessId,
                                industry,
                                stage: 'composing',
                                benchmarks: [],
                                history: [
                                        { at, fromStage: null, toStage: 'composing', op: 'begin-benchmarks', law: 'THE FORWARD-ONLY LAW', detail },
                                ],
                        };
                        const line: BenchmarksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BENCHMARKS_CONTRACTS_VERSION,
                                op: 'begin-benchmarks',
                                benchmarksId,
                                harnessId,
                                fromStage: null,
                                toStage: 'composing',
                                law: 'THE FORWARD-ONLY LAW',
                                payload: industry,
                                detail,
                        };
                        const nextRecords = new Map(records);
                        nextRecords.set(benchmarksId, record);
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
                async addBenchmark(benchmarksId: unknown, benchmark: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('addBenchmark');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('addBenchmark', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('addBenchmark', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const verdict = validateBenchmarkEntry(benchmark);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('addBenchmark', verdict) };
                        }
                        const entry = verdict.value;
                        if (record.benchmarks.some((existing) => existing.benchmarkKey === entry.benchmarkKey)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'duplicate-benchmark-key',
                                                'THE FAIL-CLOSED LAW',
                                                `addBenchmark: the benchmarkKey '${entry.benchmarkKey}' is already composed (a benchmark appears once)`,
                                                [entry.benchmarkKey],
                                        ),
                                };
                        }
                        if (record.benchmarks.length >= MAX_BENCHMARKS) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'max-benchmarks',
                                                'THE FAIL-CLOSED LAW',
                                                `addBenchmark: the record already carries ${record.benchmarks.length} benchmarks - the composition bound is MAX_BENCHMARKS (${MAX_BENCHMARKS})`,
                                                [`${record.benchmarks.length} benchmarks`],
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `added the benchmark '${entry.benchmarkKey}' (a benchmark is CONFIGURATION - it grants NOTHING and executes NOTHING by itself; its ${entry.scenarioRefs.length} scenarioRef(s) are proven against the REAL LAB task-world registry at this station - THE SCENARIO-BINDING LAW)`;
                        const next: BenchmarksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                benchmarks: [...record.benchmarks, entry],
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-benchmark', law: 'THE NO-FORK LAW', detail }],
                        };
                        const line: BenchmarksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BENCHMARKS_CONTRACTS_VERSION,
                                op: 'add-benchmark',
                                benchmarksId: record.id,
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
                async replaceBenchmarkSummary(benchmarksId: unknown, benchmarkKey: unknown, summary: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('replaceBenchmarkSummary');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('replaceBenchmarkSummary', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('replaceBenchmarkSummary', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findBenchmark(record, benchmarkKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-benchmark',
                                                'THE FAIL-CLOSED LAW',
                                                `replaceBenchmarkSummary: no benchmark '${showValue(benchmarkKey)}' in the record (a malformed benchmarkKey fails closed as unknown-benchmark)`,
                                        ),
                                };
                        }
                        const verdict = validateBenchmarkSummary(summary);
                        if (!verdict.ok) {
                                return { ok: false, refusal: payloadRefused('replaceBenchmarkSummary', verdict) };
                        }
                        const replacement: BenchmarkEntry = {
                                benchmarkKey: existing.benchmarkKey,
                                summary: verdict.value,
                                hypothesis: existing.hypothesis,
                                scenarioRefs: [...existing.scenarioRefs],
                                kpiDimensions: [...existing.kpiDimensions],
                                expectedOutcome: existing.expectedOutcome,
                                limitations: existing.limitations,
                                evidenceLevel: existing.evidenceLevel,
                        };
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `replaced the summary of the benchmark '${existing.benchmarkKey}' (a benchmark's key is its identity - immutable once added; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
                        const next: BenchmarksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                benchmarks: record.benchmarks.map((entry) => (entry.benchmarkKey === replacement.benchmarkKey ? replacement : entry)),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-benchmark-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: BenchmarksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BENCHMARKS_CONTRACTS_VERSION,
                                op: 'replace-benchmark-summary',
                                benchmarksId: record.id,
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
                async removeBenchmark(benchmarksId: unknown, benchmarkKey: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('removeBenchmark');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('removeBenchmark', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('removeBenchmark', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        const existing = findBenchmark(record, benchmarkKey);
                        if (existing === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-benchmark',
                                                'THE FAIL-CLOSED LAW',
                                                `removeBenchmark: no benchmark '${showValue(benchmarkKey)}' in the record (a malformed benchmarkKey fails closed as unknown-benchmark)`,
                                        ),
                                };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `removed the benchmark '${existing.benchmarkKey}' (THE REMOVE+RE-ADD LAW: a changed benchmarkKey is a NEW benchmark; removing the last benchmark is legal while composing - the empty-benchmarks floor fires only at finalize)`;
                        const next: BenchmarksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composing',
                                benchmarks: record.benchmarks.filter((entry) => entry.benchmarkKey !== existing.benchmarkKey),
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-benchmark', law: 'THE REMOVE+RE-ADD LAW', detail }],
                        };
                        const line: BenchmarksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BENCHMARKS_CONTRACTS_VERSION,
                                op: 'remove-benchmark',
                                benchmarksId: record.id,
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
                async finalizeBenchmarks(benchmarksId: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('finalizeBenchmarks');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('finalizeBenchmarks', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const stageRefusal = stageGuard('finalizeBenchmarks', record);
                        if (stageRefusal !== null) {
                                return { ok: false, refusal: stageRefusal };
                        }
                        // THE BENCHMARK LAWS' floor: at least one benchmark at finalize
                        // (never the record shape).
                        if (record.benchmarks.length === 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'empty-benchmarks',
                                                'THE FAIL-CLOSED LAW',
                                                'finalizeBenchmarks: the domain benchmarks must compose at least one benchmark (the empty-benchmarks floor - compose benchmarks with addBenchmark first; the floor fires HERE, never the record shape)',
                                                ['benchmarks'],
                                        ),
                                };
                        }
                        // THE TWO-PHASE LAW's boundary re-proof, station 1: every scenarioRef
                        // re-proven against the REAL imported getScenario (each offender named
                        // once, in first-seen order - the add-time proof is re-proven here).
                        const known = new Set<string>();
                        const dangling: string[] = [];
                        for (const benchmark of record.benchmarks) {
                                for (const ref of benchmark.scenarioRefs) {
                                        if (getScenario(ref) === undefined && !known.has(ref)) {
                                                known.add(ref);
                                                dangling.push(ref);
                                        }
                                }
                        }
                        if (dangling.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'dangling-scenario-ref',
                                                'THE SCENARIO-BINDING LAW',
                                                `finalizeBenchmarks: every scenarioRef must resolve against the REAL LAB-003 task-world registry (imported through getScenario - never a transcribed list; a dangling scenarioRef is never a silent skip; the two-phase law proved these at add time and re-proves them here)`,
                                                dangling,
                                        ),
                                };
                        }
                        // THE TWO-PHASE LAW's boundary re-proof, station 2: the complete-table
                        // record walk over the candidate composed record (the vocabulary legs
                        // re-proven: the KPI dimensions against the REAL evaluation vocabulary,
                        // the evidence ceiling against the REAL ladder, the full frozen walk).
                        const candidate: BenchmarksRecord = {
                                id: record.id,
                                harnessId: record.harnessId,
                                industry: record.industry,
                                stage: 'composed',
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
                                history: record.history,
                        };
                        const walked = validateBenchmarksRecord(candidate);
                        if (!walked.ok) {
                                return { ok: false, refusal: payloadRefused('finalizeBenchmarks', walked) };
                        }
                        const clockRead = readClock();
                        if ('refusal' in clockRead) {
                                return { ok: false, refusal: clockRead.refusal };
                        }
                        const at = clockRead.at;
                        const detail = `finalized the domain benchmarks (${record.benchmarks.length} benchmark(s); composing -> composed, TERMINAL - the record is FROZEN, a changed benchmark is a NEW benchmark; every scenarioRef re-proven against the REAL LAB task-world registry, the vocabulary legs re-proven at this boundary)`;
                        const next: BenchmarksRecord = {
                                ...candidate,
                                history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-benchmarks', law: 'THE SCENARIO-BINDING LAW', detail }],
                        };
                        const line: BenchmarksOpsLedgerLine = {
                                seq: mutableSeq + 1,
                                at,
                                contractVersion: BENCHMARKS_CONTRACTS_VERSION,
                                op: 'finalize-benchmarks',
                                benchmarksId: record.id,
                                harnessId: record.harnessId,
                                fromStage: 'composing',
                                toStage: 'composed',
                                law: 'THE SCENARIO-BINDING LAW',
                                payload: null,
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
                async emitEvidenceRef(benchmarksId: unknown): Promise<BenchmarksRefOutcome> {
                        const disposedRefusal = refuseIfDisposed('emitEvidenceRef');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('emitEvidenceRef', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const composedRefusal = composedGuard('emitEvidenceRef', record);
                        if (composedRefusal !== null) {
                                return { ok: false, refusal: composedRefusal };
                        }
                        // The emitted ref IS the composed record's id (the review composition's
                        // evidenceRefs family member form: a string, duplicate-free by identity).
                        // A pure read: no state change, no ledger line - the ref is deterministic.
                        return { ok: true, evidenceRef: record.id };
                },
                async instantiateBenchmark(benchmarksId: unknown, benchmarkKey: unknown, seed: unknown, count: unknown): Promise<BenchmarkInstancesOutcome> {
                        const disposedRefusal = refuseIfDisposed('instantiateBenchmark');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('instantiateBenchmark', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const composedRefusal = composedGuard('instantiateBenchmark', record);
                        if (composedRefusal !== null) {
                                return { ok: false, refusal: composedRefusal };
                        }
                        const entry = findBenchmark(record, benchmarkKey);
                        if (entry === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-benchmark',
                                                'THE FAIL-CLOSED LAW',
                                                `instantiateBenchmark: no benchmark '${showValue(benchmarkKey)}' in the record (a malformed benchmarkKey fails closed as unknown-benchmark)`,
                                        ),
                                };
                        }
                        // THE REPRODUCIBILITY LAW's request shape: an integer seed and a
                        // positive integer count (the REAL generator's stream is a pure
                        // function of (scenarioId, seed, instanceIndex)).
                        const requestViolations: string[] = [];
                        if (typeof seed !== 'number' || !Number.isInteger(seed)) {
                                requestViolations.push('seed');
                        }
                        if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
                                requestViolations.push('count');
                        }
                        if (requestViolations.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'bad-instance-request',
                                                'THE REPRODUCIBILITY LAW',
                                                'instantiateBenchmark: the seed must be an integer and the count a positive integer (the instance stream is a pure function of (scenarioId, seed, instanceIndex) through the REAL imported generator)',
                                                requestViolations,
                                        ),
                                };
                        }
                        const seedValue = seed as number;
                        const countValue = count as number;
                        // THE REPRODUCIBILITY LAW: same seed -> byte-identical instances. The
                        // delegation to the REAL imported generateInstances (never a second
                        // generator); a pure read: no clock, no rng, no ledger line.
                        const scenarioInstances: BenchmarkScenarioInstances[] = entry.scenarioRefs.map((scenarioId) => ({
                                scenarioId,
                                instances: generateInstances(scenarioId, seedValue, countValue),
                        }));
                        return {
                                ok: true,
                                bundle: {
                                        benchmarkKey: entry.benchmarkKey,
                                        seed: seedValue,
                                        count: countValue,
                                        scenarioInstances,
                                },
                        };
                },
                async evaluateBenchmark(benchmarksId: unknown, benchmarkKey: unknown, measures: unknown, evidenceLevelClaim?: unknown): Promise<BenchmarkEvaluationOutcome> {
                        const disposedRefusal = refuseIfDisposed('evaluateBenchmark');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('evaluateBenchmark', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const composedRefusal = composedGuard('evaluateBenchmark', record);
                        if (composedRefusal !== null) {
                                return { ok: false, refusal: composedRefusal };
                        }
                        const entry = findBenchmark(record, benchmarkKey);
                        if (entry === null) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-benchmark',
                                                'THE FAIL-CLOSED LAW',
                                                `evaluateBenchmark: no benchmark '${showValue(benchmarkKey)}' in the record (a malformed benchmarkKey fails closed as unknown-benchmark)`,
                                        ),
                                };
                        }
                        // THE HONEST-MEASURE LAW, station 1: the measures carrier and the row
                        // shapes (the REAL EvalScore shape: { dimension, value, unit? }).
                        if (!Array.isArray(measures)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-measures',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: the measures must be an array of EvalScore-shaped rows ({ dimension, value, unit? } - the REAL evaluation-score shape; the kit NEVER invents scores)',
                                                ['measures'],
                                        ),
                                };
                        }
                        const shapeViolations: string[] = [];
                        for (let i = 0; i < measures.length; i += 1) {
                                const row = measures[i];
                                if (!isRecord(row)) {
                                        shapeViolations.push(`measures[${i}]`);
                                        continue;
                                }
                                const rowRecord = row as Record<string, unknown>;
                                const extraKeys = Object.keys(rowRecord).filter((key) => key !== 'dimension' && key !== 'value' && key !== 'unit');
                                for (const extraKey of extraKeys) {
                                        shapeViolations.push(`measures[${i}]:${extraKey}`);
                                }
                                if (typeof rowRecord.dimension !== 'string') {
                                        shapeViolations.push(`measures[${i}]:dimension`);
                                }
                                if (typeof rowRecord.value !== 'number') {
                                        shapeViolations.push(`measures[${i}]:value`);
                                }
                                if (rowRecord.unit !== undefined && (typeof rowRecord.unit !== 'string' || rowRecord.unit.length === 0)) {
                                        shapeViolations.push(`measures[${i}]:unit`);
                                }
                        }
                        if (shapeViolations.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-measures',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every measure row must be { dimension, value, unit? } with a string dimension, a number value and an optional non-empty string unit (the REAL EvalScore shape; the kit NEVER invents scores)',
                                                shapeViolations,
                                        ),
                                };
                        }
                        // station 2: the dimension membership legs (the REAL vocabulary, then
                        // the benchmark's declared KPI dimensions).
                        const declared = new Set<string>(entry.kpiDimensions);
                        const unknownDimensions: string[] = [];
                        const undeclaredDimensions: string[] = [];
                        const malformedValues: string[] = [];
                        const seenDimensions: string[] = [];
                        const rows = new Map<string, { value: number; unit?: string }>();
                        for (const row of measures as Record<string, unknown>[]) {
                                const dimension = row.dimension as string;
                                if (!isEvalDimension(dimension)) {
                                        unknownDimensions.push(dimension);
                                        continue;
                                }
                                if (!declared.has(dimension)) {
                                        undeclaredDimensions.push(dimension);
                                        continue;
                                }
                                const value = row.value as number;
                                if (!Number.isFinite(value)) {
                                        malformedValues.push(`${dimension}`);
                                        continue;
                                }
                                seenDimensions.push(dimension);
                                if (!rows.has(dimension)) {
                                        rows.set(dimension, { value, unit: typeof row.unit === 'string' ? row.unit : undefined });
                                }
                        }
                        if (unknownDimensions.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'unknown-dimension',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every measure row dimension must be a REAL EvalDimension (the imported evaluation vocabulary - success / quality / latency / cost)',
                                                unknownDimensions,
                                        ),
                                };
                        }
                        if (undeclaredDimensions.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'undeclared-dimension',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every measure row dimension must sit inside the benchmark declared kpiDimensions (only the declared KPIs are scored)',
                                                undeclaredDimensions,
                                        ),
                                };
                        }
                        if (malformedValues.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-measure-value',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every measure row value must be a finite number (NaN / Infinity are refused - the kit never launders a corrupt measure)',
                                                malformedValues,
                                        ),
                                };
                        }
                        const duplicateDimensions = seenDimensions.filter((dimension, index) => seenDimensions.indexOf(dimension) !== index);
                        if (duplicateDimensions.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'duplicate-measure',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every measure row dimension must be claimed once (a KPI dimension carries exactly one caller row)',
                                                duplicateDimensions,
                                        ),
                                };
                        }
                        // station 3: the coverage law - every declared KPI dimension must carry a
                        // caller row (the kit NEVER invents the missing score).
                        const missing = entry.kpiDimensions.filter((dimension) => !rows.has(dimension));
                        if (missing.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'missing-measure',
                                                'THE HONEST-MEASURE LAW',
                                                'evaluateBenchmark: every declared KPI dimension must carry a caller-supplied measure row (the kit NEVER invents the missing score - no zero-filled inventions)',
                                                missing,
                                        ),
                                };
                        }
                        // station 4: THE EVIDENCE-CEILING LAW's claim walk. An absent claim
                        // inherits the benchmark's own rung; a claim at or below the benchmark's
                        // rung is carried verbatim (the honest floor); a claim ABOVE the
                        // benchmark's rung is the typed evidence-promotion refusal; a claim that
                        // is not a real ladder rung is the typed bad-evidence-level refusal.
                        let evidenceLevel: LabEvidenceLevel;
                        if (evidenceLevelClaim === undefined) {
                                evidenceLevel = entry.evidenceLevel;
                        } else if (!isLabEvidenceLevel(evidenceLevelClaim)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'bad-evidence-level',
                                                'THE FAIL-CLOSED LAW',
                                                `evaluateBenchmark: the evidenceLevelClaim must be a member of the REAL six-rung LabEvidenceLevel ladder (fixture / simulated / local-real / runtime-real / live-provider / production-real - imported by reference) or absent`,
                                                [showValue(evidenceLevelClaim)],
                                        ),
                                };
                        } else if (labEvidenceLevelRank(evidenceLevelClaim) > labEvidenceLevelRank(entry.evidenceLevel)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'evidence-promotion',
                                                'THE EVIDENCE-CEILING LAW',
                                                `evaluateBenchmark: the evidenceLevelClaim '${evidenceLevelClaim}' sits ABOVE the benchmark's own rung '${entry.evidenceLevel}' - a benchmark run is never promoted above its DEFINITION's rung (and a definition never sits above the family ceiling 'fixture' / 'simulated'; never overstated)`,
                                                [evidenceLevelClaim],
                                        ),
                                };
                        } else {
                                evidenceLevel = evidenceLevelClaim;
                        }
                        // The composed result: the caller-supplied values in the benchmark's
                        // canonical kpiDimensions order (never invented, never reordered by the
                        // caller). A pure read: no clock, no rng, no ledger line.
                        const scores: EvalScore[] = entry.kpiDimensions.map((dimension) => {
                                const row = rows.get(dimension) as { value: number; unit?: string };
                                const score: EvalScore = { dimension, value: row.value };
                                if (row.unit !== undefined) {
                                        score.unit = row.unit;
                                }
                                return score;
                        });
                        return {
                                ok: true,
                                result: {
                                        benchmarksId: record.id,
                                        harnessId: record.harnessId,
                                        benchmarkKey: entry.benchmarkKey,
                                        scores,
                                        evidenceLevel,
                                },
                        };
                },
                async reportCapabilityGaps(benchmarksId: unknown, inventory: unknown): Promise<BenchmarkGapsOutcome> {
                        const disposedRefusal = refuseIfDisposed('reportCapabilityGaps');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('reportCapabilityGaps', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        const record = lookup.record;
                        const composedRefusal = composedGuard('reportCapabilityGaps', record);
                        if (composedRefusal !== null) {
                                return { ok: false, refusal: composedRefusal };
                        }
                        // THE CAPABILITY-GAP HONESTY LAW, station 1: the caller-supplied
                        // inventory shape (a string array; a fabricated shape resolves
                        // nothing, never a silent skip).
                        if (!Array.isArray(inventory)) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-inventory',
                                                'THE CAPABILITY-GAP HONESTY LAW',
                                                'reportCapabilityGaps: the capability inventory must be a string array (the caller-supplied capability ids; a fabricated shape resolves nothing, never a silent skip)',
                                                ['inventory'],
                                        ),
                                };
                        }
                        const nonStringMembers: string[] = [];
                        for (let i = 0; i < inventory.length; i += 1) {
                                if (typeof inventory[i] !== 'string') {
                                        nonStringMembers.push(`inventory[${i}]`);
                                }
                        }
                        if (nonStringMembers.length > 0) {
                                return {
                                        ok: false,
                                        refusal: refused(
                                                'malformed-inventory',
                                                'THE CAPABILITY-GAP HONESTY LAW',
                                                'reportCapabilityGaps: every capability inventory member must be a string (the caller-supplied capability ids)',
                                                nonStringMembers,
                                        ),
                                };
                        }
                        const held = new Set<string>(inventory as string[]);
                        // station 2: the gap ledger - every benchmark's scenario requirements
                        // (each scenarioRef) and capability requirements (each resolved
                        // scenario's REAL taskTypeId, through the imported getScenario) NOT
                        // present in the inventory: honestly named, never silently dropped,
                        // never invented. A benchmark with nothing missing carries no gap row
                        // (a zero-gap ledger is the green path).
                        const gaps: BenchmarkGap[] = [];
                        for (const benchmark of record.benchmarks) {
                                const seen = new Set<string>();
                                const missing: string[] = [];
                                for (const ref of benchmark.scenarioRefs) {
                                        if (!held.has(ref) && !seen.has(ref)) {
                                                seen.add(ref);
                                                missing.push(ref);
                                        }
                                        const scenario = getScenario(ref);
                                        if (scenario !== undefined && !held.has(scenario.taskTypeId) && !seen.has(scenario.taskTypeId)) {
                                                seen.add(scenario.taskTypeId);
                                                missing.push(scenario.taskTypeId);
                                        }
                                }
                                if (missing.length > 0) {
                                        gaps.push({ benchmarkKey: benchmark.benchmarkKey, missing });
                                }
                        }
                        return { ok: true, gaps };
                },
                async inspectBenchmarks(benchmarksId: unknown): Promise<BenchmarksRecordOutcome> {
                        const disposedRefusal = refuseIfDisposed('inspectBenchmarks');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        const lookup = lookupRecord('inspectBenchmarks', benchmarksId);
                        if ('refusal' in lookup) {
                                return { ok: false, refusal: lookup.refusal };
                        }
                        return recordOutcome(lookup.record);
                },
                async listBenchmarksSessions(filter?: unknown): Promise<BenchmarksListOutcome> {
                        const disposedRefusal = refuseIfDisposed('listBenchmarksSessions');
                        if (disposedRefusal !== null) {
                                return { ok: false, refusal: disposedRefusal };
                        }
                        if (filter !== undefined) {
                                if (!isRecord(filter)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listBenchmarksSessions: the filter must be an object (or absent)') };
                                }
                                const filterRecord = filter as Record<string, unknown>;
                                const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'harnessId');
                                if (unknownFields.length > 0) {
                                        return {
                                                ok: false,
                                                refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listBenchmarksSessions: the filter carries an unknown field (stage / industry / harnessId only)', unknownFields),
                                        };
                                }
                                if (filterRecord.stage !== undefined && !isBenchmarkStage(filterRecord.stage)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listBenchmarksSessions: the stage filter value is not a member of the frozen BENCHMARK_STAGES list') };
                                }
                                if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listBenchmarksSessions: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
                                }
                                if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
                                        return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listBenchmarksSessions: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
                                }
                        }
                        const ids = [...records.keys()].sort();
                        const listed: BenchmarksRecord[] = [];
                        for (const id of ids) {
                                const entry = records.get(id) as BenchmarksRecord;
                                if (filter !== undefined && !matchesRecordFilter(entry, filter as Record<string, unknown>)) {
                                        continue;
                                }
                                listed.push(copyRecord(entry));
                        }
                        return { ok: true, records: listed };
                },
                disposeBenchmarks(): void {
                        disposed = true;
                },
        };
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface BenchmarksLedgerReplay {
        readonly lines: readonly BenchmarksOpsLedgerLine[];
        readonly records: Map<string, BenchmarksRecord>;
}

/** Parses and validates the whole benchmarks ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayBenchmarksLedger(ledgerText: string | null): BenchmarksLedgerReplay | BenchmarksKitRefusal {
        if (ledgerText === null || ledgerText.length === 0) {
                return { lines: [], records: new Map<string, BenchmarksRecord>() };
        }
        if (!ledgerText.endsWith('\n')) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks ledger does not end with a complete line (a torn append - never a silent skip)');
        }
        const records = new Map<string, BenchmarksRecord>();
        const lines: BenchmarksOpsLedgerLine[] = [];
        const rawLines = ledgerText.split('\n');
        rawLines.pop();
        for (let i = 0; i < rawLines.length; i += 1) {
                if (rawLines[i].length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${i + 1} is empty`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(rawLines[i]);
                } catch {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
                }
                const torn = validateBenchmarksLedgerLine(parsed, i + 1, records);
                if (torn !== null) {
                        return torn;
                }
                const record = parsed as Record<string, unknown>;
                const line: BenchmarksOpsLedgerLine = {
                        seq: record.seq as number,
                        at: record.at as string,
                        contractVersion: record.contractVersion as string,
                        op: record.op as BenchmarkOpName,
                        benchmarksId: record.benchmarksId as string,
                        harnessId: record.harnessId as string,
                        fromStage: record.fromStage as BenchmarkStage | null,
                        toStage: record.toStage as BenchmarkStage,
                        law: record.law as string,
                        payload: record.payload as BenchmarksOpsLedgerLine['payload'],
                        detail: record.detail as string,
                };
                applyBenchmarksLine(records, line);
                lines.push(line);
        }
        return { lines, records };
}

/** Validates one parsed benchmarks ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateBenchmarksLedgerLine(parsed: unknown, lineNo: number, records: Map<string, BenchmarksRecord>): BenchmarksKitRefusal | null {
        if (!isRecord(parsed)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is not a JSON object`);
        }
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const expected = [...BENCHMARKS_LEDGER_LINE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
        }
        if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
        }
        if (typeof record.at !== 'string' || record.at.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
        }
        if (record.contractVersion !== BENCHMARKS_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${BENCHMARKS_CONTRACTS_VERSION}' is known (the single-version law; the six-key record carries no version field, so THIS is the law's live station)`);
        }
        if (!isBenchmarkOpName(record.op)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
        }
        if (!isBenchmarkId(record.benchmarksId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries a malformed record id`);
        }
        if (!isHarnessId(record.harnessId)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
        }
        if (record.fromStage !== null && !isBenchmarkStage(record.fromStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries an unknown fromStage`);
        }
        if (!isBenchmarkStage(record.toStage)) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries an unknown toStage`);
        }
        if (typeof record.law !== 'string' || record.law.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries no law name (the provenance law)`);
        }
        if (typeof record.detail !== 'string' || record.detail.length === 0) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries no provenance detail`);
        }
        const op = record.op as BenchmarkOpName;
        const benchmarksRecord = records.get(record.benchmarksId as string);
        if (op === 'begin-benchmarks') {
                if (record.fromStage !== null || record.toStage !== 'composing') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
                }
                if (!isHarnessIndustry(record.payload)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
                }
                if (benchmarksRecord !== undefined) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} begins a duplicate record id`);
                }
                return null;
        }
        if (benchmarksRecord === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} advances an unknown record`);
        }
        if (benchmarksRecord.stage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
        }
        if (op === 'finalize-benchmarks') {
                if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
                }
                // The finalize line carries a NULL payload (the boundary authority is the
                // REAL imported task-world registry, never a caller-supplied record): the
                // replay re-proves the boundary laws from the ledger's own payloads THROUGH
                // the imported registry - the empty floor, THE SCENARIO-BINDING LAW (every
                // scenarioRef re-proven against the REAL getScenario) and the vocabulary
                // legs (the complete entry walk over every replayed entry).
                if (record.payload !== null) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is a finalize line carrying a non-null payload (the boundary authority is the imported registry, never a caller-supplied record)`);
                }
                if (benchmarksRecord.benchmarks.length === 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} finalizes an empty record (the empty-benchmarks floor - the replay re-validates the boundary law)`);
                }
                const dangling: string[] = [];
                for (const benchmark of benchmarksRecord.benchmarks) {
                        for (const ref of benchmark.scenarioRefs) {
                                if (getScenario(ref) === undefined && !dangling.includes(ref)) {
                                        dangling.push(ref);
                                }
                        }
                }
                if (dangling.length > 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries a dangling scenarioRef resolution (${showList(dangling)}) - THE SCENARIO-BINDING LAW re-proved from the ledger alone`);
                }
                for (const benchmark of benchmarksRecord.benchmarks) {
                        const walked = validateBenchmarkEntry(benchmark);
                        if (!walked.ok) {
                                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} finalizes a record whose entry '${showValue(benchmark.benchmarkKey)}' fails the vocabulary re-proof (the complete entry walk re-proved from the ledger alone)`);
                        }
                }
                return null;
        }
        if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} is a benchmark-op line outside the composing->composing self edge (the organization composes its benchmark definitions gradually)`);
        }
        const entry = validateBenchmarkEntry(record.payload);
        if (!entry.ok) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} carries an invalid benchmark payload (THE SCENARIO-BINDING LAW and the vocabulary legs re-proved from the ledger alone)`);
        }
        const payloadBenchmark = entry.value;
        if (op === 'add-benchmark') {
                if (benchmarksRecord.benchmarks.some((benchmark) => benchmark.benchmarkKey === payloadBenchmark.benchmarkKey)) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} adds a duplicate benchmarkKey '${payloadBenchmark.benchmarkKey}'`);
                }
                if (benchmarksRecord.benchmarks.length >= MAX_BENCHMARKS) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} exceeds the MAX_BENCHMARKS (${MAX_BENCHMARKS}) composition bound`);
                }
                return null;
        }
        const standing = benchmarksRecord.benchmarks.find((benchmark) => benchmark.benchmarkKey === payloadBenchmark.benchmarkKey);
        if (standing === undefined) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} advances an unknown benchmark '${payloadBenchmark.benchmarkKey}'`);
        }
        if (op === 'replace-benchmark-summary') {
                // The immutable-parts cross-check: only the summary may differ (a benchmark's
                // key is its identity and the other seven legs are carried unchanged).
                if (payloadBenchmark.hypothesis !== standing.hypothesis || JSON.stringify(payloadBenchmark.scenarioRefs) !== JSON.stringify(standing.scenarioRefs) || JSON.stringify(payloadBenchmark.kpiDimensions) !== JSON.stringify(standing.kpiDimensions) || payloadBenchmark.expectedOutcome !== standing.expectedOutcome || payloadBenchmark.limitations !== standing.limitations || payloadBenchmark.evidenceLevel !== standing.evidenceLevel) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} replaces a benchmark whose immutable legs do not match the record's benchmark as it stood (THE REMOVE+RE-ADD LAW)`);
                }
                return null;
        }
        // remove-benchmark: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
        if (payloadBenchmark.summary !== standing.summary || payloadBenchmark.hypothesis !== standing.hypothesis || JSON.stringify(payloadBenchmark.scenarioRefs) !== JSON.stringify(standing.scenarioRefs) || JSON.stringify(payloadBenchmark.kpiDimensions) !== JSON.stringify(standing.kpiDimensions) || payloadBenchmark.expectedOutcome !== standing.expectedOutcome || payloadBenchmark.limitations !== standing.limitations || payloadBenchmark.evidenceLevel !== standing.evidenceLevel) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: benchmarks ledger line ${lineNo} removes a benchmark entry that does not match the record's benchmarks as it stood`);
        }
        return null;
}

/** Applies one validated benchmarks ledger line to the replay records (pure fold). */
function applyBenchmarksLine(records: Map<string, BenchmarksRecord>, line: BenchmarksOpsLedgerLine): void {
        if (line.op === 'begin-benchmarks') {
                records.set(line.benchmarksId, {
                        id: line.benchmarksId,
                        harnessId: line.harnessId,
                        industry: line.payload as HarnessIndustry,
                        stage: line.toStage,
                        benchmarks: [],
                        history: [noteOf(line)],
                });
                return;
        }
        const record = records.get(line.benchmarksId);
        if (record === undefined) {
                return;
        }
        const base: BenchmarksRecord = {
                ...record,
                stage: line.toStage,
                history: [...record.history, noteOf(line)],
        };
        let next: BenchmarksRecord;
        if (line.op === 'add-benchmark') {
                next = { ...base, benchmarks: [...record.benchmarks, line.payload as BenchmarkEntry] };
        } else if (line.op === 'replace-benchmark-summary') {
                const replacement = line.payload as BenchmarkEntry;
                next = { ...base, benchmarks: record.benchmarks.map((benchmark) => (benchmark.benchmarkKey === replacement.benchmarkKey ? replacement : benchmark)) };
        } else if (line.op === 'remove-benchmark') {
                const removed = line.payload as BenchmarkEntry;
                next = { ...base, benchmarks: record.benchmarks.filter((benchmark) => benchmark.benchmarkKey !== removed.benchmarkKey) };
        } else {
                next = {
                        ...base,
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
                };
        }
        records.set(line.benchmarksId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: BenchmarksOpsLedgerLine): BenchmarkTransitionNote {
        return {
                at: line.at,
                fromStage: line.fromStage,
                toStage: line.toStage,
                op: line.op,
                law: line.law,
                detail: line.detail,
        };
}

/** Cross-checks the benchmarks envelope against the replay; returns the typed refusal or null. */
function crossCheckBenchmarksEnvelope(
        envelopeText: string | null,
        lineCount: number,
        replayed: Map<string, BenchmarksRecord>,
): BenchmarksKitRefusal | null {
        if (envelopeText === null) {
                if (lineCount === 0) {
                        return null;
                }
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: the benchmarks envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        let parsedEnvelope: unknown;
        try {
                parsedEnvelope = JSON.parse(envelopeText);
        } catch {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope is not valid JSON');
        }
        if (!isRecord(parsedEnvelope)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope is not a JSON object');
        }
        const envelope = parsedEnvelope as Record<string, unknown>;
        const keys = Object.keys(envelope).sort();
        const expected = [...BENCHMARKS_ENVELOPE_SCHEMA_KEYS].sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope is structurally invalid (the frozen three-key envelope schema)');
        }
        if (envelope.contractVersion !== BENCHMARKS_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadBenchmarksKit: the benchmarks envelope carries contract version ${showValue(envelope.contractVersion)} - only '${BENCHMARKS_CONTRACTS_VERSION}' is known (the single-version law)`);
        }
        if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope carries a malformed seq');
        }
        if (!Array.isArray(envelope.records)) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope carries a malformed records array');
        }
        const envelopeSeq = envelope.seq as number;
        if (envelopeSeq > lineCount) {
                return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: the benchmarks envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
        }
        if (envelopeSeq < lineCount) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: the benchmarks envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
        }
        const envelopeRecordMap = new Map<string, BenchmarksRecord>();
        for (let i = 0; i < envelope.records.length; i += 1) {
                const entry = envelope.records[i];
                if (!validateBenchmarksRecord(entry).ok) {
                        return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadBenchmarksKit: the benchmarks envelope's records[${i}] is not a valid benchmarks record`);
                }
                const benchmarksRecord = entry as BenchmarksRecord;
                envelopeRecordMap.set(benchmarksRecord.id, benchmarksRecord);
        }
        const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
        const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
        if (replayBytes !== envelopeBytes) {
                return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadBenchmarksKit: the benchmarks envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
        }
        return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: BenchmarksOpsLedgerLine): string {
        return JSON.stringify({
                seq: line.seq,
                at: line.at,
                contractVersion: line.contractVersion,
                op: line.op,
                benchmarksId: line.benchmarksId,
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
 * (the industry string, the benchmark entry, or null on finalize - the
 * boundary authority is the imported registry, never a
 * caller-supplied record).
 */
function payloadObject(payload: BenchmarksOpsLedgerLine['payload']): HarnessIndustry | Record<string, unknown> | null {
        if (payload === null) {
                return null;
        }
        if (typeof payload === 'string') {
                return payload;
        }
        return {
                benchmarkKey: payload.benchmarkKey,
                summary: payload.summary,
                hypothesis: payload.hypothesis,
                scenarioRefs: [...payload.scenarioRefs],
                kpiDimensions: [...payload.kpiDimensions],
                expectedOutcome: payload.expectedOutcome,
                limitations: payload.limitations,
                evidenceLevel: payload.evidenceLevel,
        };
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by id). */
function envelopeBytes(seq: number, nextRecords: Map<string, BenchmarksRecord>): string {
        const ids = [...nextRecords.keys()].sort();
        const listed = ids.map((id) => nextRecords.get(id) as BenchmarksRecord);
        return `{"contractVersion":${JSON.stringify(BENCHMARKS_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
                .map((record) => serializeBenchmarksRecord(record))
                .join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, BenchmarksRecord>): string {
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

function matchesRecordFilter(record: BenchmarksRecord, filter: Record<string, unknown>): boolean {
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
