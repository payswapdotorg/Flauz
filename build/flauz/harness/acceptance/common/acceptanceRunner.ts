/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License. See LICENSE in the repository root for
 * additional information.
 *
 * DH-013 acceptance runner: the deterministic cross-industry harness
 * acceptance instrument - the kit-style runner over the injected
 * seams that drives the COMPLETE acceptance journey for every
 * representative industry THROUGH THE REAL LANDED KITS, never
 * re-implementing any of them:
 *
 *   the DH-11 journey     - through the REAL activation journey kit
 *                           (ONE construction, shared by ALL
 *                           industries: beginJourney -> selectIndustry
 *                           -> composeCompany -> selectWorkTypes ->
 *                           composeRecords (the six REAL record kits)
 *                           -> proposeHarness -> approveHarness ->
 *                           activateHarness; the REAL DH-01 authority
 *                           re-read at 'active');
 *   the DH-10 projection  - through the REAL projections kit (ONE
 *                           construction; projectNavigation over the
 *                           composed records, anchored on the binding
 *                           composition root);
 *   the DH-09 benchmark   - through the REAL benchmarks kit read
 *                           surface (instantiateBenchmark, seeded and
 *                           reproducible; evaluateBenchmark over the
 *                           runner-derived fixture measures) + the REAL LAB
 *                           closedLoop (runClosedLoop - the ten-stage
 *                           fixture execution over the real
 *                           deterministic instances);
 *   the DH-12 smoke       - through the REAL optimization loop kit
 *                           (ONE construction; observe ->
 *                           simulate -> compare -> recommend - the
 *                           auditable recommendation with the
 *                           uncertainty / missing-capability /
 *                           reversibility disclosures).
 *
 * THE COMPOSITION-NOT-FORK LAW (this family's first law, STRUCTURAL):
 * the industries differ ONLY IN DATA. The runner constructs its real
 * kits through ONE code path with the SAME injected seams (clock /
 * rng / fsPort / root) for EVERY industry - a fifth industry is a
 * new fixture module, never a code path. This module contains NO
 * industry-string branch (pinned by source inspection in the
 * battery: the four industry literals appear only in the contract's
 * frozen lane and the pure-data fixture modules). The projections
 * kit and the optimization loop kit are constructed ONCE and shared
 * by all four industries; the activation journey kit is OPENED
 * through the SAME code path for each industry run (the REAL
 * createActivationKit for the first, the REAL loadActivationKit for
 * every later run) - the families' own restart discipline: a kit
 * instance is an in-memory snapshot and the ledger is the live
 * surface (the DH-11 journey kit's authority boundaries REOPEN the
 * real DH-01 authority from its own ledger at every boundary, so a
 * cached instance would hold a stale inner seq across journeys; the
 * reopen keeps every inner authority current). The per-industry
 * reads reopen the composed families through their OWN load surfaces
 * (THE EVIDENCE-NOT-AUTHORITY LAW; the records are READ from the
 * families' own append-only ledgers, never a second writing
 * construction).
 *
 * THE FAIL-CLOSED VERDICT LAW: the overall verdict is GREEN only
 * when EVERY industry's journey leg is complete AND every honest gap
 * is REGISTERED (the six frozen ledger rows in the report; the
 * benchmark-absent industries' world-coverage rows in their own
 * expectedGaps). Any refused leg or any missing registration is the
 * TYPED refusal - never a silent pass; the run stops at the refusal
 * and the report is never emitted over a refused leg.
 *
 * THE CATALOG SEAM (the one derivation this runner owns): the
 * injected READ-ONLY resolution surface for the real kits is
 * CONSTRUCTED from the fixtures' own permissionRefs at
 * approved/enabled states (the DH-01 catalog-binding law's honest
 * floor) and wired with the runtime-minted composed record links at
 * each journey's proposal boundary (the emitted refs must resolve).
 * The catalog object is ONE mutable snapshot shared by every kit the
 * runner constructs - the runner is never a capability authority
 * through it (it resolves what the fixtures and the real kits
 * minted, nothing more).
 *
 * THE REGISTRY-BOUND BENCHMARK DERIVATION (the honest compose floor):
 * the REAL DH-09 journey leg requires at least one composed
 * benchmark (the empty-benchmarks floor) and every scenarioRef the
 * DH-09 record carries must resolve against the LANDED base registry
 * - which carries the SE fixture world (the landed census, pinned by
 * the landed batteries; the registry fact). A fixture carrying no
 * base-registry curated benchmark composes the runner-derived
 * REGISTRY-BOUND benchmark: bound to the REAL base-registry scenario
 * ids (imported from the REAL TASK_WORLDS registry), keyed by the
 * fixture's own industry, measuring the fixture's own declared KPI
 * dimensions, with the limitation disclosed IN the benchmark entry
 * itself. The derivation is uniform over the fixture data (never an
 * industry branch). THE INDUSTRY-EXTENSION BINDING (the DH-GAP-2
 * wave's benchmark-leg refresh): a fixture carrying the wrapped
 * industry-extension binding evaluates its curated benchmark leg
 * through the COMBINED CATALOG - the scenario instances generated by
 * the REAL imported generateTaskInstances (the lab industry extension
 * registry's own engine entry point; never a second engine, never a
 * re-implementation), the measures derived by the same honest
 * fixture-measure law, the evaluation record composed in the REAL
 * DH-09 result shape and bound to the journey's own records. The
 * journey's DH-09 record still composes the registry-bound floor
 * entry for those fixtures (the DH-09 binding law is landed
 * machinery; the industry binding is never forced into it) - the
 * honest split, disclosed in both the floor entry and the report's
 * evidence disclosure.
 *
 * THE ACTIVITY-CORPUS DERIVATION: the DH-12 observe leg and the LAB
 * closedLoop need a caller-supplied activity corpus; the corpus is
 * DERIVED from the REAL combined task-world catalog (ALL_TASK_WORLDS
 * - the landed SE world plus the three industry worlds, imported by
 * reference; two records per REAL scenario, the task family taken
 * from the scenario id) and stamped at the runner's construction
 * clock reading - the corpus is the combined catalog's own world mix,
 * honestly disclosed (the industry worlds' activity evidence is
 * fixture-level; the workload learning lane is the registry's own
 * mix).
 *
 * THE EVIDENCE DISCLOSURE: the task execution evidence is the LAB
 * closedLoop fixture execution over the real deterministic instances
 * plus the real authority routing - honestly labeled at the
 * fixture/simulated ceiling; no live provider, no production
 * deployment, no evidence promotion.
 *
 * Persistence (the PIN-2 sibling precedent, this family's OWN
 * evidence mirror ONLY - never a second domain authority): the same
 * .flauz/harness subtree, distinct files - the append-only ops
 * ledger .flauz/harness/acceptance-ops.jsonl (one canonical JSON
 * line per applied op; the seq strictly increasing, equal to the
 * line number), the envelope .flauz/harness/acceptance-runs.json
 * (the replay-built run state, cross-checked byte-for-byte) and the
 * canonical report emission .flauz/harness/acceptance-report.json.
 * The ledger is authoritative: the replay re-proves the acceptance
 * laws FROM THE LEDGER ALONE (the frozen line schema, the op order,
 * the unique-industry law, the row walks, THE GAP-MUST-BE-REGISTERED
 * LAW, the census identity); the envelope is cross-checked
 * byte-for-byte (E_LEDGER_TORN / E_ENVELOPE_MISMATCH - never
 * silently rebuilt). Lazy persistence; a fresh runner never appends
 * over an existing non-empty acceptance ledger (reopen with
 * loadAcceptanceRunner); the terminal walk is RESUMABLE (each
 * terminal stage is guarded by its OWN committed state slot - a
 * refusal between terminal lines heals by re-running ONLY the
 * un-landed stages, never re-appending a landed line, never
 * fabricating a torn ledger); a re-run over a COMPLETE run
 * re-derives and re-emits the identical report bytes WITHOUT
 * appending (the idempotent re-read, disclosed; the emission
 * receipt's appendedOps counts exactly the lines THIS call landed);
 * restart-deterministic.
 *
 * THE IMPORT LAW (binding): every module this runner drives is the
 * OWNING family's own, imported by reference - the kits, the load
 * surfaces, the ledger path constants, the LAB modules, the
 * vocabularies. Never re-implemented, never transcribed.
 *
 * THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 * new Date(...) and no process.env in this module (law comments
 * excepted); the clock, the rng and the fs port are INJECTED seams
 * forwarded to the real kits verbatim; the runner consumes exactly
 * ONE clock read and ONE rng read at construction (the seam
 * contracts validated there, the construction reading doubling as
 * the activity corpus's occurredAt stamp).
 */

import {
        ACCEPTANCE_BENCHMARK_STATUSES,
        ACCEPTANCE_DISCLOSURES,
        ACCEPTANCE_GAP_KEYS,
        ACCEPTANCE_INDUSTRIES,
        COMPOSITION_VERSION_FAMILY_KEYS,
        HARNESS_ACCEPTANCE_GAP_LEDGER,
        HARNESS_ACCEPTANCE_VERSION,
        LAB_CONTRACTS_VERSION,
        benchmarkBindingOf,
        isAcceptanceClosedGapKey,
        validateIndustryVerdictRow,
        validateIndustryAcceptanceFixture,
        serializeAcceptanceReport,
        validateHarnessAcceptanceReport,
} from './acceptanceContract.js';
import type {
        AcceptanceGapRow,
        AcceptanceLegVerdict,
        BenchmarkBinding,
        HarnessCompositionCensus,
        HarnessAcceptanceReport,
        IndustryAcceptanceFixture,
        IndustryAcceptanceVerdict,
        OverallVerdictRow,
        CompositionCensusRow,
        UiSectionStateRow,
} from './acceptanceContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        PROFILES_CONTRACTS_VERSION,
        BENCHMARKS_CONTRACTS_VERSION,
        PROJECTIONS_CONTRACTS_VERSION,
        ACTIVATION_CONTRACTS_VERSION,
        OPTIMIZATION_CONTRACTS_VERSION,
} from './acceptanceContract.js';
import type { HarnessCatalogSnapshot, HarnessIndustry, HarnessLifecycleState, HarnessRecord } from '../../contract/common/domainHarnessContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';
import { loadHarnessKit } from '../../contract/common/domainHarnessKit.js';
import { loadOnboardingKit } from '../../onboarding/common/onboardingKit.js';
import type { OnboardingSessionRecord } from '../../onboarding/common/onboardingContract.js';
import type { RoleCompositionSession } from '../../roles/common/rolesContract.js';
import { loadRolesKit, ROLES_LEDGER_RELATIVE_PATH } from '../../roles/common/rolesKit.js';
import { loadOntologyKit, ONTOLOGY_LEDGER_RELATIVE_PATH } from '../../ontology/common/ontologyKit.js';
import type { DomainOntologyRecord } from '../../ontology/common/ontologyContract.js';
import { loadTemplatesKit, TEMPLATES_LEDGER_RELATIVE_PATH } from '../../templates/common/templatesKit.js';
import type { WorkflowTemplateRecord } from '../../templates/common/templatesContract.js';
import { loadBodiesKit, BODIES_LEDGER_RELATIVE_PATH } from '../../bodies/common/bodiesKit.js';
import type { OrganizationDefaultsRecord } from '../../bodies/common/bodiesContract.js';
import { loadPacksKit, PACKS_LEDGER_RELATIVE_PATH } from '../../packs/common/packsKit.js';
import type { CapabilityPacksRecord } from '../../packs/common/packsContract.js';
import { loadProfilesKit, PROFILES_LEDGER_RELATIVE_PATH } from '../../profiles/common/profilesKit.js';
import type { ProfilesRecord } from '../../profiles/common/profilesContract.js';
import { loadBenchmarksKit, BENCHMARKS_LEDGER_RELATIVE_PATH } from '../../benchmarks/common/benchmarksKit.js';
import type { BenchmarksKit, BenchmarkInstanceBundle, BenchmarkEvaluationResult } from '../../benchmarks/common/benchmarksKit.js';
import type { BenchmarksRecord, BenchmarkEntry } from '../../benchmarks/common/benchmarksContract.js';
import { createActivationKit, loadActivationKit, ACTIVATION_LEDGER_RELATIVE_PATH } from '../../activation/common/activationKit.js';
import type { ActivationKit, ActivationKitRefusal } from '../../activation/common/activationKit.js';
import type { ActivationJourneyRecord, ComposedRecordLinks } from '../../activation/common/activationContract.js';
import { createProjectionsKit } from '../../projections/common/projectionsKit.js';
import type { ProjectionsKit, KitProjectionOutcome } from '../../projections/common/projectionsKit.js';
import type { DomainNavigationModel, ProjectionsRejection } from '../../projections/common/projectionsContract.js';
import { createOptimizationKit, loadOptimizationKit, OPTIMIZATION_LEDGER_RELATIVE_PATH } from '../../optimization/common/optimizationKit.js';
import type { OptimizationKit, OptimizationKitRefusal } from '../../optimization/common/optimizationKit.js';
import type { OptimizationLoopRecord } from '../../optimization/common/optimizationContract.js';
import { TASK_WORLDS } from '../../../lab/common/taskWorlds.js';
import type { WorldInstance } from '../../../lab/common/taskWorlds.js';
import { ALL_TASK_WORLDS, generateTaskInstances } from '../../../lab/common/industryTaskWorlds.js';
import { runClosedLoop } from '../../../lab/common/closedLoop.js';
import type { ClosedLoopProof } from '../../../lab/common/closedLoop.js';
import type { LabActivityRecord } from '../../../lab/common/workloadLearning.js';
import type { EvalScore, LabScope, LabEvidenceLevel } from '../../../lab/common/labContracts.js';
import { SOFTWARE_ACCEPTANCE_FIXTURE } from '../industries/software.js';
import { FINANCE_ACCEPTANCE_FIXTURE } from '../industries/finance.js';
import { HEALTHCARE_ACCEPTANCE_FIXTURE } from '../industries/healthcare.js';
import { CONSTRUCTION_ACCEPTANCE_FIXTURE } from '../industries/construction.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { HARNESS_ACCEPTANCE_VERSION } from './acceptanceContract.js';

// --- the family's own persistence surfaces (the CR-013 report emission + the PIN-2 mirror) -----------------

/** The canonical report path (relative to the injected root; the CR-013 pattern's report name). */
export const ACCEPTANCE_REPORT_RELATIVE_PATH = '.flauz/harness/acceptance-report.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree as the real kits, distinct file). */
export const ACCEPTANCE_LEDGER_RELATIVE_PATH = '.flauz/harness/acceptance-ops.jsonl';

/** The run-state envelope path (relative to the injected root; cross-checked byte-for-byte against the ledger replay). */
export const ACCEPTANCE_ENVELOPE_RELATIVE_PATH = '.flauz/harness/acceptance-runs.json';

/**
 * The frozen ops vocabulary, in the canonical op order: the four
 * per-industry runs (any unique industry order; the cross run drives
 * the four in the frozen lane order), then - only once every lane
 * industry has run - the terminal walk: compose-census ->
 * register-gaps -> resolve-verdict -> emit-report (each exactly once,
 * in this order).
 */
export const ACCEPTANCE_OP_NAMES = [
        'run-industry',
        'compose-census',
        'register-gaps',
        'resolve-verdict',
        'emit-report',
] as const;
export type AcceptanceOpName = (typeof ACCEPTANCE_OP_NAMES)[number];

/** Pure predicate over the closed ops vocabulary. */
export function isAcceptanceOpName(value: unknown): value is AcceptanceOpName {
        return (ACCEPTANCE_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the serialization order). The industry column carries the run
 * industry on run-industry lines and null on the terminal lines; the
 * payload carries the op's own evidence (the industry verdict row,
 * the census, the registered gap keys, the overall verdict, the
 * emission receipt).
 */
export const ACCEPTANCE_LEDGER_LINE_SCHEMA_KEYS = [
        'seq',
        'at',
        'contractVersion',
        'op',
        'industry',
        'law',
        'payload',
        'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order (the replay-built run state). */
export const ACCEPTANCE_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'run'] as const;

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * fixture-rejection reasons):
 *   E_LEDGER_TORN           - THE APPEND-ONLY LEDGER LAW: a torn or
 *                             missing acceptance ledger line, a
 *                             structurally invalid or out-of-order line,
 *                             an unknown op, a foreign contract
 *                             version, a repeated industry, a
 *                             terminal op out of order or before the
 *                             four lane industries, a payload failing
 *                             its walk, or a fresh runner attempting
 *                             to append over an existing non-empty
 *                             acceptance ledger (reopen with
 *                             loadAcceptanceRunner);
 *   E_ENVELOPE_MISMATCH     - THE APPEND-ONLY LEDGER LAW: the run
 *                             envelope diverges from the ledger
 *                             replay (or is missing / malformed while
 *                             the ledger carries lines) - never
 *                             silently rebuilt;
 *   ACCEPTANCE_IO           - THE FAIL-CLOSED LAW: the injected fs
 *                             port refused a read / append / write /
 *                             mkdir on the acceptance family's own
 *                             files;
 *   CORRUPT_SEAM            - THE DETERMINISM LAW: the injected clock
 *                             returned a malformed reading mid-op (an
 *                             empty timestamp for a ledger line).
 * Plus the domain reasons:
 *   disposed                - THE DISPOSE LAW;
 *   malformed-fixture       - the fixture walk refused (the contract's
 *                             typed rejection table carried verbatim);
 *   industry-already-run    - THE UNIQUE-INDUSTRY LAW: the industry
 *                             already carries a completed row on this
 *                             runner (a re-run is a NEW runner or a
 *                             reload, never a second row);
 *   journey-refused         - THE VERBATIM-CARRY LAW: the REAL DH-11
 *                             journey kit refused a leg (the real
 *                             refusal carried COMPLETE); fail-closed -
 *                             the whole verdict refuses with it;
 *   record-read-refused     - THE VERBATIM-CARRY LAW: a REAL family
 *                             load / inspect surface refused the read
 *                             of a composed record (the real refusal
 *                             carried COMPLETE);
 *   navigation-refused      - THE VERBATIM-CARRY LAW: the REAL DH-10
 *                             projection refused the inputs (the
 *                             COMPLETE contract rejection table
 *                             carried);
 *   benchmark-leg-refused   - THE VERBATIM-CARRY LAW: the REAL DH-09
 *                             read surface refused the instantiation
 *                             or the evaluation (the real refusal
 *                             carried COMPLETE);
 *   closed-loop-refused     - THE HONEST-GAP LAW: the REAL LAB
 *                             closedLoop returned undefined (a gate
 *                             refused the proof - the loop is honest
 *                             about what it could not close; the
 *                             refusal names the honest gap);
 *   optimization-refused    - THE VERBATIM-CARRY LAW: the REAL DH-12
 *                             loop kit refused a smoke leg (the real
 *                             refusal carried COMPLETE);
 *   gap-registration-missing - THE FAIL-CLOSED VERDICT LAW: a required
 *                             honest gap row is missing at the verdict
 *                             boundary (never a silent pass);
 *   census-divergence       - THE COMPOSITION-NOT-FORK LAW: the
 *                             industries' composed records carry
 *                             divergent family versions (the no-fork
 *                             census is breached), or a family ledger
 *                             carries divergent versions;
 *   invalid-report          - THE FAIL-CLOSED VERDICT LAW: the built
 *                             report failed its own canonical walk.
 */
export const ACCEPTANCE_RUNNER_REFUSAL_REASONS = [
        'disposed',
        'malformed-fixture',
        'industry-already-run',
        'journey-refused',
        'record-read-refused',
        'navigation-refused',
        'benchmark-leg-refused',
        'closed-loop-refused',
        'optimization-refused',
        'gap-registration-missing',
        'census-divergence',
        'invalid-report',
        'E_LEDGER_TORN',
        'E_ENVELOPE_MISMATCH',
        'ACCEPTANCE_IO',
        'CORRUPT_SEAM',
] as const;
export type AcceptanceRunnerRefusalReason = (typeof ACCEPTANCE_RUNNER_REFUSAL_REASONS)[number];

/** Pure predicate over the closed refusal list. */
export function isAcceptanceRunnerRefusalReason(value: unknown): value is AcceptanceRunnerRefusalReason {
        return (ACCEPTANCE_RUNNER_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/** One ledger line (the canonical persisted op; the replay's input shape). */
export interface AcceptanceOpsLedgerLine {
        readonly seq: number;
        readonly at: string;
        readonly contractVersion: string;
        readonly op: AcceptanceOpName;
        readonly industry: HarnessIndustry | null;
        readonly law: string;
        readonly payload: unknown;
        readonly detail: string;
}

/**
 * The typed runner refusal: the frozen reason, the violated law's
 * name, the deterministic message, the optional offending items and -
 * THE VERBATIM-CARRY LAW - the owning real surface's OWN typed
 * refusal, carried COMPLETE, never paraphrased (fixtureRejection for
 * the contract-level walk; activationRefusal for the REAL DH-11 kit;
 * recordReadRefusal for one of the REAL family load / inspect
 * surfaces; navigationRejections for the REAL DH-10 contract walk;
 * benchmarksRefusal for the REAL DH-09 read surface;
 * optimizationRefusal for the REAL DH-12 loop kit).
 */
export interface AcceptanceRunnerRefusal {
        readonly reason: AcceptanceRunnerRefusalReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
        /** THE VERBATIM-CARRY LAW: the contract-level fixture walk's typed rejection. */
        readonly fixtureRejection?: { readonly reason: string; readonly law: string; readonly message: string; readonly items?: readonly string[] };
        /** THE VERBATIM-CARRY LAW: the REAL DH-11 activation journey kit's own typed refusal. */
        readonly activationRefusal?: ActivationKitRefusal;
        /** THE VERBATIM-CARRY LAW: the REAL family load / inspect surface's own typed refusal. */
        readonly recordReadRefusal?: { readonly reason: string; readonly law: string; readonly message: string; readonly items?: readonly string[]; readonly detail?: string };
        /** THE VERBATIM-CARRY LAW: the REAL DH-10 projection's COMPLETE contract rejection table. */
        readonly navigationRejections?: readonly ProjectionsRejection[];
        /** THE VERBATIM-CARRY LAW: the REAL DH-09 benchmarks kit's own typed refusal. */
        readonly benchmarksRefusal?: { readonly reason: string; readonly law: string; readonly message: string; readonly items?: readonly string[]; readonly detail?: string };
        /** THE VERBATIM-CARRY LAW: the REAL DH-12 optimization loop kit's own typed refusal. */
        readonly optimizationRefusal?: OptimizationKitRefusal;
}

/** The per-industry run outcome: ok carries the honest verdict row; failure carries the typed refusal. */
export type IndustryRunOutcome =
        | { readonly ok: true; readonly verdict: IndustryAcceptanceVerdict }
        | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/** The emission receipt (the canonical report bytes written through the injected fs port). */
export interface AcceptanceEmission {
        readonly path: string;
        readonly bytes: number;
        readonly appendedOps: number;
}

/** The cross-industry run outcome: ok carries the report + the emission; failure carries the typed refusal. */
export type CrossIndustryRunOutcome =
        | { readonly ok: true; readonly report: HarnessAcceptanceReport; readonly emission: AcceptanceEmission }
        | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/** The run inspection outcome: ok carries the honest run state; failure carries the typed refusal. */
export type AcceptanceInspectOutcome =
        | { readonly ok: true; readonly rows: readonly IndustryAcceptanceVerdict[]; readonly complete: boolean; readonly report: HarnessAcceptanceReport | null }
        | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/** The load outcome: ok carries the reopened runner; failure carries the typed refusal. */
export type AcceptanceLoadOutcome =
        | { readonly ok: true; readonly runner: AcceptanceRunner }
        | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * The runner construction options (all injected, never env-read; the
 * catalog is NOT a runner seam - the runner constructs it from the
 * fixtures' permissionRefs, THE CATALOG SEAM above).
 */
export interface AcceptanceRunnerOptions {
        /** The injected clock (returns the ISO string; forwarded to every real kit verbatim). */
        readonly clock: () => string;
        /** The id-minting seam (returns 16 lowercase hex chars; NEVER the random global; forwarded to every real kit). */
        readonly rng: () => string;
        /** The filesystem seam (the ONLY filesystem seam; shared with every real kit the runner constructs). */
        readonly fsPort: HarnessFsPort;
        /** The persistence root (the .flauz/harness subtree lands under it - the runner's mirror AND the real kits' own ledgers). */
        readonly root: string;
}

/** The run state (the replay-built fold; the envelope's content). */
interface AcceptanceRunState {
        readonly contractVersion: string;
        readonly seq: number;
        readonly industries: readonly HarnessIndustry[];
        readonly rows: ReadonlyMap<HarnessIndustry, IndustryAcceptanceVerdict>;
        readonly compositionCensus: HarnessCompositionCensus | null;
        /** THE RESUMABLE TERMINAL WALK's register-gaps marker (true iff the register-gaps line landed; invisible to the envelope/report surfaces). */
        readonly gapsRegistered: boolean;
        readonly overallVerdict: OverallVerdictRow | null;
        readonly emission: { readonly path: string; readonly bytes: number } | null;
}

/** The runner's validated seams (the construction reading doubles as the corpus stamp). */
interface BoundRunnerOptions {
        readonly clock: () => string;
        readonly rng: () => string;
        readonly fsPort: HarnessFsPort;
        readonly root: string;
        /** The construction clock reading (the activity corpus's occurredAt stamp - deterministic, one read). */
        readonly constructionClock: string;
}

/**
 * The deterministic cross-industry acceptance runner: every operation
 * is async with a typed outcome ({ ok: true, ... } | { ok: false,
 * refusal }); every leg routes THROUGH the real kits (THE IMPORT
 * LAW); a refused op leaves the run state unchanged (the
 * record-unchanged law).
 */
export interface AcceptanceRunner {
        runIndustryAcceptance(fixture: unknown): Promise<IndustryRunOutcome>;
        runCrossIndustryAcceptance(): Promise<CrossIndustryRunOutcome>;
        inspectRun(): AcceptanceInspectOutcome;
        dispose(): void;
}

/** The frozen four-fixture lane (THE COMPOSITION-NOT-FORK LAW: the fixtures are the only per-industry data). */
const LANE_FIXTURES: Readonly<Record<(typeof ACCEPTANCE_INDUSTRIES)[number], IndustryAcceptanceFixture>> = {
        software: SOFTWARE_ACCEPTANCE_FIXTURE,
        finance: FINANCE_ACCEPTANCE_FIXTURE,
        healthcare: HEALTHCARE_ACCEPTANCE_FIXTURE,
        construction: CONSTRUCTION_ACCEPTANCE_FIXTURE,
};

// --- the derivations (uniform over the fixture data + the REAL registries; never an industry branch) ----------

/** The REAL base-registry scenario ids, derived from the REAL landed registry (THE SCENARIO-BINDING LAW's pin-by-import; the registry-bound floor entry and the closedLoop's drivable scenario). */
const REAL_SCENARIO_IDS: readonly string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

/** The frozen seed/count pair for the benchmark instantiation leg (seeded, reproducible). */
const BENCHMARK_SEED = 11;
const BENCHMARK_INSTANCE_COUNT = 4;

/** The per-industry LAB scope (data-derived from the fixture's industry). */
function scopeOf(industry: HarnessIndustry): LabScope {
        return { workspaceId: `flauz-acceptance-${industry}`, tenantId: 'flauz-acceptance' };
}

/**
 * The activity corpus, DERIVED from the REAL combined catalog: two records
 * per REAL scenario across ALL_TASK_WORLDS (the landed SE world plus the
 * three industry worlds, imported by reference), the task family taken from
 * the scenario id's family segment, stamped at the given occurredAt (the
 * runner's construction clock reading - the corpus is the combined
 * catalog's own world mix, honestly disclosed at the fixture evidence
 * level).
 */
function deriveRegistryCorpus(scope: LabScope, occurredAt: string): LabActivityRecord[] {
        const records: LabActivityRecord[] = [];
        for (const world of ALL_TASK_WORLDS) {
                for (const scenario of world.taskScenarios) {
                        const segments = scenario.id.split('-');
                        const family = segments.length >= 3 ? segments[2] : scenario.taskTypeId.slice(3);
                        for (let i = 0; i < 2; i += 1) {
                                records.push({
                                        scope,
                                        taskFamily: family,
                                        toolKinds: ['editor', 'shell', 'test-runner'],
                                        usedBrowser: false,
                                        usedEnvironment: true,
                                        durationMinutes: 40 + 5 * i,
                                        complexityHint: 0.4,
                                        parallelThreads: 1,
                                        humanInterventions: i % 2,
                                        requiredReview: true,
                                        qualitySensitivity: 0.7,
                                        costSensitivity: 0.3,
                                        latencySensitivity: 0.5,
                                        occurredAt,
                                });
                        }
                }
        }
        return records;
}

/**
 * THE REGISTRY-BOUND BENCHMARK DERIVATION (uniform over the fixture
 * data): bound to the REAL base-registry scenario ids (imported from
 * the REAL landed registry), keyed by the fixture's own industry,
 * measuring the fixture's own declared KPI dimensions (the union
 * across its profiles), with the limitation disclosed IN the entry.
 * The journey composes this entry when the fixture carries no
 * base-registry curated benchmark - the honest compose floor over the
 * scenarios the LANDED DH-09 binding law can carry (the industry
 * fixtures' curated benchmark legs ride the combined catalog through
 * the benchmark-leg composition - the honest split, disclosed IN this
 * entry).
 */
function registryBoundBenchmark(fixture: IndustryAcceptanceFixture): BenchmarkEntry {
        const dimensions: string[] = [];
        for (const profile of fixture.profiles) {
                for (const dimension of profile.kpiDimensions) {
                        if (!dimensions.includes(dimension)) {
                                dimensions.push(dimension);
                        }
                }
        }
        return {
                benchmarkKey: `${fixture.industry}-registry-bound-acceptance`,
                summary: `The ${fixture.industry} acceptance journey's registry-bound benchmark (the DH-09 compose floor honored over the scenarios the landed binding law can carry).`,
                hypothesis: `A composed ${fixture.industry} agent organization completes the seeded software-engineering fixture scenarios with a higher success rate than the single-agent baseline.`,
                scenarioRefs: [...REAL_SCENARIO_IDS],
                kpiDimensions: dimensions as BenchmarkEntry['kpiDimensions'],
                expectedOutcome: 'The candidate clears every acceptance criterion on the seeded SE fixture instances.',
                limitations: `The REAL DH-09 binding law resolves scenarioRefs against the landed base registry (the SE fixture world); the curated ${fixture.industry} benchmark leg binds the industry's own scenarios through the combined catalog - the honest split, disclosed in this floor entry.`,
                evidenceLevel: 'fixture',
        };
}

/**
 * The journey's benchmarks content (the DH-09 record's own compose floor): the
 * fixture's curated BASE-REGISTRY entry when present, the registry-bound
 * derivation otherwise (the honest-null and the industry-extension-binding
 * fixtures - the DH-09 binding law cannot carry the industry refs; data-driven
 * over the binding mode, never an industry branch).
 */
function journeyBenchmarkOf(fixture: IndustryAcceptanceFixture): BenchmarkEntry {
        const binding = benchmarkBindingOf(fixture.benchmark);
        return binding === null || binding.mode !== 'base-registry' ? registryBoundBenchmark(fixture) : binding.entry;
}

/** The optimization-smoke delta's rationale (data-derived). */
function deltaRationaleOf(fixture: IndustryAcceptanceFixture): string {
        return `The ${fixture.industry} acceptance recommendation: add the curated fixture content (the terms, tasks, bodies, packs and profiles) and the registry-scoped benchmark to the composed configuration.`;
}

/**
 * The deterministic fixture-measure derivation over the instantiated
 * bundle's OWN difficulty values (rounded to 3 decimals for the
 * byte-deterministic law): success = the fraction of instances at or
 * below the 0.6 difficulty floor; quality = the complement of the
 * mean difficulty; latency / cost = the mean difficulty (the honest
 * fixture proxy). Only the benchmark's DECLARED dimensions are
 * emitted (the DH-09 coverage law: exactly the declared KPIs, each
 * once) - the runner never invents a score for an undeclared
 * dimension and the kit never invents the missing one.
 */
function deriveMeasures(benchmark: BenchmarkEntry, bundle: BenchmarkInstanceBundle): EvalScore[] {
        const instances: readonly WorldInstance[] = bundle.scenarioInstances.flatMap((scenario) => [...scenario.instances]);
        const count = instances.length === 0 ? 1 : instances.length;
        const cleared = instances.filter((instance) => instance.difficulty <= 0.6).length;
        let difficultySum = 0;
        for (const instance of instances) {
                difficultySum += instance.difficulty;
        }
        const meanDifficulty = roundTo3(difficultySum / count);
        const scores: EvalScore[] = [];
        for (const dimension of benchmark.kpiDimensions) {
                if (dimension === 'success') {
                        scores.push({ dimension, value: roundTo3(cleared / count) });
                } else if (dimension === 'quality') {
                        scores.push({ dimension, value: roundTo3(1 - meanDifficulty) });
                } else {
                        scores.push({ dimension, value: meanDifficulty });
                }
        }
        return scores;
}

/** Rounds to 3 decimals (the byte-deterministic law's canonical rounding). */
function roundTo3(value: number): number {
        return Math.round(value * 1000) / 1000;
}

// --- the construction + the load ---------------------------------------------------------------------------

/** Reads a possibly-missing text file through the injected fs port (null on ENOENT; the IO refusal propagates - the landed family pattern). */
async function readText(port: HarnessFsPort, path: string): Promise<string | null> {
        try {
                return await port.readFile(path, 'utf8');
        } catch (error) {
                const code = (error as { code?: unknown }).code;
                if (code === 'ENOENT') {
                        return null;
                }
                throw error;
        }
}

/**
 * Creates an acceptance runner (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-11/DH-12
 * factory walk EXACTLY (the same preconditions, the same message
 * shapes, the createAcceptanceRunner prefix): the options shape
 * (clock / rng / fsPort / root - no catalog seam: the runner
 * constructs the catalog from the fixtures' permissionRefs), the
 * clock's first read (a non-empty ISO string), the rng's first read
 * (exactly 16 lowercase hex chars - the seam contract), the fs
 * port's four functions and the non-empty root. The factory consumes
 * exactly ONE clock read and ONE rng read (the construction reading
 * doubles as the activity corpus's occurredAt stamp). The runner
 * starts with ZERO completed rows; persistence is LAZY; a fresh
 * runner never appends over an existing non-empty acceptance ledger
 * (reopen with loadAcceptanceRunner).
 */
export function createAcceptanceRunner(options: AcceptanceRunnerOptions): AcceptanceRunner {
        const bound = validateRunnerOptions(options, 'createAcceptanceRunner');
        return buildRunner(bound, { contractVersion: HARNESS_ACCEPTANCE_VERSION, seq: 0, industries: [], rows: new Map(), compositionCensus: null, gapsRegistered: false, overallVerdict: null, emission: null }, false);
}

/**
 * Reopens a persisted acceptance runner: replays the append-only
 * acceptance ops ledger (the authoritative surface - each line
 * re-validated: the frozen eight-key line schema, the op's vocabulary
 * and terminal order, the unique-industry law, the payload walks
 * through the contract's own row / census / verdict walks, THE
 * GAP-MUST-BE-REGISTERED LAW - re-proven from the ledger alone),
 * cross-checks the envelope byte-for-byte against the replay-built
 * state, and reopens the REAL kits through their OWN load surfaces
 * lazily (the first industry run after the reload constructs the
 * activation / optimization kits through the REAL load*Kit surfaces).
 * A torn or missing acceptance ledger line is the typed
 * E_LEDGER_TORN; a divergent, missing or malformed envelope is the
 * typed E_ENVELOPE_MISMATCH (never silently rebuilt); a refused fs
 * port is the typed ACCEPTANCE_IO. A fresh root (no files) reopens
 * as an empty runner.
 */
export async function loadAcceptanceRunner(options: AcceptanceRunnerOptions): Promise<AcceptanceLoadOutcome> {
        const bound = validateRunnerOptions(options, 'loadAcceptanceRunner');
        const ledgerPath = `${bound.root}/${ACCEPTANCE_LEDGER_RELATIVE_PATH}`;
        const envelopePath = `${bound.root}/${ACCEPTANCE_ENVELOPE_RELATIVE_PATH}`;
        try {
                await bound.fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return { ok: false, refusal: refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `loadAcceptanceRunner: the fs port refused the root mkdir: ${toMessage(error)}`) };
        }
        let ledgerText: string | null;
        try {
                ledgerText = await readText(bound.fsPort, ledgerPath);
        } catch (error) {
                return { ok: false, refusal: refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `loadAcceptanceRunner: the fs port refused the acceptance ledger read: ${toMessage(error)}`) };
        }
        let envelopeText: string | null;
        try {
                envelopeText = await readText(bound.fsPort, envelopePath);
        } catch (error) {
                return { ok: false, refusal: refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `loadAcceptanceRunner: the fs port refused the acceptance envelope read: ${toMessage(error)}`) };
        }
        if (ledgerText === null) {
                if (envelopeText !== null) {
                        return { ok: false, refusal: refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadAcceptanceRunner: an envelope without a ledger is divergent (never silently rebuilt)') };
                }
                return { ok: true, runner: buildRunner(bound, { contractVersion: HARNESS_ACCEPTANCE_VERSION, seq: 0, industries: [], rows: new Map(), compositionCensus: null, gapsRegistered: false, overallVerdict: null, emission: null }, true) };
        }
        const replay = replayAcceptanceLedger(ledgerText);
        if (!replay.ok) {
                return { ok: false, refusal: replay.refusal };
        }
        const state = replay.state;
        const expectedEnvelope = `${JSON.stringify({ contractVersion: state.contractVersion, seq: state.seq, run: envelopeRunOf(state) })}\n`;
        if (envelopeText === null) {
                return { ok: false, refusal: refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadAcceptanceRunner: the ledger carries lines but the envelope is missing (never silently rebuilt)') };
        }
        if (envelopeText !== expectedEnvelope) {
                return { ok: false, refusal: refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadAcceptanceRunner: the run envelope diverges from the ledger replay (never silently rebuilt; the ledger is authoritative)') };
        }
        return { ok: true, runner: buildRunner(bound, state, true) };
}

// --- the runner ----------------------------------------------------------------------------------------------

function buildRunner(bound: BoundRunnerOptions, state: AcceptanceRunState, reloaded: boolean): AcceptanceRunner {
        /** THE CATALOG SEAM: ONE mutable snapshot shared by every kit the runner constructs. */
        const catalog = { capabilities: [] as { entryId: string; state: string }[], workflowIds: [] as string[], policyIds: [] as string[], evidenceIds: [] as string[] };
        const activationKits: ActivationKit[] = [];
        let optimizationKit: OptimizationKit | null = null;
        let projectionsKit: ProjectionsKit | null = null;
        let current: AcceptanceRunState = state;
        let disposed = false;
        let freshGuardChecked = reloaded;

        function refuseIfDisposed(op: string): AcceptanceRunnerRefusal | undefined {
                if (disposed) {
                        return refused('disposed', 'THE DISPOSE LAW', `buildRunner: the runner was disposed - the ${op} operation rejects (every real kit the runner constructed is disposed with it)`);
                }
                return undefined;
        }

        /** THE APPEND-ONLY LEDGER LAW's fresh-kit guard: a fresh runner never appends over an existing non-empty acceptance ledger. */
        async function guardFreshOverLedger(op: string): Promise<AcceptanceRunnerRefusal | null> {
                if (freshGuardChecked) {
                        return null;
                }
                freshGuardChecked = true;
                const ledgerText = await readText(bound.fsPort, `${bound.root}/${ACCEPTANCE_LEDGER_RELATIVE_PATH}`);
                if (ledgerText !== null && ledgerText.trim().length > 0) {
                        return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `buildRunner.${op}: a fresh runner never appends over an existing non-empty acceptance ledger (reopen with loadAcceptanceRunner)`);
                }
                return null;
        }

        /** The typed verbatim-carry read refusal (the family refusals carry `detail`, the onboarding refusal `message` - both carried). */
        function readRefused(op: string, family: string, refusal: { readonly reason: string; readonly law: string; readonly message?: string; readonly detail?: string; readonly items?: readonly string[] }): AcceptanceRunnerRefusal {
                const message = refusal.message !== undefined ? refusal.message : refusal.detail !== undefined ? refusal.detail : '';
                return {
                        reason: 'record-read-refused',
                        law: `THE VERBATIM-CARRY LAW (the ${family} read)`,
                        message: `buildRunner.${op}: the REAL ${family} load / inspect surface refused the composed-record read - the real refusal is carried COMPLETE below`,
                        recordReadRefusal: { reason: refusal.reason, law: refusal.law, message, ...(refusal.items === undefined ? {} : { items: [...refusal.items] }) },
                };
        }

        /**
         * Opens the REAL DH-11 activation journey kit for ONE industry run (THE
         * COMPOSITION-NOT-FORK LAW: ONE code path, the SAME seams, every industry):
         * the REAL createActivationKit for a fresh root, the REAL loadActivationKit
         * whenever the activation ledger carries lines - the families' own restart
         * discipline (a kit instance is an in-memory snapshot; the ledger is the
         * live surface; every inner authority is reopened current).
         */
        async function openActivationKit(op: string): Promise<ActivationKit | AcceptanceRunnerRefusal> {
                const ledgerText = await readText(bound.fsPort, `${bound.root}/${ACTIVATION_LEDGER_RELATIVE_PATH}`);
                if (ledgerText !== null && ledgerText.trim().length > 0) {
                        const loaded = await loadActivationKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return readRefused(op, 'activation', loaded.refusal);
                        }
                        activationKits.push(loaded.kit);
                        return loaded.kit;
                }
                const created = createActivationKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
                activationKits.push(created);
                return created;
        }

        /** Ensures the ONE shared REAL DH-12 optimization loop kit (THE COMPOSITION-NOT-FORK LAW): constructed once, reused for every industry. */
        async function ensureOptimizationKit(op: string): Promise<OptimizationKit | AcceptanceRunnerRefusal> {
                if (optimizationKit !== null) {
                        return optimizationKit;
                }
                const ledgerText = await readText(bound.fsPort, `${bound.root}/${OPTIMIZATION_LEDGER_RELATIVE_PATH}`);
                if (ledgerText !== null && ledgerText.trim().length > 0) {
                        const loaded = await loadOptimizationKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
                        if (!loaded.ok) {
                                return readRefused(op, 'optimization', loaded.refusal);
                        }
                        optimizationKit = loaded.kit;
                } else {
                        optimizationKit = createOptimizationKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
                }
                return optimizationKit;
        }

        /** Ensures the ONE shared REAL DH-10 projections kit (THE COMPOSITION-NOT-FORK LAW; THE ZERO-SEAM LAW: no seams at all). */
        function ensureProjectionsKit(): ProjectionsKit {
                if (projectionsKit === null) {
                        projectionsKit = createProjectionsKit();
                }
                return projectionsKit;
        }

        /** THE CATALOG SEAM's seed: the fixture's permissionRefs at approved/enabled states (idempotent by entryId, deterministic by first-seen order). */
        function seedCatalog(fixture: IndustryAcceptanceFixture): void {
                const permissions: string[] = [];
                for (const profile of fixture.profiles) {
                        for (const permissionRef of profile.permissionRefs) {
                                if (!permissions.includes(permissionRef)) {
                                        permissions.push(permissionRef);
                                }
                        }
                }
                for (let i = 0; i < permissions.length; i += 1) {
                        if (!catalog.capabilities.some((entry) => entry.entryId === permissions[i])) {
                                catalog.capabilities.push({ entryId: permissions[i], state: i % 2 === 0 ? 'approved' : 'enabled' });
                        }
                }
        }

        /** The proposal boundary's catalog wiring: the emitted composed record refs (THE CATALOG-BINDING LAW). */
        function wireCatalog(links: ComposedRecordLinks): void {
                if (!catalog.capabilities.some((entry) => entry.entryId === links.packsId)) {
                        catalog.capabilities.push({ entryId: links.packsId, state: 'approved' });
                }
                if (!catalog.capabilities.some((entry) => entry.entryId === links.bodyId)) {
                        catalog.capabilities.push({ entryId: links.bodyId, state: 'enabled' });
                }
                if (!catalog.workflowIds.includes(links.templateId)) {
                        catalog.workflowIds.push(links.templateId);
                }
                if (!catalog.policyIds.includes(links.profilesId)) {
                        catalog.policyIds.push(links.profilesId);
                }
                if (!catalog.evidenceIds.includes(links.profilesId)) {
                        catalog.evidenceIds.push(links.profilesId);
                }
                if (!catalog.evidenceIds.includes(links.benchmarksId)) {
                        catalog.evidenceIds.push(links.benchmarksId);
                }
        }

        /** The clock reading for a ledger line (the seam contract validated per read). */
        function readClock(op: string): { readonly at: string } | { readonly refusal: AcceptanceRunnerRefusal } {
                const at = bound.clock();
                if (typeof at !== 'string' || at.length === 0) {
                        return { refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', `buildRunner.${op}: the injected clock returned a malformed reading (an empty timestamp for a ledger line)`) };
                }
                return { at };
        }

        /** THE APPEND-ONLY LEDGER LAW's append: the line lands, the envelope rewrites; both IO refusals typed; the state commits ONLY after both. */
        async function appendLine(op: string, line: { readonly op: AcceptanceOpName; readonly industry: HarnessIndustry | null; readonly law: string; readonly payload: unknown; readonly detail: string }, next: AcceptanceRunState): Promise<AcceptanceRunnerRefusal | null> {
                const clock = readClock(op);
                if ('refusal' in clock) {
                        return clock.refusal;
                }
                const fullLine = { seq: current.seq + 1, at: clock.at, contractVersion: HARNESS_ACCEPTANCE_VERSION, ...line };
                const envelope = { contractVersion: HARNESS_ACCEPTANCE_VERSION, seq: fullLine.seq, run: envelopeRunOf(next) };
                try {
                        await bound.fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
                } catch (error) {
                        return refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `buildRunner.${op}: the fs port refused the root mkdir: ${toMessage(error)}`);
                }
                try {
                        await bound.fsPort.appendFile(`${bound.root}/${ACCEPTANCE_LEDGER_RELATIVE_PATH}`, `${JSON.stringify(fullLine)}\n`);
                } catch (error) {
                        return refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `buildRunner.${op}: the fs port refused the acceptance ledger append: ${toMessage(error)}`);
                }
                try {
                        await bound.fsPort.writeFile(`${bound.root}/${ACCEPTANCE_ENVELOPE_RELATIVE_PATH}`, `${JSON.stringify(envelope)}\n`);
                } catch (error) {
                        return refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `buildRunner.${op}: the fs port refused the acceptance envelope write: ${toMessage(error)} (the line landed: the ledger is authoritative; the next op rewrites the envelope)`);
                }
                current = next;
                return null;
        }

        async function runIndustryAcceptance(fixtureInput: unknown): Promise<IndustryRunOutcome> {
                const disposedRefusal = refuseIfDisposed('runIndustryAcceptance');
                if (disposedRefusal) {
                        return { ok: false, refusal: disposedRefusal };
                }
                const freshRefusal = await guardFreshOverLedger('runIndustryAcceptance');
                if (freshRefusal !== null) {
                        return { ok: false, refusal: freshRefusal };
                }
                const walk = validateIndustryAcceptanceFixture(fixtureInput);
                if (!walk.ok) {
                        return { ok: false, refusal: refused('malformed-fixture', walk.rejection.law, `runIndustryAcceptance: the fixture walk refused - ${walk.rejection.message}`, walk.rejection.items, { fixtureRejection: { reason: walk.rejection.reason, law: walk.rejection.law, message: walk.rejection.message, ...(walk.rejection.items === undefined ? {} : { items: [...walk.rejection.items] }) } }) };
                }
                const fixture = walk.fixture;
                if (current.rows.has(fixture.industry)) {
                        return { ok: false, refusal: refused('industry-already-run', 'THE UNIQUE-INDUSTRY LAW', `runIndustryAcceptance: the industry '${fixture.industry}' already carries a completed row on this runner (a re-run is a NEW runner or a reload, never a second row)`, [fixture.industry]) };
                }
                // ---- THE DH-11 JOURNEY through the REAL activation kit (ONE code path, the SAME seams) ----
                const kitOrRefusal = await openActivationKit('runIndustryAcceptance');
                if ('reason' in kitOrRefusal) {
                        return { ok: false, refusal: kitOrRefusal };
                }
                const kit = kitOrRefusal;
                seedCatalog(fixture);
                const journey = await walkJourney(kit, fixture, wireCatalog);
                if (!journey.ok) {
                        return { ok: false, refusal: journey.refusal };
                }
                const journeyRecord = journey.journey;
                const links = journeyRecord.recordLinks as ComposedRecordLinks;
                // ---- THE READ PHASE: the composed records, read through the families' OWN load surfaces ----
                const composed = await readComposedRecords('runIndustryAcceptance', bound, catalog, journeyRecord);
                if (!composed.ok) {
                        return { ok: false, refusal: composed.refusal };
                }
                // ---- THE DH-10 PROJECTION over the composed records (anchored on the binding composition root) ----
                const records = composed.composed;
                const projection = ensureProjectionsKit().projectNavigation({
                        harness: records.bindingRecord,
                        roles: [journeyRecord.rolesSession as RoleCompositionSession],
                        ontology: [records.ontologyRecord],
                        templates: [records.templateRecord],
                        bodies: [records.bodiesRecord],
                        packs: [records.packsRecord],
                        profiles: [records.profilesRecord],
                        benchmarks: [records.benchmarksRecord],
                });
                if (!projection.ok) {
                        return { ok: false, refusal: navigationRefused(projection) };
                }
                const model = projection.model;
                // ---- THE DH-09 BENCHMARK LEG (data-driven over the fixture's binding mode: the
                // base-registry binding rides the REAL DH-09 kit surfaces end-to-end; the
                // industry-extension binding rides the acceptance family's combined-catalog
                // composition over the REAL imported lab extension registry lookups) ----
                let bundle: BenchmarkInstanceBundle | null = null;
                let proof: ClosedLoopProof | null = null;
                let evaluation: BenchmarkEvaluationResult | null = null;
                const binding = benchmarkBindingOf(fixture.benchmark);
                if (binding !== null) {
                        const benchmarkLeg = await runBenchmarkLeg('runIndustryAcceptance', fixture, binding, records.benchmarksKit, records.benchmarksRecord, bound);
                        if (!benchmarkLeg.ok) {
                                return { ok: false, refusal: benchmarkLeg.refusal };
                        }
                        bundle = benchmarkLeg.bundle;
                        proof = benchmarkLeg.proof;
                        evaluation = benchmarkLeg.evaluation;
                }
                // ---- THE DH-12 OPTIMIZATION SMOKE through the ONE shared optimization kit ----
                const smoke = await runOptimizationSmoke('runIndustryAcceptance', fixture, links, bound, () => ensureOptimizationKit('runOptimizationSmoke'));
                if (!smoke.ok) {
                        return { ok: false, refusal: smoke.refusal };
                }
                // ---- THE CENSUS INPUT: the composed records' family versions ----
                const versions = await composedRecordVersions('runIndustryAcceptance', bound, records, journeyRecord, model, smoke.loopRecord);
                if (!versions.ok) {
                        return { ok: false, refusal: versions.refusal };
                }
                // ---- THE VERDICT ROW ----
                const row = buildVerdictRow(fixture, journeyRecord, records, model, proof, evaluation, versions.versions);
                const rowWalk = validateIndustryVerdictRow(row);
                if (!rowWalk.ok) {
                        return { ok: false, refusal: refused('invalid-report', 'THE FAIL-CLOSED VERDICT LAW', `runIndustryAcceptance: the built industry verdict row failed its own canonical walk: ${rowWalk.message}`) };
                }
                const nextRows = new Map(current.rows);
                nextRows.set(fixture.industry, row);
                const next: AcceptanceRunState = { ...current, seq: current.seq + 1, industries: [...current.industries, fixture.industry], rows: nextRows };
                const benchmarkStatus = fixture.benchmark === null ? 'gap-registered' : 'evaluated';
                const appendRefusal = await appendLine('run-industry', { op: 'run-industry', industry: fixture.industry, law: 'THE COMPOSITION-NOT-FORK LAW', payload: row, detail: `ran the ${fixture.industry} industry acceptance journey through the ONE shared real kit construction (the harness record at 'active'; the navigation model derived; the benchmark leg ${benchmarkStatus} over the ${benchmarkBindingOf(fixture.benchmark)?.mode ?? 'honest-null'} carrier; the optimization smoke recommended)` }, next);
                if (appendRefusal !== null) {
                        return { ok: false, refusal: appendRefusal };
                }
                return { ok: true, verdict: row };
        }

        async function runCrossIndustryAcceptance(): Promise<CrossIndustryRunOutcome> {
                const disposedRefusal = refuseIfDisposed('runCrossIndustryAcceptance');
                if (disposedRefusal) {
                        return { ok: false, refusal: disposedRefusal };
                }
                const freshRefusal = await guardFreshOverLedger('runCrossIndustryAcceptance');
                if (freshRefusal !== null) {
                        return { ok: false, refusal: freshRefusal };
                }
                const seqAtEntry = current.seq;
                // THE IDEMPOTENT RE-READ: a complete run re-derives and re-emits the identical report bytes WITHOUT appending.
                if (current.emission !== null) {
                        const report = buildReport(current);
                        const reportWalk = validateReportWalk(report);
                        if (reportWalk !== null) {
                                return { ok: false, refusal: reportWalk };
                        }
                        const writeRefusal = await writeReport('runCrossIndustryAcceptance', bound, report);
                        if (writeRefusal !== null) {
                                return { ok: false, refusal: writeRefusal };
                        }
                        return { ok: true, report, emission: { path: `${bound.root}/${ACCEPTANCE_REPORT_RELATIVE_PATH}`, bytes: reportBytes(report), appendedOps: 0 } };
                }
                // The four industries in the frozen lane order (the already-run ones resume as complete).
                for (const industry of ACCEPTANCE_INDUSTRIES) {
                        if (current.rows.has(industry)) {
                                continue;
                        }
                        const outcome = await runIndustryAcceptance(LANE_FIXTURES[industry]);
                        if (!outcome.ok) {
                                return { ok: false, refusal: outcome.refusal };
                        }
                }
                // ---- THE TERMINAL WALK (RESUMABLE: each stage is guarded by its OWN committed state ----
                // slot, so a refusal between terminal lines heals by re-running ONLY the un-landed ----
                // stages - re-appending a landed terminal line would fabricate a torn ledger). ----
                // ---- THE COMPOSITION-NOT-FORK CENSUS ----
                if (current.compositionCensus === null) {
                        const census = composeCensus(current);
                        if (!census.ok) {
                                return { ok: false, refusal: census.refusal };
                        }
                        const censusNext: AcceptanceRunState = { ...current, seq: current.seq + 1, compositionCensus: census.census };
                        const censusRefusal = await appendLine('compose-census', { op: 'compose-census', industry: null, law: 'THE COMPOSITION-NOT-FORK LAW', payload: census.census, detail: 'composed the cross-industry census: the twelve family versions identical across every industry\'s composed records; ONE set of real kit constructions served all four' }, censusNext);
                        if (censusRefusal !== null) {
                                return { ok: false, refusal: censusRefusal };
                        }
                }
                // ---- THE GAP REGISTRATION (fail-closed: every ledger row registered; every industry's rows verbatim) ----
                if (!current.gapsRegistered) {
                        const gapRegistration = registerGaps(current.rows);
                        if (!gapRegistration.ok) {
                                return { ok: false, refusal: gapRegistration.refusal };
                        }
                        const gapsNext: AcceptanceRunState = { ...current, seq: current.seq + 1, gapsRegistered: true };
                        const gapsRefusal = await appendLine('register-gaps', { op: 'register-gaps', industry: null, law: 'THE CLOSED-ROW LAW', payload: [...ACCEPTANCE_GAP_KEYS], detail: 'registered the honest gap ledger verbatim: the six frozen rows carried in the report (four of the six rows closed - rows 1-3 and 5, the closures recorded IN the rows); every lane industry\'s benchmark leg evaluated; the two open rows registered by every industry, the closed rows by none' }, gapsNext);
                        if (gapsRefusal !== null) {
                                return { ok: false, refusal: gapsRefusal };
                        }
                }
                // ---- THE OVERALL VERDICT (fail-closed) ----
                if (current.overallVerdict === null) {
                        const overall = resolveOverallVerdict(current);
                        if (!overall.ok) {
                                return { ok: false, refusal: overall.refusal };
                        }
                        const verdictNext: AcceptanceRunState = { ...current, seq: current.seq + 1, overallVerdict: overall.verdict };
                        const verdictRefusal = await appendLine('resolve-verdict', { op: 'resolve-verdict', industry: null, law: 'THE FAIL-CLOSED VERDICT LAW', payload: overall.verdict, detail: `resolved the overall acceptance verdict: ${overall.verdict.verdict}` }, verdictNext);
                        if (verdictRefusal !== null) {
                                return { ok: false, refusal: verdictRefusal };
                        }
                }
                // ---- THE CANONICAL REPORT EMISSION ----
                if (current.emission === null) {
                        const report = buildReport(current);
                        const reportWalk = validateReportWalk(report);
                        if (reportWalk !== null) {
                                return { ok: false, refusal: reportWalk };
                        }
                        const bytes = reportBytes(report);
                        const path = `${bound.root}/${ACCEPTANCE_REPORT_RELATIVE_PATH}`;
                        const writeRefusal = await writeReport('runCrossIndustryAcceptance', bound, report);
                        if (writeRefusal !== null) {
                                return { ok: false, refusal: writeRefusal };
                        }
                        const emissionNext: AcceptanceRunState = { ...current, seq: current.seq + 1, emission: { path, bytes } };
                        const emitRefusal = await appendLine('emit-report', { op: 'emit-report', industry: null, law: 'THE CANONICAL SERIALIZATION LAW', payload: { path, bytes }, detail: `emitted the canonical acceptance report (${bytes} bytes) through the injected fs port` }, emissionNext);
                        if (emitRefusal !== null) {
                                return { ok: false, refusal: emitRefusal };
                        }
                }
                const finalReport = buildReport(current);
                const finalBytes = reportBytes(finalReport);
                return { ok: true, report: finalReport, emission: { path: `${bound.root}/${ACCEPTANCE_REPORT_RELATIVE_PATH}`, bytes: finalBytes, appendedOps: current.seq - seqAtEntry } };
        }

        function inspectRun(): AcceptanceInspectOutcome {
                const disposedRefusal = refuseIfDisposed('inspectRun');
                if (disposedRefusal) {
                        return { ok: false, refusal: disposedRefusal };
                }
                const complete = current.emission !== null;
                return { ok: true, rows: [...current.rows.values()], complete, report: complete ? buildReport(current) : null };
        }

        function dispose(): void {
                disposed = true;
                for (const kit of activationKits) {
                        kit.dispose();
                }
                if (optimizationKit !== null) {
                        optimizationKit.dispose();
                }
                if (projectionsKit !== null) {
                        projectionsKit.dispose();
                }
        }

        return { runIndustryAcceptance, runCrossIndustryAcceptance, inspectRun, dispose };
}

// --- the journey walk (the DH-11 legs through the ONE shared kit) --------------------------------------------

/** The journey walk's outcome: the active journey record (the evidence, never the authority). */
type JourneyWalkOutcome = { readonly ok: true; readonly journey: ActivationJourneyRecord } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

async function walkJourney(kit: ActivationKit, fixture: IndustryAcceptanceFixture, wireCatalogAtProposal: (links: ComposedRecordLinks) => void): Promise<JourneyWalkOutcome> {
        const begun = await kit.beginJourney();
        if (!begun.ok) {
                return { ok: false, refusal: journeyRefused('beginJourney', begun.refusal) };
        }
        const journeyId = begun.journey.journeyId;
        const industry = await kit.selectIndustry(journeyId, fixture.industry);
        if (!industry.ok) {
                return { ok: false, refusal: journeyRefused('selectIndustry', industry.refusal) };
        }
        const company = await kit.composeCompany(journeyId, fixture.companyProfile);
        if (!company.ok) {
                return { ok: false, refusal: journeyRefused('composeCompany', company.refusal) };
        }
        const workTypes = await kit.selectWorkTypes(journeyId, fixture.workTypes);
        if (!workTypes.ok) {
                return { ok: false, refusal: journeyRefused('selectWorkTypes', workTypes.refusal) };
        }
        const roles = await kit.composeRoles(journeyId, fixture.roles);
        if (!roles.ok) {
                return { ok: false, refusal: journeyRefused('composeRoles', roles.refusal) };
        }
        const benchmark = journeyBenchmarkOf(fixture);
        const content = {
                terms: [...fixture.terms],
                tasks: [...fixture.tasks],
                bodies: [...fixture.bodies],
                packs: [...fixture.packs],
                profiles: [...fixture.profiles],
                benchmarks: [benchmark],
        };
        const records = await kit.composeRecords(journeyId, content);
        if (!records.ok) {
                return { ok: false, refusal: journeyRefused('composeRecords', records.refusal) };
        }
        // THE CATALOG-BINDING LAW at the proposal boundary: the emitted composed record
        // refs (the record-composition leg's minted links) are wired into the shared
        // catalog snapshot BEFORE the propose (the REAL DH-01 validation resolves them).
        wireCatalogAtProposal(records.journey.recordLinks as ComposedRecordLinks);
        const proposal = await kit.proposeHarness(journeyId);
        if (!proposal.ok) {
                return { ok: false, refusal: journeyRefused('proposeHarness', proposal.refusal) };
        }
        const approval = await kit.approveHarness(journeyId, { approvedBy: 'acceptance-approver', note: 'the cross-industry acceptance approval' });
        if (!approval.ok) {
                return { ok: false, refusal: journeyRefused('approveHarness', approval.refusal) };
        }
        const activation = await kit.activateHarness(journeyId, { activatedBy: 'acceptance-activator' });
        if (!activation.ok) {
                return { ok: false, refusal: journeyRefused('activateHarness', activation.refusal) };
        }
        return { ok: true, journey: activation.journey };
}

// --- the read phase (the composed records through the families' OWN load surfaces) ---------------------------

interface ComposedRecords {
        readonly bindingRecord: HarnessRecord;
        readonly finalRecord: HarnessRecord;
        readonly sessionRecord: OnboardingSessionRecord;
        readonly rolesSession: RoleCompositionSession;
        readonly ontologyRecord: DomainOntologyRecord;
        readonly templateRecord: WorkflowTemplateRecord;
        readonly bodiesRecord: OrganizationDefaultsRecord;
        readonly packsRecord: CapabilityPacksRecord;
        readonly profilesRecord: ProfilesRecord;
        readonly benchmarksRecord: BenchmarksRecord;
        readonly benchmarksKit: BenchmarksKit;
}

type ReadOutcome = { readonly ok: true; readonly composed: ComposedRecords } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE READ PHASE (THE EVIDENCE-NOT-AUTHORITY LAW): every composed
 * record is READ through its OWNING family's own load + inspect
 * surfaces (each family's ledger is the live surface; the runner
 * never reconstructs a record from the journey evidence). The DH-01
 * authority is reopened through its OWN load surface for BOTH
 * records: the binding composition root (the draft the six families'
 * records bind - THE LINEAGE LAW) and the final harness (the active
 * record).
 */
async function readComposedRecords(op: string, bound: { readonly clock: () => string; readonly rng: () => string; readonly fsPort: HarnessFsPort; readonly root: string }, catalog: HarnessCatalogSnapshot, journey: ActivationJourneyRecord): Promise<ReadOutcome> {
        const links = journey.recordLinks as ComposedRecordLinks;
        const bindingHarnessId = journey.bindingHarnessId as string;
        const finalHarnessId = journey.harnessId as string;
        // THE DH-01 AUTHORITY (both records: the binding root + the final active record).
        const harnessLoad = await loadHarnessKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
        if (!harnessLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'harness', harnessLoad.refusal) };
        }
        const bindingInspected = await harnessLoad.kit.inspectHarness(bindingHarnessId);
        if (!bindingInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'harness', bindingInspected.refusal) };
        }
        const finalInspected = await harnessLoad.kit.inspectHarness(finalHarnessId);
        if (!finalInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'harness', finalInspected.refusal) };
        }
        // THE DH-02 SESSION (the onboarding session record - the projection's onboarding family read).
        const onboardingLoad = await loadOnboardingKit({ clock: bound.clock, rng: bound.rng, catalog, fsPort: bound.fsPort, root: bound.root });
        if (!onboardingLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'onboarding', onboardingLoad.refusal) };
        }
        const sessionInspected = await onboardingLoad.kit.inspectSession(journey.onboardingSessionId);
        if (!sessionInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'onboarding', sessionInspected.refusal) };
        }
        // THE DH-03 ROLES SESSION.
        const rolesLoad = await loadRolesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!rolesLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'roles', rolesLoad.refusal) };
        }
        const rolesListed = await rolesLoad.kit.listSessions();
        if (!rolesListed.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'roles', rolesListed.refusal) };
        }
        const rolesSession = rolesListed.sessions.find((session) => session.sessionId === (journey.rolesSession as RoleCompositionSession).sessionId);
        if (rolesSession === undefined) {
                return { ok: false, refusal: recordReadRefused(op, 'roles', { reason: 'unknown-record', law: 'THE FAIL-CLOSED LAW', message: `readComposedRecords.${op}: the roles session ${(journey.rolesSession as RoleCompositionSession).sessionId} does not resolve on the REAL DH-03 kit's own ledger` }) };
        }
        // THE SIX RECORD FAMILIES (DH-04..DH-09), each read through its OWN load + inspect surface.
        const ontologyLoad = await loadOntologyKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!ontologyLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'ontology', ontologyLoad.refusal) };
        }
        const ontologyInspected = await ontologyLoad.kit.inspectOntology(links.ontologyId);
        if (!ontologyInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'ontology', ontologyInspected.refusal) };
        }
        const templatesLoad = await loadTemplatesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!templatesLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'templates', templatesLoad.refusal) };
        }
        const templateInspected = await templatesLoad.kit.inspectTemplate(links.templateId);
        if (!templateInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'templates', templateInspected.refusal) };
        }
        const bodiesLoad = await loadBodiesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!bodiesLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'bodies', bodiesLoad.refusal) };
        }
        const bodiesInspected = await bodiesLoad.kit.inspectDefaults(links.bodyId);
        if (!bodiesInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'bodies', bodiesInspected.refusal) };
        }
        const packsLoad = await loadPacksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!packsLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'packs', packsLoad.refusal) };
        }
        const packsInspected = await packsLoad.kit.inspectPacks(links.packsId);
        if (!packsInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'packs', packsInspected.refusal) };
        }
        const profilesLoad = await loadProfilesKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!profilesLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'profiles', profilesLoad.refusal) };
        }
        const profilesInspected = await profilesLoad.kit.inspectProfiles(links.profilesId);
        if (!profilesInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'profiles', profilesInspected.refusal) };
        }
        const benchmarksLoad = await loadBenchmarksKit({ clock: bound.clock, rng: bound.rng, fsPort: bound.fsPort, root: bound.root });
        if (!benchmarksLoad.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'benchmarks', benchmarksLoad.refusal) };
        }
        const benchmarksInspected = await benchmarksLoad.kit.inspectBenchmarks(links.benchmarksId);
        if (!benchmarksInspected.ok) {
                return { ok: false, refusal: recordReadRefused(op, 'benchmarks', benchmarksInspected.refusal) };
        }
        return {
                ok: true,
                composed: {
                        bindingRecord: bindingInspected.record,
                        finalRecord: finalInspected.record,
                        sessionRecord: sessionInspected.session,
                        rolesSession,
                        ontologyRecord: ontologyInspected.record,
                        templateRecord: templateInspected.record,
                        bodiesRecord: bodiesInspected.record,
                        packsRecord: packsInspected.record,
                        profilesRecord: profilesInspected.record,
                        benchmarksRecord: benchmarksInspected.record,
                        benchmarksKit: benchmarksLoad.kit,
                },
        };
}

// --- the DH-09 benchmark leg (both binding modes: the DH-09 kit surfaces or the combined-catalog composition) ------

type BenchmarkLegOutcome =
        | { readonly ok: true; readonly bundle: BenchmarkInstanceBundle; readonly proof: ClosedLoopProof; readonly evaluation: BenchmarkEvaluationResult }
        | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE BENCHMARK LEG (data-driven over the binding mode, never an
 * industry branch):
 *
 *   the base-registry binding  - the REAL DH-09 instantiation
 *                                (seeded, reproducible, through the
 *                                kit's own read surface over the
 *                                composed record) and the REAL DH-09
 *                                evaluation over the runner-derived
 *                                fixture measures (THE HONEST-MEASURE
 *                                LAW: only the declared KPIs, never
 *                                invented);
 *   the industry-extension      - THE COMBINED-CATALOG COMPOSITION (the
 *   binding                      DH-GAP-2 wave's benchmark-leg
 *                                refresh): the instances generated by
 *                                the REAL imported generateTaskInstances
 *                                (the lab industry extension registry's
 *                                own engine entry point - one engine,
 *                                never a re-implementation) into the
 *                                REAL DH-09 bundle shape, the same
 *                                honest fixture-measure derivation, and
 *                                the evaluation record composed in the
 *                                REAL DH-09 result shape, bound to the
 *                                journey's own benchmarks record and
 *                                harness (the DH-09 evaluation surface
 *                                is record-bound - a landed law - so
 *                                the family composes the record over the
 *                                imported machinery; disclosed).
 *
 * Both modes close with the REAL LAB closedLoop (the ten-stage fixture
 * execution - the task-execution evidence, honestly labeled
 * fixture-level; the landed closed-loop engine resolves its scenario
 * through the base registry, so every benchmark leg drives the
 * registry's first REAL scenario - the honest limitation, disclosed
 * in the execution disclosure).
 */
async function runBenchmarkLeg(op: string, fixture: IndustryAcceptanceFixture, binding: BenchmarkBinding, benchmarksKit: BenchmarksKit, benchmarksRecord: BenchmarksRecord, bound: { readonly clock: () => string; readonly rng: () => string; readonly fsPort: HarnessFsPort; readonly root: string; readonly constructionClock: string }): Promise<BenchmarkLegOutcome> {
        const benchmarksId = benchmarksRecord.id;
        const entry = binding.entry;
        let bundle: BenchmarkInstanceBundle;
        let evaluation: BenchmarkEvaluationResult;
        if (binding.mode === 'base-registry') {
                const instantiated = await benchmarksKit.instantiateBenchmark(benchmarksId, entry.benchmarkKey, BENCHMARK_SEED, BENCHMARK_INSTANCE_COUNT);
                if (!instantiated.ok) {
                        return { ok: false, refusal: benchmarkLegRefused(op, 'instantiateBenchmark', instantiated.refusal) };
                }
                bundle = instantiated.bundle;
                const measures = deriveMeasures(entry, bundle);
                const evaluated = await benchmarksKit.evaluateBenchmark(benchmarksId, entry.benchmarkKey, measures);
                if (!evaluated.ok) {
                        return { ok: false, refusal: benchmarkLegRefused(op, 'evaluateBenchmark', evaluated.refusal) };
                }
                evaluation = evaluated.result;
        } else {
                // THE COMBINED-CATALOG INSTANTIATION: the REAL imported generateTaskInstances per
                // scenarioRef (the lab industry extension registry's own engine entry point),
                // composed into the REAL DH-09 bundle shape (seeded, reproducible; same seed ->
                // byte-identical instances). An empty stream is the typed defense-in-depth
                // refusal (the contract walk proved the resolution; this guard re-proves it).
                const scenarioInstances = entry.scenarioRefs.map((scenarioId) => ({
                        scenarioId,
                        instances: generateTaskInstances(scenarioId, BENCHMARK_SEED, BENCHMARK_INSTANCE_COUNT),
                }));
                const empty: string[] = [];
                for (const scenario of scenarioInstances) {
                        if (scenario.instances.length === 0) {
                                empty.push(scenario.scenarioId);
                        }
                }
                if (empty.length > 0) {
                        return { ok: false, refusal: refused('benchmark-leg-refused', 'THE SCENARIO-BINDING LAW (the combined catalog)', `runBenchmarkLeg.${op}: the REAL imported generateTaskInstances returned no instances for the scenarioRef(s) [${empty.join(', ')}] (the combined-catalog resolution re-proven at the instantiation boundary - never a silent empty bundle)`, empty) };
                }
                bundle = {
                        benchmarkKey: entry.benchmarkKey,
                        seed: BENCHMARK_SEED,
                        count: BENCHMARK_INSTANCE_COUNT,
                        scenarioInstances,
                };
                const measures = deriveMeasures(entry, bundle);
                // THE COMPOSED EVALUATION (the disclosed contract addition): the DH-09
                // evaluation surface resolves the benchmarkKey against the composed record
                // (landed law - the industry binding never forces its refs into it), so the
                // family composes the evaluation record in the REAL DH-09 result shape: the
                // same honest-measure derivation (only the declared KPIs, each once, finite,
                // rounded to the byte-deterministic law), the entry's own declared evidence
                // level (a REAL ceiling-respecting rung, proven by the REAL DH-09 entry walk),
                // bound to the journey's own benchmarks record and harness.
                evaluation = {
                        benchmarksId,
                        harnessId: benchmarksRecord.harnessId,
                        benchmarkKey: entry.benchmarkKey,
                        scores: measures,
                        evidenceLevel: entry.evidenceLevel,
                };
        }
        // THE LAB CLOSED-LOOP FIXTURE EXECUTION (the task-execution evidence): the REAL
        // ten-stage proof over the landed base registry's first REAL scenario (the landed
        // closed-loop engine resolves its scenario through the base registry - the industry
        // scenarios ride the benchmark leg's combined-catalog instantiation above; the honest
        // limitation is disclosed in the execution disclosure), the combined-catalog-derived
        // corpus, two ladder seeds (the L2 rung) and the runner's construction clock stamp.
        const scope = scopeOf(fixture.industry);
        const proof = runClosedLoop({
                scope,
                runLabel: `acceptance-${fixture.industry}`,
                activity: deriveRegistryCorpus(scope, bound.constructionClock),
                controls: { optIn: true, retentionDays: 90, exportable: true },
                profileId: `wp-acceptance-${fixture.industry}`,
                taskScenarioId: REAL_SCENARIO_IDS[0],
                ladderSeeds: [7, 11],
                instanceCount: BENCHMARK_INSTANCE_COUNT,
                utilityWeights: { success: 0.3, quality: 0.3, latency: 0.2, cost: 0.2 },
                maxAgents: 2,
                modelIds: ['model-fixture-m', 'model-fixture-s'],
                toolModes: ['all', 'lean'],
                nowIso: bound.constructionClock,
        });
        if (proof === undefined) {
                return { ok: false, refusal: refused('closed-loop-refused', 'THE HONEST-GAP LAW', `runBenchmarkLeg.${op}: the REAL LAB closedLoop returned undefined over the combined-catalog-derived corpus and the landed base registry's first REAL scenario (a gate refused the proof - the loop is honest about what it could not close; the fixture evidence ceiling is disclosed, never promoted)`, ['scenario-se-bugfix-regression']) };
        }
        return { ok: true, bundle, proof, evaluation };
}

// --- the DH-12 optimization smoke (observe -> simulate -> compare -> recommend) ------------------------------

type SmokeOutcome = { readonly ok: true; readonly loopRecord: OptimizationLoopRecord } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE OPTIMIZATION SMOKE through the ONE shared REAL DH-12 loop kit:
 * observe (the REAL LAB-002 learner over the registry-derived corpus)
 * -> simulate (the REAL LAB-005 search) -> compare (the REAL ladder)
 * -> recommend (the auditable recommendation). Fail-closed if the
 * loop kit refuses any leg or the recommendation is not auditable
 * (the uncertainty / missing-capability / reversibility disclosures
 * must all be present - THE AUDIT LAW's smoke-level pin).
 */
async function runOptimizationSmoke(op: string, fixture: IndustryAcceptanceFixture, links: ComposedRecordLinks, bound: { readonly clock: () => string; readonly rng: () => string; readonly fsPort: HarnessFsPort; readonly root: string; readonly constructionClock: string }, ensureKit: () => Promise<OptimizationKit | AcceptanceRunnerRefusal>): Promise<SmokeOutcome> {
        const kitOrRefusal = await ensureKit();
        if ('reason' in kitOrRefusal) {
                return { ok: false, refusal: kitOrRefusal };
        }
        const kit = kitOrRefusal;
        const scope = scopeOf(fixture.industry);
        const begun = await kit.beginLoop();
        if (!begun.ok) {
                return { ok: false, refusal: optimizationRefused(op, 'beginLoop', begun.refusal) };
        }
        const loopId = begun.loop.loopId;
        const observed = await kit.observeWorkload(loopId, {
                scope,
                records: deriveRegistryCorpus(scope, bound.constructionClock),
                controls: { optIn: true, retentionDays: 90, exportable: true },
                profileId: `wp-acceptance-${fixture.industry}`,
        });
        if (!observed.ok) {
                return { ok: false, refusal: optimizationRefused(op, 'observeWorkload', observed.refusal) };
        }
        const simulated = await kit.simulateCandidates(loopId);
        if (!simulated.ok) {
                return { ok: false, refusal: optimizationRefused(op, 'simulateCandidates', simulated.refusal) };
        }
        const compared = await kit.compareOutcomes(loopId, { seeds: [BENCHMARK_SEED], instanceCount: BENCHMARK_INSTANCE_COUNT });
        if (!compared.ok) {
                return { ok: false, refusal: optimizationRefused(op, 'compareOutcomes', compared.refusal) };
        }
        const recommended = await kit.recommendImprovement(loopId, {
                delta: {
                        context: {
                                industry: fixture.industry,
                                companyProfile: { ...fixture.companyProfile },
                                workTypes: [...fixture.workTypes],
                                roles: fixture.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                        },
                        additions: {
                                terms: [...fixture.terms],
                                tasks: [...fixture.tasks],
                                bodies: [...fixture.bodies],
                                packs: [...fixture.packs],
                                profiles: [...fixture.profiles],
                                benchmarks: [journeyBenchmarkOf(fixture)],
                        },
                        replaces: [],
                        rationale: deltaRationaleOf(fixture),
                },
                reversibility: {
                        reversible: true,
                        rollback: {
                                route: 'dh011-activation-journey',
                                removeRecords: [
                                        { family: 'ontology', recordId: links.ontologyId },
                                        { family: 'templates', recordId: links.templateId },
                                        { family: 'bodies', recordId: links.bodyId },
                                        { family: 'packs', recordId: links.packsId },
                                        { family: 'profiles', recordId: links.profilesId },
                                        { family: 'benchmarks', recordId: links.benchmarksId },
                                ],
                                restoreRecords: [],
                        },
                },
        });
        if (!recommended.ok) {
                return { ok: false, refusal: optimizationRefused(op, 'recommendImprovement', recommended.refusal) };
        }
        const loopRecord = recommended.loop;
        // THE AUDIT LAW's smoke-level pin: the recommendation must be present and its
        // uncertainty disclosure must carry an honest statement at or below the loop's
        // frozen 'simulated' evidence ceiling (a recommendation without its honest
        // disclosures is refused, never surfaced).
        const recommendation = loopRecord.recommendation;
        if (recommendation === null || recommendation.uncertainty.statement.length === 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'optimization-refused',
                                law: 'THE AUDIT LAW',
                                message: `runOptimizationSmoke.${op}: the recommendation is not auditable (the recommendation and its uncertainty disclosure must both be present - a recommendation without its disclosures is refused, never surfaced)`,
                        },
                };
        }
        const ceilingRanks: Readonly<Record<string, number>> = { 'fixture': 0, 'simulated': 1, 'local-real': 2, 'runtime-real': 3, 'live-provider': 4, 'production-real': 5 };
        const carriedRung = ceilingRanks[recommendation.uncertainty.evidenceLevel];
        if (carriedRung === undefined || carriedRung > 1) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'optimization-refused',
                                law: 'THE EVIDENCE-CEILING LAW',
                                message: `runOptimizationSmoke.${op}: the recommendation's uncertainty disclosure carries the evidence level '${recommendation.uncertainty.evidenceLevel}' above the loop's frozen 'simulated' ceiling (never overstated, never promoted)`,
                        },
                };
        }
        return { ok: true, loopRecord };
}

// --- the census input (the composed records' twelve family versions) ----------------------------------------

type VersionsOutcome = { readonly ok: true; readonly versions: Readonly<Record<string, string>> } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE CENSUS INPUT: the twelve family versions AS CARRIED by this
 * industry's composed records - the record-bearing surfaces read
 * their own contractVersion fields (the DH-01 record, the DH-02
 * session, the projections model, the DH-11 journey record, the
 * DH-12 loop record); the staged families (DH-03..DH-09) carry NO
 * version field on their records (their SINGLE-VERSION LAW is
 * enforced at the LEDGER LINE level) - their versions are read from
 * their OWN append-only ledgers' lines bound to THIS journey's
 * records (the roles session's lines; the binding harness's lines).
 */
async function composedRecordVersions(op: string, bound: { readonly clock: () => string; readonly rng: () => string; readonly fsPort: HarnessFsPort; readonly root: string }, composed: ComposedRecords, journey: ActivationJourneyRecord, model: DomainNavigationModel, loopRecord: OptimizationLoopRecord): Promise<VersionsOutcome> {
        const rolesSessionId = composed.rolesSession.sessionId;
        const bindingHarnessId = journey.bindingHarnessId as string;
        const rolesVersion = await ledgerVersionOf(op, bound, ROLES_LEDGER_RELATIVE_PATH, (line) => line.sessionId === rolesSessionId);
        if (!rolesVersion.ok) {
                return rolesVersion;
        }
        const ontologyVersion = await ledgerVersionOf(op, bound, ONTOLOGY_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!ontologyVersion.ok) {
                return ontologyVersion;
        }
        const templatesVersion = await ledgerVersionOf(op, bound, TEMPLATES_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!templatesVersion.ok) {
                return templatesVersion;
        }
        const bodiesVersion = await ledgerVersionOf(op, bound, BODIES_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!bodiesVersion.ok) {
                return bodiesVersion;
        }
        const packsVersion = await ledgerVersionOf(op, bound, PACKS_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!packsVersion.ok) {
                return packsVersion;
        }
        const profilesVersion = await ledgerVersionOf(op, bound, PROFILES_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!profilesVersion.ok) {
                return profilesVersion;
        }
        const benchmarksVersion = await ledgerVersionOf(op, bound, BENCHMARKS_LEDGER_RELATIVE_PATH, (line) => line.harnessId === bindingHarnessId);
        if (!benchmarksVersion.ok) {
                return benchmarksVersion;
        }
        return {
                ok: true,
                versions: {
                        'domain-harness': composed.finalRecord.contractVersion,
                        onboarding: composed.sessionRecord.contractVersion,
                        roles: rolesVersion.version,
                        ontology: ontologyVersion.version,
                        templates: templatesVersion.version,
                        bodies: bodiesVersion.version,
                        packs: packsVersion.version,
                        profiles: profilesVersion.version,
                        benchmarks: benchmarksVersion.version,
                        projections: model.contractVersion,
                        activation: journey.contractVersion,
                        optimization: loopRecord.contractVersion,
                },
        };
}

/** Reads the contractVersion carried by the first family-ledger line matching the selector (fail-closed: no matching line is the typed record-read refusal). */
async function ledgerVersionOf(op: string, bound: { readonly clock: () => string; readonly rng: () => string; readonly fsPort: HarnessFsPort; readonly root: string }, relativePath: string, selector: (line: Record<string, unknown>) => boolean): Promise<{ readonly ok: true; readonly version: string } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal }> {
        let text: string | null;
        try {
                text = await readText(bound.fsPort, `${bound.root}/${relativePath}`);
        } catch (error) {
                return { ok: false, refusal: refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `ledgerVersionOf.${op}: the fs port refused the family ledger read (${relativePath}): ${toMessage(error)}`) };
        }
        if (text === null) {
                return { ok: false, refusal: recordReadRefused(op, relativePath, { reason: 'unknown-record', law: 'THE FAIL-CLOSED LAW', message: `ledgerVersionOf.${op}: the family ledger ${relativePath} does not exist on this root` }) };
        }
        for (const line of text.split('\n')) {
                if (line.trim().length === 0) {
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch {
                        return { ok: false, refusal: recordReadRefused(op, relativePath, { reason: 'malformed-line', law: 'THE APPEND-ONLY LEDGER LAW', message: `ledgerVersionOf.${op}: a line of the family ledger ${relativePath} is not JSON` }) };
                }
                if (isPlainRecord(parsed) && selector(parsed as Record<string, unknown>)) {
                        const version = (parsed as Record<string, unknown>).contractVersion;
                        if (typeof version !== 'string' || version.length === 0) {
                                return { ok: false, refusal: recordReadRefused(op, relativePath, { reason: 'version-mismatch', law: 'THE SINGLE-VERSION LAW', message: `ledgerVersionOf.${op}: the matched line of the family ledger ${relativePath} carries a malformed contractVersion` }) };
                        }
                        return { ok: true, version };
                }
        }
        return { ok: false, refusal: recordReadRefused(op, relativePath, { reason: 'unknown-record', law: 'THE FAIL-CLOSED LAW', message: `ledgerVersionOf.${op}: no line of the family ledger ${relativePath} matches the composed record binding` }) };
}

// --- the verdict row ------------------------------------------------------------------------------------------

/** The honest execution disclosure (THE EVIDENCE DISCLOSURE, carried verbatim on every task-execution leg; the DH-GAP-2 re-wording discloses the two binding lanes and the closedLoop's base-registry scenario). */
const EXECUTION_DISCLOSURE = 'the task execution is the LAB closedLoop fixture execution over the real deterministic instances (the landed closed-loop engine drives the base-registry SE scenario for every benchmark leg) plus the real authority routing (the DH-01 lifecycle at active through the real transitions; the benchmark evaluations through the REAL DH-09 surfaces for the base-registry binding and through the acceptance family\'s combined-catalog composition over the REAL imported lab extension registry lookups for the industry-extension bindings) - fixture-level evidence, honestly labeled; never a live provider, never a production deployment';

/**
 * THE VERDICT ROW (pure): one leg per assessed dimension, every
 * field read from the REAL surfaces' own records (the journey
 * record's evidence, the composed records' own entries, the derived
 * navigation model, the benchmark leg's evidence, the loop record's
 * version) - never a fabricated field.
 */
function buildVerdictRow(fixture: IndustryAcceptanceFixture, journey: ActivationJourneyRecord, composed: ComposedRecords, model: DomainNavigationModel, proof: ClosedLoopProof | null, evaluation: BenchmarkEvaluationResult | null, versions: Readonly<Record<string, string>>): IndustryAcceptanceVerdict {
        const profiles = composed.profilesRecord.profiles;
        const permissionRefs: string[] = [];
        for (const profile of profiles) {
                for (const permissionRef of profile.permissionRefs) {
                        if (!permissionRefs.includes(permissionRef)) {
                                permissionRefs.push(permissionRef);
                        }
                }
        }
        const approvalTiers: string[] = [];
        for (const profile of profiles) {
                for (const tier of profile.approvalTiers) {
                        if (!approvalTiers.includes(tier)) {
                                approvalTiers.push(tier);
                        }
                }
        }
        const evidenceFloors = profiles.map((profile) => profile.evidenceFloor as string);
        const sections: UiSectionStateRow[] = model.sections.map((section) => ({
                section: section.section,
                state: section.sectionState === 'composed' ? 'populated' : 'not-composed',
                rowCount: section.rows.length,
        }));
        const transitionStates: HarnessLifecycleState[] = ['draft'];
        for (const note of composed.finalRecord.history) {
                if (!transitionStates.includes(note.toState)) {
                        transitionStates.push(note.toState);
                }
        }
        const approvedBy = journey.approval !== null && typeof journey.approval.approvedBy === 'string' ? journey.approval.approvedBy : 'acceptance-approver';
        const activatedBy = journey.activation !== null && typeof journey.activation.activatedBy === 'string' ? journey.activation.activatedBy : 'acceptance-activator';
        const taskExecutionVerdict: AcceptanceLegVerdict = 'complete';
        return {
                industry: fixture.industry,
                contractVersion: HARNESS_ACCEPTANCE_VERSION,
                journey: {
                        verdict: 'complete',
                        journeyId: journey.journeyId,
                        journeyStage: journey.stage,
                        harnessId: journey.harnessId as string,
                        bindingHarnessId: journey.bindingHarnessId as string,
                        harnessLifecycleEndState: composed.finalRecord.state,
                        approvalRecorded: journey.approval !== null,
                        activationRecorded: journey.activation !== null,
                },
                roleComposition: {
                        verdict: 'complete',
                        roleKeys: composed.rolesSession.roles.map((role) => role.roleKey),
                        rolesSessionId: composed.rolesSession.sessionId,
                },
                workflows: {
                        verdict: 'complete',
                        taskKeys: composed.templateRecord.tasks.map((task) => task.taskKey),
                        termRefs: composed.templateRecord.tasks.flatMap((task) => [...task.termRefs]),
                        termResolution: 'resolved',
                },
                policies: {
                        verdict: 'complete',
                        profileKeys: profiles.map((profile) => profile.profileKey),
                        permissionRefs,
                        approvalTiers,
                },
                evidence: {
                        verdict: 'complete',
                        evidenceFloors,
                },
                approvals: {
                        verdict: 'complete',
                        approvedBy,
                        activatedBy,
                        recordedBeforeActivation: true,
                },
                uiBehavior: {
                        verdict: 'complete',
                        anchorHarnessId: journey.bindingHarnessId as string,
                        sections,
                        populatedSections: sections.filter((section) => section.state === 'populated').length,
                        notComposedSections: sections.filter((section) => section.state === 'not-composed').length,
                },
                capabilityGaps: {
                        verdict: 'complete',
                        registeredGapKeys: fixture.expectedGaps.map((row) => row.gapKey),
                },
                taskExecution: {
                        verdict: taskExecutionVerdict,
                        authorityState: composed.finalRecord.state,
                        authorityTransitionsWalked: transitionStates,
                        closedLoopExecutions: proof === null ? null : proof.executions.length,
                        closedLoopLoopClosed: proof === null ? null : proof.loopClosed,
                        benchmarkScores: evaluation === null ? null : evaluation.scores.map((score) => ({ dimension: score.dimension, value: score.value })),
                        benchmarkEvidenceLevel: evaluation === null ? null : (evaluation.evidenceLevel as string),
                        executionDisclosure: EXECUTION_DISCLOSURE,
                },
                benchmarkStatus: fixture.benchmark === null ? 'gap-registered' : 'evaluated',
                composedRecordVersions: versions,
                expectedGaps: fixture.expectedGaps.map((row) => ({ gapKey: row.gapKey, description: row.description, evidenceLevel: row.evidenceLevel, owner: row.owner })),
        };
}

// --- the census / the gap registration / the overall verdict / the report -------------------------------------

type CensusOutcome = { readonly ok: true; readonly census: HarnessCompositionCensus } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/** The twelve family versions' imported constants (THE IMPORT LAW: by reference, never transcribed). */
const FAMILY_VERSION_CONSTANTS: Readonly<Record<string, string>> = {
        'domain-harness': DOMAIN_HARNESS_CONTRACTS_VERSION,
        onboarding: ONBOARDING_CONTRACTS_VERSION,
        roles: ROLES_CONTRACTS_VERSION,
        ontology: ONTOLOGY_CONTRACTS_VERSION,
        templates: TEMPLATES_CONTRACTS_VERSION,
        bodies: BODIES_CONTRACTS_VERSION,
        packs: PACKS_CONTRACTS_VERSION,
        profiles: PROFILES_CONTRACTS_VERSION,
        benchmarks: BENCHMARKS_CONTRACTS_VERSION,
        projections: PROJECTIONS_CONTRACTS_VERSION,
        activation: ACTIVATION_CONTRACTS_VERSION,
        optimization: OPTIMIZATION_CONTRACTS_VERSION,
};

/**
 * THE COMPOSITION-NOT-FORK CENSUS: the twelve contract versions
 * carried by the industries' composed records, pinned IDENTICAL
 * across all four industries AND equal to the imported family
 * constants (the no-fork identity). Any divergence is the typed
 * census-divergence refusal - never a silent partial census.
 */
function composeCensus(state: AcceptanceRunState): CensusOutcome {
        const industries = [...ACCEPTANCE_INDUSTRIES];
        const divergent: string[] = [];
        const rows: CompositionCensusRow[] = COMPOSITION_VERSION_FAMILY_KEYS.map((family) => {
                const carried = industries.map((industry) => {
                        const row = state.rows.get(industry);
                        return row === undefined ? undefined : row.composedRecordVersions[family];
                });
                const first = carried[0];
                const identical = carried.every((version) => version === first) && first !== undefined && carried.every((version) => version !== undefined);
                if (!identical) {
                        divergent.push(`${family}:${carried.map((version) => String(version)).join('/')}`);
                }
                return { family, contractVersion: first === undefined ? '' : first, identicalAcrossIndustries: identical };
        });
        if (divergent.length > 0) {
                return { ok: false, refusal: refused('census-divergence', 'THE COMPOSITION-NOT-FORK LAW', `composeCensus: the industries' composed records carry divergent family versions (the no-fork census is breached) - ${divergent.join('; ')} (ONE set of real kit constructions serves all four; a divergence means a fork)`, divergent) };
        }
        const drifted: string[] = [];
        for (const row of rows) {
                if (row.contractVersion !== FAMILY_VERSION_CONSTANTS[row.family]) {
                        drifted.push(`${row.family}:${row.contractVersion}!=${FAMILY_VERSION_CONSTANTS[row.family]}`);
                }
        }
        if (drifted.length > 0) {
                return { ok: false, refusal: refused('census-divergence', 'THE COMPOSITION-NOT-FORK LAW', `composeCensus: a composed-record version drifted from the owning family's imported contract version - ${drifted.join('; ')} (the versions are carried by reference, never transcribed)`, drifted) };
        }
        return {
                ok: true,
                census: {
                        labContractsVersion: LAB_CONTRACTS_VERSION,
                        rows,
                        industriesServed: industries,
                        sharedKitConstructions: ['activation-kit', 'projections-kit', 'optimization-kit'],
                        fixturesArePureData: true,
                },
        };
}

type GapsOutcome = { readonly ok: true } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE GAP REGISTRATION (fail-closed, the DH-GAP-2 wave's updated
 * truth, extended to row 3 by the DH-GAP-3 wave and to row 5 by the
 * DH-GAP-5 wave): every frozen ledger row is carried in the report
 * (by construction - the closed rows 1-3 and 5 ride VERBATIM with
 * their closures recorded IN the rows); every lane industry's
 * benchmark leg is EVALUATED (the lane industries all carry
 * task-worlds - a gap-registered lane row would be an un-exercised
 * evaluable benchmark leg); every industry's rows are the OPEN frozen
 * ledger rows carried VERBATIM and no closed row is registered as an
 * open gap (THE CLOSED-ROW LAW). A missing or inconsistent
 * registration is the typed gap-registration-missing refusal - never
 * a silent pass.
 */
function registerGaps(rows: ReadonlyMap<HarnessIndustry, IndustryAcceptanceVerdict>): GapsOutcome {
        const missing: string[] = [];
        for (const industry of ACCEPTANCE_INDUSTRIES) {
                const row = rows.get(industry);
                if (row === undefined) {
                        missing.push(`${industry}:no-row`);
                        continue;
                }
                if (row.benchmarkStatus !== 'evaluated') {
                        missing.push(`${industry}:benchmark-leg-not-evaluated:${row.benchmarkStatus}`);
                }
                for (const gapRow of row.expectedGaps) {
                        if (isAcceptanceClosedGapKey(gapRow.gapKey)) {
                                missing.push(`${industry}:${gapRow.gapKey}:closed-row-registered`);
                        }
                        const frozen = HARNESS_ACCEPTANCE_GAP_LEDGER.find((ledgerRow) => ledgerRow.gapKey === gapRow.gapKey);
                        if (frozen === undefined || gapRow.description !== frozen.description || gapRow.evidenceLevel !== frozen.evidenceLevel || gapRow.owner !== frozen.owner) {
                                missing.push(`${industry}:${gapRow.gapKey}:drifted`);
                        }
                }
        }
        if (missing.length > 0) {
                return { ok: false, refusal: refused('gap-registration-missing', 'THE CLOSED-ROW LAW (THE FAIL-CLOSED VERDICT LAW)', `registerGaps: the honest gap registration is incomplete - ${missing.join('; ')} (the closed rows ride the ledger verbatim with their closures recorded IN the rows; every lane industry's benchmark leg is evaluated; the open rows are registered verbatim - never silently skipped, never promoted)`, missing) };
        }
        return { ok: true };
}

type VerdictOutcome = { readonly ok: true; readonly verdict: OverallVerdictRow } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE OVERALL VERDICT (fail-closed): complete ONLY when every
 * industry's journey leg is complete AND every gap is registered.
 * The runner never resolves a verdict over a refused industry (the
 * run fails closed at the refusal) - this resolver's refusal branch
 * is the defensive re-proof of the same law.
 */
function resolveOverallVerdict(state: AcceptanceRunState): VerdictOutcome {
        const complete = ACCEPTANCE_INDUSTRIES.filter((industry) => {
                const row = state.rows.get(industry);
                return row !== undefined && row.journey.verdict === 'complete';
        });
        const refusedIndustries = ACCEPTANCE_INDUSTRIES.filter((industry) => !complete.includes(industry));
        if (refusedIndustries.length > 0) {
                return { ok: false, refusal: refused('gap-registration-missing', 'THE FAIL-CLOSED VERDICT LAW', `resolveOverallVerdict: the industries ${refusedIndustries.join(', ')} do not carry a complete journey row (any refused leg fails the whole verdict - never a silent pass)`, refusedIndustries) };
        }
        return {
                ok: true,
                verdict: {
                        verdict: 'complete',
                        industriesComplete: complete.length,
                        industriesRefused: 0,
                        gapRowsRegistered: HARNESS_ACCEPTANCE_GAP_LEDGER.length,
                        refusalReason: null,
                        refusalLaw: null,
                        refusalMessage: null,
                },
        };
}

/** Builds the report from the run state (pure; the frozen lane order; the six ledger rows verbatim). */
function buildReport(state: AcceptanceRunState): HarnessAcceptanceReport {
        return {
                version: HARNESS_ACCEPTANCE_VERSION,
                industries: ACCEPTANCE_INDUSTRIES.map((industry) => state.rows.get(industry) as IndustryAcceptanceVerdict),
                compositionCensus: state.compositionCensus as HarnessCompositionCensus,
                gapLedger: HARNESS_ACCEPTANCE_GAP_LEDGER.map((row) => ({ gapKey: row.gapKey, description: row.description, evidenceLevel: row.evidenceLevel, owner: row.owner })),
                overallVerdict: state.overallVerdict as OverallVerdictRow,
                disclosures: [...ACCEPTANCE_DISCLOSURES],
        };
}

/** The report's canonical byte length (the frozen serialization). */
function reportBytes(report: HarnessAcceptanceReport): number {
        return serializeAcceptanceReport(report).length;
}

/** Writes the canonical report through the injected fs port (the CR-013 pattern's emission). */
async function writeReport(op: string, bound: { readonly fsPort: HarnessFsPort; readonly root: string }, report: HarnessAcceptanceReport): Promise<AcceptanceRunnerRefusal | null> {
        try {
                await bound.fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
        } catch (error) {
                return refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `writeReport.${op}: the fs port refused the root mkdir: ${toMessage(error)}`);
        }
        try {
                await bound.fsPort.writeFile(`${bound.root}/${ACCEPTANCE_REPORT_RELATIVE_PATH}`, serializeAcceptanceReport(report));
        } catch (error) {
                return refused('ACCEPTANCE_IO', 'THE FAIL-CLOSED LAW', `writeReport.${op}: the fs port refused the acceptance report write: ${toMessage(error)}`);
        }
        return null;
}

/** The report's own canonical walk (fail-closed: a report that fails its own walk is never emitted green). */
function validateReportWalk(report: HarnessAcceptanceReport): AcceptanceRunnerRefusal | null {
        const outcome = validateHarnessAcceptanceReport(report);
        if (!outcome.ok) {
                return refused('invalid-report', 'THE FAIL-CLOSED VERDICT LAW', `the built report failed its own canonical walk: ${outcome.rejection.message}`);
        }
        return null;
}

// --- the ledger replay (the laws re-proven from the ledger alone) ---------------------------------------------

type ReplayOutcome = { readonly ok: true; readonly state: AcceptanceRunState } | { readonly ok: false; readonly refusal: AcceptanceRunnerRefusal };

/**
 * THE APPEND-ONLY LEDGER LAW's replay: every line re-validated (the
 * frozen eight-key schema, the seq = line number, the single
 * version, the op vocabulary, the unique-industry law, the terminal
 * op order, the payload walks through the contract's own walks - the
 * row walk, the census shape, the six gap keys, the overall verdict
 * coherence, the emission receipt), the run state re-folded FROM THE
 * LEDGER ALONE. A torn or invalid line is the typed E_LEDGER_TORN.
 */
function replayAcceptanceLedger(ledgerText: string): ReplayOutcome {
        const lines = ledgerText.split('\n').filter((line) => line.trim().length > 0);
        if (lines.length === 0) {
                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'replayAcceptanceLedger: the acceptance ledger is empty or whitespace-only (a fresh root reopens as an empty runner; a torn ledger is never silently rebuilt)') };
        }
        const rows = new Map<HarnessIndustry, IndustryAcceptanceVerdict>();
        const industries: HarnessIndustry[] = [];
        let compositionCensus: HarnessCompositionCensus | null = null;
        let gapsRegistered = false;
        let overallVerdict: OverallVerdictRow | null = null;
        let emission: { readonly path: string; readonly bytes: number } | null = null;
        const terminalSeen: AcceptanceOpName[] = [];
        for (let i = 0; i < lines.length; i += 1) {
                let parsed: unknown;
                try {
                        parsed = JSON.parse(lines[i]);
                } catch {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} is not JSON (a torn ledger line is never silently skipped)`) };
                }
                if (!isPlainRecord(parsed)) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} is not a plain object`) };
                }
                const line = parsed as Record<string, unknown>;
                const unknownKeys = Object.keys(line).filter((key) => !(ACCEPTANCE_LEDGER_LINE_SCHEMA_KEYS as readonly string[]).includes(key));
                if (unknownKeys.length > 0) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries the unknown key(s) [${unknownKeys.join(', ')}] (the frozen eight-key line schema)`) };
                }
                const missingKeys = (ACCEPTANCE_LEDGER_LINE_SCHEMA_KEYS as readonly string[]).filter((key) => !(key in line));
                if (missingKeys.length > 0) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} is missing the key(s) [${missingKeys.join(', ')}]`) };
                }
                if (line.seq !== i + 1) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries seq ${String(line.seq)} (the seq must equal the line number - the strictly-increasing law)`) };
                }
                if (line.contractVersion !== HARNESS_ACCEPTANCE_VERSION) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE SINGLE-VERSION LAW', `replayAcceptanceLedger: the line ${i + 1} carries the contract version '${String(line.contractVersion)}' - only '${HARNESS_ACCEPTANCE_VERSION}' is known`) };
                }
                if (typeof line.at !== 'string' || line.at.length === 0 || typeof line.law !== 'string' || line.law.length === 0 || typeof line.detail !== 'string' || line.detail.length === 0) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries a malformed at / law / detail (all three must be non-empty strings)`) };
                }
                const op = line.op;
                if (!isAcceptanceOpName(op)) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries the unknown op '${String(op)}'`) };
                }
                if (op === 'run-industry') {
                        if (terminalSeen.length > 0) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} runs an industry AFTER the terminal walk began (the four runs precede the terminal ops)`) };
                        }
                        const industry = line.industry;
                        if (typeof industry !== 'string' || !(ACCEPTANCE_INDUSTRIES as readonly string[]).includes(industry)) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE FROZEN-VOCABULARY LAW', `replayAcceptanceLedger: the line ${i + 1} carries the industry '${String(industry)}' outside the frozen acceptance lane`) };
                        }
                        const laneIndustry = industry as HarnessIndustry;
                        if (industries.includes(laneIndustry)) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE UNIQUE-INDUSTRY LAW', `replayAcceptanceLedger: the line ${i + 1} repeats the industry '${laneIndustry}' (one row per industry per run)`) };
                        }
                        const rowWalk = validateIndustryVerdictRow(line.payload);
                        if (!rowWalk.ok) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} payload fails the industry-row walk: ${rowWalk.message}`) };
                        }
                        if (rowWalk.industry !== industry) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE UNIQUE-INDUSTRY LAW', `replayAcceptanceLedger: the line ${i + 1} carries the industry '${industry}' but its payload row carries '${rowWalk.industry}'`) };
                        }
                        industries.push(laneIndustry);
                        rows.set(laneIndustry, line.payload as IndustryAcceptanceVerdict);
                        continue;
                }
                // the terminal ops: compose-census -> register-gaps -> resolve-verdict -> emit-report, each exactly once, in order, only over the four lane industries.
                if (industries.length !== ACCEPTANCE_INDUSTRIES.length) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE FAIL-CLOSED VERDICT LAW', `replayAcceptanceLedger: the line ${i + 1} carries the terminal op '${op}' before the four lane industries ran (carried ${industries.length})`) };
                }
                if (line.industry !== null) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries the terminal op '${op}' with a non-null industry column`) };
                }
                const expectedTerminalIndex = terminalSeen.length;
                if (op !== ACCEPTANCE_OP_NAMES[1 + expectedTerminalIndex]) {
                        return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `replayAcceptanceLedger: the line ${i + 1} carries the terminal op '${op}' out of order (the frozen terminal walk: compose-census -> register-gaps -> resolve-verdict -> emit-report)`) };
                }
                terminalSeen.push(op);
                if (op === 'compose-census') {
                        const censusWalk = censusShapeWalk(line.payload);
                        if (censusWalk !== null) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE COMPOSITION-NOT-FORK LAW', `replayAcceptanceLedger: the line ${i + 1} payload fails the census walk: ${censusWalk}`) };
                        }
                        compositionCensus = line.payload as HarnessCompositionCensus;
                } else if (op === 'register-gaps') {
                        const payload = line.payload;
                        if (!Array.isArray(payload) || payload.length !== ACCEPTANCE_GAP_KEYS.length || (payload as unknown[]).some((key, index) => key !== ACCEPTANCE_GAP_KEYS[index])) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE GAP-MUST-BE-REGISTERED LAW', `replayAcceptanceLedger: the line ${i + 1} payload must be the six frozen gap keys in the frozen order`) };
                        }
                        gapsRegistered = true;
                } else if (op === 'resolve-verdict') {
                        const payload = line.payload;
                        if (!isPlainRecord(payload) || payload.verdict !== 'complete' || payload.industriesComplete !== ACCEPTANCE_INDUSTRIES.length || payload.industriesRefused !== 0 || payload.gapRowsRegistered !== HARNESS_ACCEPTANCE_GAP_LEDGER.length) {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE FAIL-CLOSED VERDICT LAW', `replayAcceptanceLedger: the line ${i + 1} payload must be the COMPLETE overall verdict (every industry complete, zero refused, all six ledger rows registered)`) };
                        }
                        overallVerdict = payload as unknown as OverallVerdictRow;
                } else {
                        const payload = line.payload;
                        if (!isPlainRecord(payload) || typeof payload.path !== 'string' || payload.path.length === 0 || typeof payload.bytes !== 'number') {
                                return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE CANONICAL SERIALIZATION LAW', `replayAcceptanceLedger: the line ${i + 1} payload must be the emission receipt { path, bytes }`) };
                        }
                        emission = { path: payload.path as string, bytes: payload.bytes as number };
                }
        }
        return { ok: true, state: { contractVersion: HARNESS_ACCEPTANCE_VERSION, seq: lines.length, industries, rows, compositionCensus, gapsRegistered, overallVerdict, emission } };
}

/** The census payload's structural walk (the twelve rows, the REAL lab version, the identity pins). */
function censusShapeWalk(payload: unknown): string | null {
        if (!isPlainRecord(payload)) {
                return 'the census must be a plain object';
        }
        const census = payload as Record<string, unknown>;
        if (census.labContractsVersion !== LAB_CONTRACTS_VERSION) {
                return 'the census must carry the REAL LAB_CONTRACTS_VERSION';
        }
        if (!Array.isArray(census.rows) || (census.rows as unknown[]).length !== COMPOSITION_VERSION_FAMILY_KEYS.length) {
                return `the census must carry exactly the twelve frozen family rows`;
        }
        for (const row of census.rows as unknown[]) {
                if (!isPlainRecord(row)) {
                        return 'every census row must be a plain object';
                }
                const rowRecord = row as Record<string, unknown>;
                if (!(COMPOSITION_VERSION_FAMILY_KEYS as readonly string[]).includes(rowRecord.family as string) || typeof rowRecord.contractVersion !== 'string' || rowRecord.contractVersion.length === 0 || rowRecord.identicalAcrossIndustries !== true) {
                        return 'every census row is { family, contractVersion, identicalAcrossIndustries: true } over the frozen family keys';
                }
        }
        if (!Array.isArray(census.industriesServed) || (census.industriesServed as unknown[]).length !== ACCEPTANCE_INDUSTRIES.length) {
                return 'the census must carry the four industries served';
        }
        if (!Array.isArray(census.sharedKitConstructions) || (census.sharedKitConstructions as unknown[]).length === 0) {
                return 'the census must carry the shared kit constructions (THE COMPOSITION-NOT-FORK LAW)';
        }
        if (census.fixturesArePureData !== true) {
                return 'the census must pin fixturesArePureData: true';
        }
        return null;
}

// --- the envelope ---------------------------------------------------------------------------------------------

/** The envelope's run summary (deterministic given the ledger; the byte-for-byte cross-check's content). */
function envelopeRunOf(state: AcceptanceRunState): { readonly industries: readonly string[]; readonly compositionCensus: boolean; readonly overallVerdict: string | null; readonly report: { readonly path: string; readonly bytes: number } | null } {
        return {
                industries: [...state.industries],
                compositionCensus: state.compositionCensus !== null,
                overallVerdict: state.overallVerdict !== null ? state.overallVerdict.verdict : null,
                report: state.emission === null ? null : { path: state.emission.path, bytes: state.emission.bytes },
        };
}

// --- the refusal helpers --------------------------------------------------------------------------------------

function refused(reason: AcceptanceRunnerRefusalReason, law: string, message: string, items?: readonly string[], extra?: { fixtureRejection?: AcceptanceRunnerRefusal['fixtureRejection'] }): AcceptanceRunnerRefusal {
        return { reason, law, message, ...(items === undefined ? {} : { items }), ...(extra === undefined || extra.fixtureRejection === undefined ? {} : { fixtureRejection: extra.fixtureRejection }) };
}

function journeyRefused(leg: string, refusal: ActivationKitRefusal): AcceptanceRunnerRefusal {
        return {
                reason: 'journey-refused',
                law: `THE VERBATIM-CARRY LAW (the ${leg} leg)`,
                message: `the REAL DH-11 activation journey kit refused the '${leg}' leg - the real refusal is carried COMPLETE below; THE FAIL-CLOSED VERDICT LAW: the whole run refuses with it (never a silent pass)`,
                activationRefusal: refusal,
        };
}

function recordReadRefused(op: string, family: string, refusal: { readonly reason: string; readonly law: string; readonly message?: string; readonly detail?: string; readonly items?: readonly string[] }): AcceptanceRunnerRefusal {
        const message = refusal.message !== undefined ? refusal.message : refusal.detail !== undefined ? refusal.detail : '';
        return {
                reason: 'record-read-refused',
                law: `THE VERBATIM-CARRY LAW (the ${family} read)`,
                message: `readComposedRecords.${op}: the REAL ${family} load / inspect surface refused the composed-record read - the real refusal is carried COMPLETE below`,
                recordReadRefusal: { reason: refusal.reason, law: refusal.law, message, ...(refusal.items === undefined ? {} : { items: [...refusal.items] }) },
        };
}

function navigationRefused(projection: { readonly refusal: { readonly reason: string; readonly law: string; readonly detail: string; readonly rejections?: readonly ProjectionsRejection[] } }): AcceptanceRunnerRefusal {
        return {
                reason: 'navigation-refused',
                law: 'THE VERBATIM-CARRY LAW (the DH-10 projection)',
                message: `runIndustryAcceptance: the REAL DH-10 projection refused the composed records (the COMPLETE contract rejection table rides this refusal - never first-only)`,
                navigationRejections: projection.refusal.rejections === undefined ? [] : [...projection.refusal.rejections],
        };
}

function benchmarkLegRefused(op: string, surface: string, refusal: { readonly reason: string; readonly law: string; readonly detail: string; readonly items?: readonly string[] }): AcceptanceRunnerRefusal {
        return {
                reason: 'benchmark-leg-refused',
                law: `THE VERBATIM-CARRY LAW (the DH-09 ${surface} surface)`,
                message: `runBenchmarkLeg.${op}: the REAL DH-09 benchmarks kit refused the '${surface}' leg - the real refusal is carried COMPLETE below`,
                benchmarksRefusal: { reason: refusal.reason, law: refusal.law, message: refusal.detail, ...(refusal.items === undefined ? {} : { items: [...refusal.items] }) },
        };
}

function optimizationRefused(op: string, leg: string, refusal: OptimizationKitRefusal): AcceptanceRunnerRefusal {
        return {
                reason: 'optimization-refused',
                law: `THE VERBATIM-CARRY LAW (the DH-12 ${leg} leg)`,
                message: `runOptimizationSmoke.${op}: the REAL DH-12 optimization loop kit refused the '${leg}' leg - the real refusal is carried COMPLETE below`,
                optimizationRefusal: refusal,
        };
}

// --- the factory validation + the small pure helpers -----------------------------------------------------------

/** The fail-closed factory walk (the landed family pattern: the same preconditions, the same message shapes). */
function validateRunnerOptions(options: AcceptanceRunnerOptions, factoryName: 'createAcceptanceRunner' | 'loadAcceptanceRunner'): BoundRunnerOptions {
        if (!isPlainRecord(options)) {
                throw new TypeError(`${factoryName}: options must be an object`);
        }
        const opts = options as Record<string, unknown>;
        if (typeof opts.clock !== 'function') {
                throw new TypeError(`${factoryName}: options.clock must be a function returning ISO string values (the injected-clock law - the runner never reads a clock itself)`);
        }
        const clock = opts.clock as () => string;
        const firstClock = clock();
        if (typeof firstClock !== 'string' || firstClock.length === 0) {
                throw new TypeError(`${factoryName}: options.clock() must return a non-empty ISO string (the injected-clock law)`);
        }
        if (typeof opts.rng !== 'function') {
                throw new TypeError(`${factoryName}: options.rng must be a function returning 16 lowercase hex chars (the id-minting seam - NEVER the random global)`);
        }
        const rng = opts.rng as () => string;
        const firstHex = rng();
        if (!/^[0-9a-f]{16}$/.test(firstHex)) {
                throw new TypeError(`${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam)`);
        }
        const port = opts.fsPort;
        if (!isPlainRecord(port)) {
                throw new TypeError(`${factoryName}: options.fsPort must be an object (the ONLY filesystem seam - the persistence pair is required, never optional)`);
        }
        for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir'] as const) {
                if (typeof (port as Record<string, unknown>)[name] !== 'function') {
                        throw new TypeError(`${factoryName}: options.fsPort.${name} must be a function (the ONLY filesystem seam)`);
                }
        }
        if (typeof opts.root !== 'string' || opts.root.length === 0) {
                throw new TypeError(`${factoryName}: options.root must be a non-empty string (the persistence root - the persistence pair is required, never optional)`);
        }
        return { clock, rng, fsPort: port as unknown as HarnessFsPort, root: (opts.root as string).replace(/\/+$/, ''), constructionClock: firstClock };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMessage(error: unknown): string {
        if (error instanceof Error) {
                return error.message;
        }
        return String(error);
}
