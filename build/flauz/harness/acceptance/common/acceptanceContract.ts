/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-013 acceptance contract family: the typed vocabulary for the
 * cross-industry harness acceptance instrument - the TWELFTH and FINAL
 * item of the Domain Harness OS workstream (WORK-REGISTRY.md § TL-B).
 * The instrument runs the integrated acceptance journey across FOUR
 * representative industries (software, finance, healthcare,
 * construction - all REAL members of the frozen HARNESS_INDUSTRIES
 * vocabulary), verifying that each harness is COMPOSED from reusable
 * contracts, configuration, content and capabilities - never a
 * separate industry fork (ARCHITECTURE-LOCK §12.5: "Industry
 * specialization is a harness over the universal Flauz core, not a
 * fork").
 *
 * THE COMPOSITION-NOT-FORK LAW (this family's first law): the
 * industries differ ONLY IN DATA. One set of real kit constructions
 * (the DH-11 activation journey kit, the DH-10 projections kit, the
 * DH-12 optimization loop kit, the composed-family kits) serves ALL
 * FOUR industries; a fifth industry is a NEW fixture module, never a
 * new code path. This contract module declares the industry-agnostic
 * fixture shape, the verdict-row shape and the census shape; the
 * industry vocabulary strings appear ONLY in the frozen
 * ACCEPTANCE_INDUSTRIES lane and the four curated fixture modules -
 * never in a code branch.
 *
 * THE FAIL-CLOSED VERDICT LAW (the row's core law): the overall
 * acceptance verdict is GREEN only when EVERY industry's journey leg
 * is complete AND every honest gap is REGISTERED. Any refused leg or
 * any missing gap registration is the TYPED refusal - never a silent
 * pass, never a partial green.
 *
 * THE HONEST GAP LEDGER (the row's other core law): a passing
 * framework test does not prove industry content exists or that an
 * end-to-end user journey is operational. The instrument registers
 * every uncovered gap honestly - six frozen rows, carried verbatim in
 * the report; the unproven is REGISTERED, never promoted. THE
 * CLOSED-ROW LAW (the DH-GAP-2 wave's lawful ledger update, the
 * frozen-ledger law's own subject): a row whose owning lane landed
 * its closure is updated to its CLOSED successor state - the closure
 * recorded IN the row's own description, never by silent removal -
 * and a closed row can never again be registered as an open gap by a
 * fixture (rows 1, 2 and 3 are closed at this version: the lab
 * task-worlds coverage closed 2026-10-15 when the three industry
 * task-worlds landed at PR #205 in the lab extension registry; the
 * content representativeness closed 2026-10-16 with the declared
 * censused content bar; the live-provider execution closed 2026-10-16
 * by the INF-009 canary's station-verified live-real run - a REAL
 * chat-completion round-trip recorded as live-real DrillRecord at the
 * INF boundary, never an exchange exercised here). Rows 4-6 remain
 * open and are registered by every fixture.
 *
 * THE CONTENT DISCLOSURE (binding on the four curated fixture
 * modules): the industry content sets are CURATED FIXTURE-LEVEL
 * acceptance content - representative, honestly labeled at the
 * DECLARED CENSUSED REPRESENTATIVENESS BAR (each industry at least
 * six roles, ten terms, four tasks, four bodies, four packs and two
 * profiles of real domain-shaped curated content; the census pinned
 * by the battery, the content-census disclosure riding every report).
 * NOT a claim of comprehensive domain truth, NOT promoted evidence.
 *
 * THE IMPORT LAW (binding): every vocabulary this contract names is
 * the OWNING real module's own, imported by reference - the twelve
 * prior family versions, the REAL LAB_CONTRACTS_VERSION, the REAL
 * industry / work-type / size-band vocabularies, the REAL permission /
 * tier / evidence-floor / eval-dimension vocabularies, the REAL
 * task-world scenario registries (the landed base registry through
 * getScenario; the combined catalog through the lab industry
 * extension registry's own getTaskScenario / getTaskWorld lookups),
 * the REAL family entry validators, the REAL decision-mirror
 * vocabularies. Never transcribed, never re-declared.
 *
 * THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 * and no process.env in this module (law comments excepted) - the
 * validation walks are pure functions over their inputs.
 */

import { isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessRole, HarnessWorkType, HarnessLifecycleState } from '../../contract/common/domainHarnessContract.js';
import { validateOnboardingCompanyProfile, validateOnboardingWorkTypes } from '../../onboarding/common/onboardingContract.js';
import type { OnboardingCompanyProfile } from '../../onboarding/common/onboardingContract.js';
import { validateRoleEntry, MAX_ROLES } from '../../roles/common/rolesContract.js';
import { validateTermEntry } from '../../ontology/common/ontologyContract.js';
import type { OntologyTerm } from '../../ontology/common/ontologyContract.js';
import { validateTaskEntry } from '../../templates/common/templatesContract.js';
import type { TaskTemplateEntry } from '../../templates/common/templatesContract.js';
import { validateBodyEntry } from '../../bodies/common/bodiesContract.js';
import type { BodyDefaultsEntry } from '../../bodies/common/bodiesContract.js';
import { validatePackEntry } from '../../packs/common/packsContract.js';
import type { PackEntry } from '../../packs/common/packsContract.js';
import { validateProfileEntry } from '../../profiles/common/profilesContract.js';
import type { ProfileEntry } from '../../profiles/common/profilesContract.js';
import { validateBenchmarkEntry } from '../../benchmarks/common/benchmarksContract.js';
import type { BenchmarkEntry, BenchmarksValidationOutcome } from '../../benchmarks/common/benchmarksContract.js';
import { getScenario } from '../../../lab/common/taskWorlds.js';
import { getTaskScenario, getTaskWorld, listIndustryWorlds } from '../../../lab/common/industryTaskWorlds.js';
import { LAB_CONTRACTS_VERSION } from '../../../lab/common/labContracts.js';
import type { LabEvidenceLevel } from '../../../lab/common/labContracts.js';
import type { ActivationJourneyStage } from '../../activation/common/activationContract.js';
import type { DomainNavigationSectionId } from '../../projections/common/projectionsContract.js';

// --- the single version --------------------------------------------------------------------------------

/**
 * The family's single contract version, declared ONCE (THE
 * SINGLE-VERSION LAW). Every version-bearing surface the runner emits
 * (every ops-ledger line, the envelope, the report, the census rows)
 * carries exactly this value; a drift is the typed version-mismatch.
 */
export const HARNESS_ACCEPTANCE_VERSION = '1.0.0';

/**
 * THE SINGLE-VERSION LAW's cross-pins: the TWELVE prior family
 * versions and the REAL LAB_CONTRACTS_VERSION, re-exported by
 * reference from their OWNING modules (never transcribed) so the
 * battery can pin them all equal. The acceptance family composes
 * records through all twelve families; the census (below) carries
 * their versions identically across every industry's composed
 * records.
 */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';
export { TEMPLATES_CONTRACTS_VERSION } from '../../templates/common/templatesContract.js';
export { BODIES_CONTRACTS_VERSION } from '../../bodies/common/bodiesContract.js';
export { PACKS_CONTRACTS_VERSION } from '../../packs/common/packsContract.js';
export { PROFILES_CONTRACTS_VERSION } from '../../profiles/common/profilesContract.js';
export { BENCHMARKS_CONTRACTS_VERSION } from '../../benchmarks/common/benchmarksContract.js';
export { PROJECTIONS_CONTRACTS_VERSION } from '../../projections/common/projectionsContract.js';
export { ACTIVATION_CONTRACTS_VERSION } from '../../activation/common/activationContract.js';
export { OPTIMIZATION_CONTRACTS_VERSION } from '../../optimization/common/optimizationContract.js';
export { LAB_CONTRACTS_VERSION } from '../../../lab/common/labContracts.js';

/**
 * THE IMPORT LAW's vocabulary re-exports: the REAL permission and
 * risk-tier vocabularies (the DH-08 profiles' authority-binding
 * tables), the REAL evidence ladder and eval dimensions (the DH-08
 * mirrors of the lab contracts' unions) and the REAL frozen
 * navigation-section list (the DH-10 section alphabet) - re-exported
 * by reference from their owning modules for the battery's pins,
 * never transcribed.
 */
export { CATALOG_PERMISSION_IDS, CATALOG_PERMISSION_RISK_TIERS } from '../../../capabilities/packs/common/catalog.js';
export { PROFILES_EVIDENCE_LADDER, PROFILES_EVAL_DIMENSIONS } from '../../profiles/common/profilesContract.js';
export { DOMAIN_NAVIGATION_SECTIONS } from '../../projections/common/projectionsContract.js';

// --- the frozen acceptance industry lane ------------------------------------------------------------------

/**
 * The frozen acceptance industry lane: the four representative
 * industries (software, finance, healthcare, construction) in the
 * frozen run order. Every member is a REAL HARNESS_INDUSTRIES member
 * (cross-pinned by construction - the tuple is typed over the real
 * union); the run order is FROZEN and widening it is a versioned
 * contract decision. The industry strings appear ONLY here and in the
 * four curated fixture modules - never in a runner code branch (THE
 * COMPOSITION-NOT-FORK LAW).
 */
export const ACCEPTANCE_INDUSTRIES = [
        'software',
        'finance',
        'healthcare',
        'construction',
] as const satisfies readonly HarnessIndustry[];
export type AcceptanceIndustry = (typeof ACCEPTANCE_INDUSTRIES)[number];

/** Pure predicate: a member of the frozen four-industry acceptance lane (and a REAL industry member). */
export function isAcceptanceIndustry(value: unknown): value is AcceptanceIndustry {
        return (ACCEPTANCE_INDUSTRIES as readonly string[]).includes(value as string);
}

// --- the honest gap ledger ---------------------------------------------------------------------------------

/**
 * The frozen gap-key vocabulary: the six honest gap keys (the ledger
 * row identities). Widening the list is a versioned contract decision.
 */
export const ACCEPTANCE_GAP_KEYS = [
        'lab-task-worlds-coverage',
        'content-representativeness',
        'no-live-provider-execution',
        'no-production-real-harness-deployment',
        'workbench-surface-runtime-binding',
        'cr-ledger-integration-gaps',
] as const;
export type AcceptanceGapKey = (typeof ACCEPTANCE_GAP_KEYS)[number];

/** Pure predicate over the closed gap-key list. */
export function isAcceptanceGapKey(value: unknown): value is AcceptanceGapKey {
        return (ACCEPTANCE_GAP_KEYS as readonly string[]).includes(value as string);
}

/**
 * THE CLOSED-ROW LAW's frozen closed-key list (the DH-GAP-2 wave's
 * lawful ledger update, extended to row 3 by the DH-GAP-3 wave): the
 * ledger rows whose owning lanes landed their closures -
 * 'lab-task-worlds-coverage' (closed 2026-10-15: the three industry
 * task-worlds landed at PR #205 in the lab industry extension
 * registry, so all four acceptance-lane industries carry
 * industry-specific simulation worlds),
 * 'content-representativeness' (closed 2026-10-16: the four industry
 * content sets deepened to the declared censused representativeness
 * bar) and 'no-live-provider-execution' (closed 2026-10-16: the
 * INF-009 live-provider canary ran green over a station-configured
 * REAL provider endpoint - the station's endpoint contract over the
 * platform's sanctioned inference gateway - the exchange recorded as
 * a live-real DrillRecord at the INF boundary). A closed row rides
 * the report VERBATIM - its closure recorded IN its own description -
 * and can never be registered as an open gap by a fixture. The list
 * is cross-pinned against the ledger by construction (every member is
 * a frozen row) and by the battery (every closed row's description
 * records its closure; no open row's description does).
 */
export const ACCEPTANCE_CLOSED_GAP_KEYS = [
        'lab-task-worlds-coverage',
        'content-representativeness',
        'no-live-provider-execution',
] as const satisfies readonly AcceptanceGapKey[];
export type AcceptanceClosedGapKey = (typeof ACCEPTANCE_CLOSED_GAP_KEYS)[number];

/** Pure predicate over the closed-key list (THE CLOSED-ROW LAW's state surface). */
export function isAcceptanceClosedGapKey(value: unknown): value is AcceptanceClosedGapKey {
        return (ACCEPTANCE_CLOSED_GAP_KEYS as readonly string[]).includes(value as string);
}

/**
 * One honest gap ledger row: the frozen gapKey, the description
 * (registered VERBATIM in the report, never paraphrased), the evidence
 * level of what IS proven today (a REAL ladder rung - the honest
 * floor, never a promotion), and the owning lane accountable for
 * closing it.
 */
export interface AcceptanceGapRow {
        readonly gapKey: AcceptanceGapKey;
        readonly description: string;
        readonly evidenceLevel: LabEvidenceLevel;
        readonly owner: string;
}

/** The frozen gap-row schema keys, in the canonical fixed-key-order. */
export const ACCEPTANCE_GAP_ROW_SCHEMA_KEYS = ['gapKey', 'description', 'evidenceLevel', 'owner'] as const;

/**
 * THE HONEST GAP LEDGER: the six frozen rows, registered VERBATIM in
 * every acceptance report. The instrument never closes these rows by
 * passing a test - the report carries them so a green verdict can
 * never be read as a claim the ledger refutes. THE CLOSED-ROW LAW
 * (the DH-GAP-2 and DH-GAP-3 waves): rows 1, 2 and 3 carry their
 * CLOSED successor states - the closures recorded IN the rows' own
 * descriptions (the truth of what landed, with the dates and the
 * bounds), never by silent removal - and rows 4-6 remain the open
 * registered residue.
 */
export const HARNESS_ACCEPTANCE_GAP_LEDGER: readonly AcceptanceGapRow[] = Object.freeze([
        Object.freeze({
                gapKey: 'lab-task-worlds-coverage',
                description: 'CLOSED 2026-10-15: the three industry task-worlds (finance/healthcare/construction) landed at PR #205 in the lab extension registry; the SE world plus three industry worlds - all four acceptance-lane industries carry industry-specific simulation worlds and their benchmark legs are bound; the coverage row is closed, recorded in the row (never by silent removal)',
                evidenceLevel: 'fixture',
                owner: 'TL-B (the Lab lane)',
        }),
        Object.freeze({
                gapKey: 'content-representativeness',
                description: 'CLOSED 2026-10-16: the four industry content sets are deepened to the declared censused representativeness bar - each industry carries at least six roles, ten terms, four tasks, four bodies, four packs and two profiles of real domain-shaped curated content (the census pinned by the battery, the content-census disclosure riding every report); the fixture-level bound stays disclosed - curated acceptance content, never a domain-truth claim; the row is closed, recorded in the row (never by silent removal)',
                evidenceLevel: 'fixture',
                owner: 'TL-B (the harness acceptance family)',
        }),
        Object.freeze({
                gapKey: 'no-live-provider-execution',
                description: 'CLOSED 2026-10-16: the INF-009 live-provider canary ran green with a station-configured REAL provider endpoint (the station\'s endpoint contract over the platform\'s sanctioned inference gateway - a REAL chat-completion round-trip; the raw secret stays station-side, the drill binds only the opaque handle) - a REAL network exchange recorded as live-real DrillRecord (drillClass "acceptance-exchange", verdict "eligible", the byte-identical ledger read-back, the fixture-configured no-live-port rejection - live-real is claimed ONLY when a live exchange actually happened); the row is closed, recorded in the row (never by silent removal)',
                evidenceLevel: 'fixture',
                owner: 'INF lane (the INF-009 canary)',
        }),
        Object.freeze({
                gapKey: 'no-production-real-harness-deployment',
                description: 'the harness families\' evidence ceiling is fixture/simulated; production deployment of harness configurations is a future TL-A-coordinated step',
                evidenceLevel: 'fixture',
                owner: 'TL-A (the production lane)',
        }),
        Object.freeze({
                gapKey: 'workbench-surface-runtime-binding',
                description: 'the flauz-harness extension\'s runtime binding is covered by the bundle+activation gates (the flauz-lab law), not the node lane; the UI behavior is verified here at the projection-derivation level + the extension\'s own node suites',
                evidenceLevel: 'fixture',
                owner: 'TL-B (the workbench surface family)',
        }),
        Object.freeze({
                gapKey: 'cr-ledger-integration-gaps',
                description: 'the Phase C-R terminal ledger\'s three exercised-but-unresolved and two unexercised integration gaps remain tracked in the CR records (cross-referenced, not re-litigated here)',
                evidenceLevel: 'fixture',
                owner: 'station (the Phase C-R ledger)',
        }),
]);

// --- the curated industry fixture ----------------------------------------------------------------------

/**
 * The frozen curated-fixture shape: the exact eleven keys of an
 * IndustryAcceptanceFixture, in the canonical fixed-key-order (the
 * walk order). Every entry shape is the OWNING real family's own
 * interface, imported by reference (THE IMPORT LAW).
 */
export const INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS = [
        'industry',
        'companyProfile',
        'workTypes',
        'roles',
        'terms',
        'tasks',
        'bodies',
        'packs',
        'profiles',
        'benchmark',
        'expectedGaps',
] as const;

// --- the benchmark binding modes (the DH-GAP-2 wave's additive contract addition) ------------------------

/**
 * THE BENCHMARK BINDING MODES (the DH-GAP-2 wave's additive contract
 * addition, disclosed in the wave's D-register): the two frozen lanes
 * a curated benchmark binds its scenarioRefs through -
 *   'base-registry'                - the plain BenchmarkEntry shape
 *                                   (the landed binding: every
 *                                   scenarioRef resolves against the
 *                                   REAL landed base registry through
 *                                   the imported getScenario; lawful
 *                                   on the software fixture only -
 *                                   THE REGISTRY FACT LAW, the base
 *                                   registry carries the SE fixture
 *                                   world, the software industry's
 *                                   own);
 *   'industry-extension-registry'  - the wrapped IndustryBenchmarkBinding
 *                                   (the wave's extension: every
 *                                   scenarioRef resolves against the
 *                                   REAL combined catalog through the
 *                                   lab industry extension registry's
 *                                   own imported getTaskScenario and
 *                                   binds the fixture industry's OWN
 *                                   task-world - the world's declared
 *                                   domain equals the fixture's
 *                                   industry, never a neighbor's
 *                                   world, never the SE world).
 * The modes are dispatched over the carrier's OWN shape (the declared
 * bindingMode field) - data-driven, never an industry-string branch.
 */
export const ACCEPTANCE_BENCHMARK_BINDING_MODES = ['base-registry', 'industry-extension-registry'] as const;
export type AcceptanceBenchmarkBindingMode = (typeof ACCEPTANCE_BENCHMARK_BINDING_MODES)[number];

/** Pure predicate over the closed binding-mode list. */
export function isAcceptanceBenchmarkBindingMode(value: unknown): value is AcceptanceBenchmarkBindingMode {
        return (ACCEPTANCE_BENCHMARK_BINDING_MODES as readonly string[]).includes(value as string);
}

/** The frozen industry-extension binding schema keys, in the canonical fixed-key-order. */
export const INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS = ['bindingMode', 'entry'] as const;

/**
 * THE INDUSTRY-EXTENSION BENCHMARK BINDING: the curated benchmark for
 * an industry whose task-world lives in the lab industry extension
 * registry - the frozen declared bindingMode plus the curated entry
 * (the REAL DH-09 BenchmarkEntry shape, every scenarioRef binding the
 * industry's OWN world through the combined catalog). The entry rides
 * THE TWO-PHASE BINDING LAW below (the REAL DH-09 walk green in every
 * station except the base-registry scenario binding, which this
 * family re-binds through the combined catalog - the lawful lane,
 * never a forced binding into the landed base-registry-bound record
 * machinery).
 */
export interface IndustryBenchmarkBinding {
        readonly bindingMode: 'industry-extension-registry';
        readonly entry: BenchmarkEntry;
}

/**
 * Pure classifier over the benchmark carrier (THE BINDING-MODE
 * DISPATCH): the honest null, the wrapped industry-extension binding,
 * or the plain base-registry BenchmarkEntry shape. Never an
 * industry-string branch - the mode is declared by the carrier's own
 * shape.
 */
export function benchmarkBindingModeOf(benchmark: unknown): AcceptanceBenchmarkBindingMode | null {
        if (benchmark === null) {
                return null;
        }
        if (isRecord(benchmark) && (benchmark as Record<string, unknown>).bindingMode === 'industry-extension-registry') {
                return 'industry-extension-registry';
        }
        return 'base-registry';
}

/**
 * The classified benchmark binding (the runner's benchmark-leg
 * dispatch shape): the declared binding mode plus the curated entry
 * (unwrapped for the industry-extension binding).
 */
export interface BenchmarkBinding {
        readonly mode: AcceptanceBenchmarkBindingMode;
        readonly entry: BenchmarkEntry;
}

/**
 * Pure binding classifier: the dispatch shape over the benchmark
 * carrier - the honest null, or { mode, entry } with the entry
 * unwrapped for the industry-extension binding (THE BINDING-MODE
 * DISPATCH; data-driven over the carrier's own shape).
 */
export function benchmarkBindingOf(benchmark: unknown): BenchmarkBinding | null {
        const mode = benchmarkBindingModeOf(benchmark);
        if (mode === null) {
                return null;
        }
        if (mode === 'industry-extension-registry') {
                return { mode, entry: (benchmark as IndustryBenchmarkBinding).entry };
        }
        return { mode, entry: benchmark as BenchmarkEntry };
}

/**
 * THE CURATED CENSUS (the frozen per-fixture entry counts - the
 * DH-GAP-2 wave's declared censused representativeness bar, the
 * doubled composition): exactly six roles, ten terms, four tasks,
 * four bodies, four packs and two profiles. The four curated fixture
 * modules satisfy it by construction; a fixture outside the census is
 * the typed fixture-count-law rejection (the curated set's shape law,
 * never a runner code branch).
 */
export const FIXTURE_ENTRY_CENSUS = Object.freeze({
        roles: Object.freeze({ min: 6, max: 6 }),
        terms: Object.freeze({ min: 10, max: 10 }),
        tasks: Object.freeze({ min: 4, max: 4 }),
        bodies: Object.freeze({ min: 4, max: 4 }),
        packs: Object.freeze({ min: 4, max: 4 }),
        profiles: Object.freeze({ min: 2, max: 2 }),
} as const);

/**
 * THE CONTENT LAW's curated industry fixture: the caller-supplied
 * (curated, fixture-level) acceptance content for ONE industry. The
 * industries differ ONLY in this data (THE COMPOSITION-NOT-FORK LAW):
 *   - industry: one REAL HARNESS_INDUSTRIES member;
 *   - companyProfile: the REAL DH-02 shape (a REAL COMPANY_SIZE_BANDS
 *     member);
 *   - workTypes: a non-empty ordered subset of the REAL ten;
 *   - roles: EXACTLY six named roles (the DH-03 shape - THE
 *     MULTI-ROLE LAW's representative composition at the declared
 *     censused bar; industry-meaningful roleKeys);
 *   - terms: EXACTLY ten terms of art (the DH-04 shape);
 *   - tasks: EXACTLY four task templates (the DH-05 shape), every
 *     termRef resolving into THIS fixture's terms (THE
 *     INTERNAL-REF LAW);
 *   - bodies: EXACTLY four organization-default entries (the DH-06
 *     shape), every roleRef resolving into THIS fixture's roles;
 *   - packs: EXACTLY four capability-pack entries (the DH-07 shape),
 *     every bodyRef resolving into THIS fixture's bodies;
 *   - profiles: EXACTLY two policy profiles (the DH-08 shape:
 *     permissionRefs from the REAL catalog members, approvalTiers
 *     from the REAL tiers, evidenceFloor a REAL ladder rung,
 *     kpiDimensions REAL dims);
 *   - benchmark: the curated industry benchmark in ONE of the two
 *     frozen binding modes - the plain base-registry BenchmarkEntry
 *     (software only, THE REGISTRY FACT LAW: the landed base registry
 *     carries the SE fixture world, the software industry's own) or
 *     the wrapped industry-extension IndustryBenchmarkBinding (an
 *     industry whose task-world lives in the lab industry extension
 *     registry, binding its OWN world's REAL scenarios through the
 *     combined catalog); a fixture whose industry carries NO
 *     task-world carries the honest null (the benchmarkStatus
 *     gap-registered path);
 *   - expectedGaps: the typed gap rows this industry HONESTLY
 *     registers (each a frozen ledger row, carried verbatim; the
 *     CLOSED rows 1-3 are registered by NONE - their closures are
 *     recorded IN the ledger rows themselves).
 */
export interface IndustryAcceptanceFixture {
        readonly industry: HarnessIndustry;
        readonly companyProfile: OnboardingCompanyProfile;
        readonly workTypes: readonly HarnessWorkType[];
        readonly roles: readonly HarnessRole[];
        readonly terms: readonly OntologyTerm[];
        readonly tasks: readonly TaskTemplateEntry[];
        readonly bodies: readonly BodyDefaultsEntry[];
        readonly packs: readonly PackEntry[];
        readonly profiles: readonly ProfileEntry[];
        readonly benchmark: BenchmarkEntry | IndustryBenchmarkBinding | null;
        readonly expectedGaps: readonly AcceptanceGapRow[];
}

/**
 * Closed frozen list of fixture rejection reasons, in the exact walk
 * order (the walk collects EVERY violated law into the typed
 * rejection table; the first failure is the verdict at the carrier
 * stations, the entry stations surface the OWNING family's COMPLETE
 * typed rejection table verbatim):
 *   malformed-fixture              - the candidate is not a plain
 *                                   object;
 *   unknown-key                    - a key outside the frozen
 *                                   eleven-key fixture schema;
 *   missing-key                    - a required fixture key is absent;
 *   unknown-industry               - the industry is not a REAL
 *                                   HARNESS_INDUSTRIES member (THE
 *                                   FROZEN-VOCABULARY LAW);
 *   invalid-company-profile        - the profile fails the REAL DH-02
 *                                   walk (surfaced verbatim);
 *   invalid-work-types             - the work types fail the REAL
 *                                   DH-02 walk (surfaced verbatim);
 *   invalid-roles                  - the roles fail the REAL DH-03
 *                                   entry walk / the six-role
 *                                   curated census (surfaced
 *                                   verbatim);
 *   invalid-terms                  - the terms fail the REAL DH-04
 *                                   entry walk / the ten-term census;
 *   invalid-tasks                  - the tasks fail the REAL DH-05
 *                                   entry walk / the four-task census;
 *   invalid-bodies                 - the bodies fail the REAL DH-06
 *                                   entry walk / the four-body census;
 *   invalid-packs                  - the packs fail the REAL DH-07
 *                                   entry walk / the four-pack census;
 *   invalid-profiles               - the profiles fail the REAL DH-08
 *                                   entry walk / the two-profile census;
 *   invalid-benchmark              - the benchmark fails the REAL
 *                                   DH-09 entry walk (base-registry
 *                                   mode), or the wrapped
 *                                   industry-extension binding fails
 *                                   its own strict two-key schema /
 *                                   THE TWO-PHASE BINDING LAW (the
 *                                   entry must be green in every REAL
 *                                   DH-09 station except the
 *                                   base-registry scenario binding,
 *                                   refused with EXACTLY the
 *                                   dangling-scenario-ref station);
 *   unknown-scenario-ref           - a benchmark scenarioRef does not
 *                                   resolve against the REAL registry
 *                                   lane it binds through (the base
 *                                   registry's getScenario for the
 *                                   base-registry mode; the combined
 *                                   catalog's getTaskScenario for the
 *                                   industry-extension mode - never a
 *                                   transcribed list);
 *   benchmark-industry-mismatch    - THE INDUSTRY-MATCH LAW (the
 *                                   registry fact, updated by the
 *                                   DH-GAP-2 wave): a base-registry
 *                                   binding on a non-software fixture
 *                                   (the landed base registry carries
 *                                   the SE fixture world, the software
 *                                   industry's own), or an
 *                                   industry-extension binding whose
 *                                   scenarioRefs bind a world that is
 *                                   NOT the fixture industry's own
 *                                   (a neighbor's world or the SE
 *                                   world - the world's declared
 *                                   domain must equal the fixture's
 *                                   industry); a curated benchmark
 *                                   content claim the registries
 *                                   cannot back is refused, never
 *                                   fabricated;
 *   dangling-ref                   - THE INTERNAL-REF LAW: a task
 *                                   termRef / body roleRef / pack
 *                                   bodyRef does not resolve into THIS
 *                                   fixture's own entries;
 *   duplicate-key                  - repeated identity keys (roleKeys
 *                                   / terms / taskKeys / bodyKeys /
 *                                   packKeys / profileKeys);
 *   fixture-count-law              - the curated census counts
 *                                   violated (exactly six roles, ten
 *                                   terms, four tasks, four bodies,
 *                                   four packs, two profiles, and the
 *                                   profiles collectively declare at
 *                                   least one REAL KPI dimension - the
 *                                   registry-bound benchmark derivation
 *                                   floor);
 *   gap-registration-missing       - THE COVERAGE LAW (the updated
 *                                   fail-closed truth): a fixture whose
 *                                   industry carries a task-world
 *                                   (software through the landed base
 *                                   registry; finance / healthcare /
 *                                   construction through the lab
 *                                   industry extension registry)
 *                                   carries NO curated benchmark - the
 *                                   coverage row is CLOSED, there is no
 *                                   honest registration for an
 *                                   un-exercised evaluable benchmark
 *                                   leg (fail-closed - never a silent
 *                                   skip);
 *   gap-registration-inconsistent  - THE CLOSED-ROW LAW: an
 *                                   expectedGaps row is a CLOSED ledger
 *                                   row ('lab-task-worlds-coverage' /
 *                                   'content-representativeness' /
 *                                   'no-live-provider-execution') - a
 *                                   closed row's closure is recorded
 *                                   IN the ledger row and can never be
 *                                   registered as an open gap; or an
 *                                   expectedGaps row is an unknown gap
 *                                   key, a duplicate, or a DRIFTED copy
 *                                   of its frozen ledger row (the rows
 *                                   are registered VERBATIM).
 */
export const FIXTURE_REJECTION_REASONS = [
        'malformed-fixture',
        'unknown-key',
        'missing-key',
        'unknown-industry',
        'invalid-company-profile',
        'invalid-work-types',
        'invalid-roles',
        'invalid-terms',
        'invalid-tasks',
        'invalid-bodies',
        'invalid-packs',
        'invalid-profiles',
        'invalid-benchmark',
        'unknown-scenario-ref',
        'benchmark-industry-mismatch',
        'dangling-ref',
        'duplicate-key',
        'fixture-count-law',
        'gap-registration-missing',
        'gap-registration-inconsistent',
] as const;
export type FixtureRejectionReason = (typeof FIXTURE_REJECTION_REASONS)[number];

/** Pure predicate over the closed fixture-rejection list. */
export function isFixtureRejectionReason(value: unknown): value is FixtureRejectionReason {
        return (FIXTURE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed fixture rejection: the frozen reason, the violated law's
 * name, the deterministic message, the offending items and - THE
 * VERBATIM-CARRY LAW - the OWNING family's COMPLETE typed rejection
 * table when an entry station refused (never first-only, never
 * paraphrased).
 */
export interface FixtureRejection {
        readonly reason: FixtureRejectionReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
}

/** The typed fixture-validation outcome: ok carries the canonical fixed-key-order copy; refusal carries the typed rejection. */
export type FixtureValidationOutcome =
        | { readonly ok: true; readonly fixture: IndustryAcceptanceFixture }
        | { readonly ok: false; readonly rejection: FixtureRejection };

/**
 * The curated-fixture walk (pure): the strict-schema stations, then
 * the REAL vocabulary stations (industry, size band via the REAL
 * DH-02 company-profile walk, work types via the REAL DH-02
 * work-types walk), then the entry stations (each family's entries
 * walked by the OWNING family's REAL validator, imported by
 * reference, the first failure surfacing the family's COMPLETE typed
 * rejection table verbatim), then THE INTERNAL-REF LAW (task termRefs
 * -> terms, body roleRefs -> roles, pack bodyRefs -> bodies), the
 * curated census, THE BINDING-MODE LAW (the base-registry walk: the
 * REAL DH-09 walk + the REAL base-registry scenario binding + THE
 * REGISTRY FACT LAW; the industry-extension walk: the strict two-key
 * schema + THE TWO-PHASE BINDING LAW + the REAL combined-catalog
 * scenario binding + THE INDUSTRY-MATCH LAW) and THE GAP LAWS (THE
 * CLOSED-ROW LAW + THE COVERAGE LAW). Ok carries the canonical
 * fixed-key-order copy. First-failure-is-the-verdict at the carrier
 * stations; the law table collects every violated count/ref law into
 * one typed rejection.
 */
export function validateIndustryAcceptanceFixture(fixture: unknown): FixtureValidationOutcome {
        if (!isRecord(fixture)) {
                return fixtureRejected('malformed-fixture', 'THE FAIL-CLOSED LAW', 'validateIndustryAcceptanceFixture: the fixture must be a plain object (never a silent partial verdict)', ['fixture']);
        }
        const candidate = fixture as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return fixtureRejected('unknown-key', 'THE STRICT-SCHEMA LAW', `validateIndustryAcceptanceFixture: the fixture schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (a fixture is the curated data alphabet, never more)`, unknownKeys);
        }
        const missingKeys = (INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return fixtureRejected('missing-key', 'THE FAIL-CLOSED LAW', `validateIndustryAcceptanceFixture: the fixture schema requires every key - the key(s) ${showList(missingKeys)} are missing (an absent family is the empty/absent carrier the shape declares, never an absent key)`, missingKeys);
        }
        if (!isHarnessIndustry(candidate.industry)) {
                return fixtureRejected('unknown-industry', 'THE FROZEN-VOCABULARY LAW', `validateIndustryAcceptanceFixture: the industry '${showValue(candidate.industry)}' is not a member of the REAL HARNESS_INDUSTRIES vocabulary (imported by reference - a fixture outside the real vocabulary is refused)`, ['industry']);
        }
        const company = validateOnboardingCompanyProfile(candidate.companyProfile);
        if (!company.ok) {
                return fixtureRejected('invalid-company-profile', 'THE IMPORT LAW (THE VERBATIM-CARRY LAW)', `validateIndustryAcceptanceFixture: the company profile fails the REAL DH-02 walk (surfaced verbatim: ${company.refusal.message})`, ['companyProfile']);
        }
        const workTypes = validateOnboardingWorkTypes(candidate.workTypes);
        if (!workTypes.ok) {
                return fixtureRejected('invalid-work-types', 'THE IMPORT LAW (THE VERBATIM-CARRY LAW)', `validateIndustryAcceptanceFixture: the work-type selection fails the REAL DH-02 walk (surfaced verbatim: ${workTypes.refusal.message})`, ['workTypes']);
        }
        if (!Array.isArray(candidate.roles) || !Array.isArray(candidate.terms) || !Array.isArray(candidate.tasks) || !Array.isArray(candidate.bodies) || !Array.isArray(candidate.packs) || !Array.isArray(candidate.profiles)) {
                return fixtureRejected('malformed-fixture', 'THE FAIL-CLOSED LAW', 'validateIndustryAcceptanceFixture: the entry families (roles / terms / tasks / bodies / packs / profiles) must be arrays', ['roles', 'terms', 'tasks', 'bodies', 'packs', 'profiles']);
        }
        if (candidate.benchmark !== null && !isRecord(candidate.benchmark)) {
                return fixtureRejected('invalid-benchmark', 'THE FAIL-CLOSED LAW', 'validateIndustryAcceptanceFixture: the benchmark slot must be the curated BenchmarkEntry or the honest null (never a malformed carrier)', ['benchmark']);
        }
        if (!Array.isArray(candidate.expectedGaps)) {
                return fixtureRejected('malformed-fixture', 'THE FAIL-CLOSED LAW', 'validateIndustryAcceptanceFixture: the expectedGaps must be an array of honest gap rows', ['expectedGaps']);
        }
        // The entry stations: the OWNING family's REAL validator, imported by reference.
        for (let i = 0; i < (candidate.roles as unknown[]).length; i += 1) {
                const verdict = validateRoleEntry((candidate.roles as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-roles', `THE VERBATIM-CARRY LAW (roles[${i}])`, `validateIndustryAcceptanceFixture: the role entry ${i} fails the OWNING family's REAL validator (the DH-03 finalize floor is at least one role; the composition bound ${MAX_ROLES}; the family's typed rejection table is carried in the owning family's own refusal)`, [`roles[${i}]`]);
                }
        }
        for (let i = 0; i < (candidate.terms as unknown[]).length; i += 1) {
                const verdict = validateTermEntry((candidate.terms as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-terms', `THE VERBATIM-CARRY LAW (terms[${i}])`, `validateIndustryAcceptanceFixture: the term entry ${i} fails the OWNING family's REAL validator (the family's typed rejection table is carried in the owning family's own refusal)`, [`terms[${i}]`]);
                }
        }
        for (let i = 0; i < (candidate.tasks as unknown[]).length; i += 1) {
                const verdict = validateTaskEntry((candidate.tasks as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-tasks', `THE VERBATIM-CARRY LAW (tasks[${i}])`, `validateIndustryAcceptanceFixture: the task entry ${i} fails the OWNING family's REAL validator (the family's typed rejection table is carried in the owning family's own refusal)`, [`tasks[${i}]`]);
                }
        }
        for (let i = 0; i < (candidate.bodies as unknown[]).length; i += 1) {
                const verdict = validateBodyEntry((candidate.bodies as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-bodies', `THE VERBATIM-CARRY LAW (bodies[${i}])`, `validateIndustryAcceptanceFixture: the body entry ${i} fails the OWNING family's REAL validator (the family's typed rejection table is carried in the owning family's own refusal)`, [`bodies[${i}]`]);
                }
        }
        for (let i = 0; i < (candidate.packs as unknown[]).length; i += 1) {
                const verdict = validatePackEntry((candidate.packs as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-packs', `THE VERBATIM-CARRY LAW (packs[${i}])`, `validateIndustryAcceptanceFixture: the pack entry ${i} fails the OWNING family's REAL validator (the family's typed rejection table is carried in the owning family's own refusal)`, [`packs[${i}]`]);
                }
        }
        for (let i = 0; i < (candidate.profiles as unknown[]).length; i += 1) {
                const verdict = validateProfileEntry((candidate.profiles as unknown[])[i]);
                if (!verdict.ok) {
                        return fixtureRejected('invalid-profiles', `THE VERBATIM-CARRY LAW (profiles[${i}])`, `validateIndustryAcceptanceFixture: the profile entry ${i} fails the OWNING family's REAL validator (the permission/tier/evidence-floor/KPI vocabularies are the REAL imported ones; the family's typed rejection table is carried in the owning family's own refusal)`, [`profiles[${i}]`]);
                }
        }
        // ---- THE BINDING-MODE LAW (data-driven over the carrier's own shape; never an industry-string branch) ----
        if (candidate.benchmark !== null) {
                if (benchmarkBindingModeOf(candidate.benchmark) === 'industry-extension-registry') {
                        // ---- the industry-extension binding walk (the DH-GAP-2 wave's extension) ----
                        // THE STRICT-SCHEMA LAW: the wrapped binding is the frozen two-key shape.
                        const binding = candidate.benchmark as Record<string, unknown>;
                        const unknownBindingKeys = Object.keys(binding).filter((key) => !(INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS as readonly string[]).includes(key));
                        if (unknownBindingKeys.length > 0) {
                                return fixtureRejected('invalid-benchmark', 'THE STRICT-SCHEMA LAW (the industry-extension binding)', `validateIndustryAcceptanceFixture: the industry-extension benchmark binding schema is closed - the unknown key(s) ${showList(unknownBindingKeys)} are rejected (a binding is the declared mode plus the curated entry, never more)`, unknownBindingKeys);
                        }
                        const missingBindingKeys = (INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(binding, key));
                        if (missingBindingKeys.length > 0) {
                                return fixtureRejected('invalid-benchmark', 'THE FAIL-CLOSED LAW (the industry-extension binding)', `validateIndustryAcceptanceFixture: the industry-extension benchmark binding requires both keys - the key(s) ${showList(missingBindingKeys)} are missing`, missingBindingKeys);
                        }
                        // THE TWO-PHASE BINDING LAW: the REAL DH-09 entry walk must refuse the
                        // entry with EXACTLY the dangling-scenario-ref station - every other
                        // REAL station green (the shapes, the text legs, the KPI vocabulary, the
                        // evidence ceiling), and the binding genuinely extension-bound (the
                        // refs do not resolve against the landed base registry). The family then
                        // re-binds the same refs through the combined catalog below - the lawful
                        // lane, never a forced binding into the landed base-registry-bound record
                        // machinery (which would require re-opening landed laws).
                        const entryWalk = validateBenchmarkEntry(binding.entry);
                        if (entryWalk.ok || entryWalk.rejections.length !== 1 || entryWalk.rejections[0].reason !== 'dangling-scenario-ref') {
                                const stationItems = entryWalk.ok ? ['the REAL DH-09 walk is green (a base-registry binding must be the plain BenchmarkEntry shape, never the wrapped binding)'] : entryWalk.rejections.map((rejection) => `${rejection.reason}:${(rejection.items ?? []).join(',')}`);
                                return fixtureRejected('invalid-benchmark', 'THE TWO-PHASE BINDING LAW (THE VERBATIM-CARRY LAW)', `validateIndustryAcceptanceFixture: an industry-extension benchmark entry must fail the OWNING family's REAL DH-09 validator with EXACTLY the dangling-scenario-ref station (green in every other station, the refs genuinely extension-bound); the carried station(s) ${showList(stationItems)} refuse the wrapped binding`, stationItems);
                        }
                        const entry = binding.entry as unknown as BenchmarkEntry;
                        // THE SCENARIO-BINDING LAW (the combined catalog): every scenarioRef resolves
                        // through the REAL imported getTaskScenario (the lab industry extension
                        // registry's own combined-catalog lookup - never a transcribed list).
                        const unresolved: string[] = [];
                        for (const scenarioRef of entry.scenarioRefs) {
                                if (getTaskScenario(scenarioRef) === undefined) {
                                        unresolved.push(scenarioRef);
                                }
                        }
                        if (unresolved.length > 0) {
                                return fixtureRejected('unknown-scenario-ref', 'THE SCENARIO-BINDING LAW (the combined catalog)', `validateIndustryAcceptanceFixture: every industry-extension benchmark scenarioRef must resolve against the REAL combined task-world catalog (imported through getTaskScenario from the lab industry extension registry - never a transcribed list); the unresolved ref(s) ${showList(unresolved)} are refused`, unresolved);
                        }
                        // THE INDUSTRY-MATCH LAW: every scenarioRef binds the fixture industry's OWN
                        // task-world - the bound world's declared domain equals the fixture's
                        // industry (never a neighbor's world, never the SE world).
                        const mismatched: string[] = [];
                        for (const scenarioRef of entry.scenarioRefs) {
                                const scenario = getTaskScenario(scenarioRef);
                                const world = scenario === undefined ? undefined : getTaskWorld(scenario.worldId);
                                if (world === undefined || world.world.domain !== candidate.industry) {
                                        mismatched.push(`${scenarioRef}->${world === undefined ? 'unknown-world' : world.world.domain}`);
                                }
                        }
                        if (mismatched.length > 0) {
                                return fixtureRejected('benchmark-industry-mismatch', 'THE INDUSTRY-MATCH LAW', `validateIndustryAcceptanceFixture: an industry-extension benchmark on the '${showValue(candidate.industry)}' fixture must bind the industry's OWN task-world (the bound world's declared domain equals the fixture's industry); the mismatched ref(s) ${showList(mismatched)} are refused - never a neighbor's world, never the SE world`, mismatched);
                        }
                } else {
                        // ---- the base-registry binding walk (the landed law, re-worded to the registry fact) ----
                        const verdict = validateBenchmarkEntry(candidate.benchmark);
                        if (!verdict.ok) {
                                return fixtureRejected('invalid-benchmark', 'THE VERBATIM-CARRY LAW (benchmark)', 'validateIndustryAcceptanceFixture: the curated benchmark fails the OWNING family\'s REAL DH-09 validator (the family\'s typed rejection table is carried in the owning family\'s own refusal)', ['benchmark']);
                        }
                        // THE SCENARIO-BINDING LAW: every scenarioRef resolves against the REAL imported base registry.
                        const benchmark = candidate.benchmark as unknown as BenchmarkEntry;
                        const dangling: string[] = [];
                        for (const scenarioRef of benchmark.scenarioRefs) {
                                if (getScenario(scenarioRef) === undefined) {
                                        dangling.push(scenarioRef);
                                }
                        }
                        if (dangling.length > 0) {
                                return fixtureRejected('unknown-scenario-ref', 'THE SCENARIO-BINDING LAW', `validateIndustryAcceptanceFixture: every base-registry benchmark scenarioRef must resolve against the REAL landed LAB task-world registry (imported through getScenario - never a transcribed list); the dangling ref(s) ${showList(dangling)} are refused`, dangling);
                        }
                        // THE REGISTRY FACT LAW: the base-registry binding is software-only (the landed base registry carries the SE fixture world, the software industry's own world).
                        if (candidate.industry !== 'software') {
                                return fixtureRejected('benchmark-industry-mismatch', 'THE REGISTRY FACT LAW', `validateIndustryAcceptanceFixture: a base-registry benchmark on the '${showValue(candidate.industry)}' fixture is refused - the REAL landed LAB task-world registry carries the SE fixture world, the software industry's own (an industry whose task-world lives in the lab industry extension registry binds through the industry-extension mode; an industry with no task-world carries the honest null)`, ['benchmark', 'industry']);
                        }
                }
        }
        // THE INTERNAL-REF LAW + the duplicate identity keys + the curated census (one typed table).
        const rolesList = candidate.roles as HarnessRole[];
        const termsList = candidate.terms as OntologyTerm[];
        const tasksList = candidate.tasks as TaskTemplateEntry[];
        const bodiesList = candidate.bodies as BodyDefaultsEntry[];
        const packsList = candidate.packs as PackEntry[];
        const profilesList = candidate.profiles as ProfileEntry[];
        const lawItems: string[] = [];
        const roleKeys = rolesList.map((role) => role.roleKey);
        const termNames = termsList.map((term) => term.term);
        const taskKeys = tasksList.map((task) => task.taskKey);
        const bodyKeys = bodiesList.map((body) => body.bodyKey);
        const packKeys = packsList.map((pack) => pack.packKey);
        const profileKeys = profilesList.map((profile) => profile.profileKey);
        for (const [label, keys] of [['roleKeys', roleKeys], ['terms', termNames], ['taskKeys', taskKeys], ['bodyKeys', bodyKeys], ['packKeys', packKeys], ['profileKeys', profileKeys]] as const) {
                const duplicates = duplicatesOf(keys);
                if (duplicates.length > 0) {
                        lawItems.push(`duplicate-key:${label}:${duplicates.join(',')}`);
                }
        }
        for (const task of tasksList) {
                for (const termRef of task.termRefs) {
                        if (!termNames.includes(termRef)) {
                                lawItems.push(`dangling-ref:tasks.${task.taskKey}->${termRef}`);
                        }
                }
        }
        for (const body of bodiesList) {
                for (const roleRef of body.roleRefs) {
                        if (!roleKeys.includes(roleRef)) {
                                lawItems.push(`dangling-ref:bodies.${body.bodyKey}->${roleRef}`);
                        }
                }
        }
        for (const pack of packsList) {
                for (const bodyRef of pack.bodyRefs) {
                        if (!bodyKeys.includes(bodyRef)) {
                                lawItems.push(`dangling-ref:packs.${pack.packKey}->${bodyRef}`);
                        }
                }
        }
        if (rolesList.length < FIXTURE_ENTRY_CENSUS.roles.min || rolesList.length > FIXTURE_ENTRY_CENSUS.roles.max) {
                lawItems.push(`fixture-count-law:roles=${rolesList.length}`);
        }
        if (termsList.length < FIXTURE_ENTRY_CENSUS.terms.min || termsList.length > FIXTURE_ENTRY_CENSUS.terms.max) {
                lawItems.push(`fixture-count-law:terms=${termsList.length}`);
        }
        if (tasksList.length < FIXTURE_ENTRY_CENSUS.tasks.min || tasksList.length > FIXTURE_ENTRY_CENSUS.tasks.max) {
                lawItems.push(`fixture-count-law:tasks=${tasksList.length}`);
        }
        if (bodiesList.length < FIXTURE_ENTRY_CENSUS.bodies.min || bodiesList.length > FIXTURE_ENTRY_CENSUS.bodies.max) {
                lawItems.push(`fixture-count-law:bodies=${bodiesList.length}`);
        }
        if (packsList.length < FIXTURE_ENTRY_CENSUS.packs.min || packsList.length > FIXTURE_ENTRY_CENSUS.packs.max) {
                lawItems.push(`fixture-count-law:packs=${packsList.length}`);
        }
        if (profilesList.length < FIXTURE_ENTRY_CENSUS.profiles.min || profilesList.length > FIXTURE_ENTRY_CENSUS.profiles.max) {
                lawItems.push(`fixture-count-law:profiles=${profilesList.length}`);
        }
        if (profilesList.flatMap((profile) => [...profile.kpiDimensions]).length === 0) {
                lawItems.push('fixture-count-law:kpiDimensions-union-empty');
        }
        if (lawItems.length > 0) {
                const first = lawItems[0].split(':')[0];
                const reason: FixtureRejectionReason = first === 'duplicate-key' ? 'duplicate-key' : first === 'dangling-ref' ? 'dangling-ref' : 'fixture-count-law';
                const law = reason === 'dangling-ref' ? 'THE INTERNAL-REF LAW' : reason === 'duplicate-key' ? 'THE UNIQUE-KEY LAW' : 'THE CURATED CENSUS LAW';
                return fixtureRejected(reason, law, `validateIndustryAcceptanceFixture: the curated-fixture law table is violated - ${showList(lawItems)} (the internal refs resolve within the fixture; the identity keys are unique; the curated census is exact)`, lawItems);
        }
        // THE GAP LAWS: the rows are frozen ledger rows, carried verbatim; THE CLOSED-ROW LAW and
        // THE COVERAGE LAW are fail-closed (the DH-GAP-2 wave's updated truth).
        const gapItems: string[] = [];
        const seenKeys: string[] = [];
        for (const row of candidate.expectedGaps as unknown[]) {
                if (!isRecord(row)) {
                        gapItems.push('malformed-gap-row');
                        continue;
                }
                const gapRow = row as Record<string, unknown>;
                if (!isAcceptanceGapKey(gapRow.gapKey)) {
                        gapItems.push(`unknown-gap-key:${showValue(gapRow.gapKey)}`);
                        continue;
                }
                if (seenKeys.includes(gapRow.gapKey as string)) {
                        gapItems.push(`duplicate-gap-key:${gapRow.gapKey}`);
                }
                seenKeys.push(gapRow.gapKey as string);
                if (isAcceptanceClosedGapKey(gapRow.gapKey)) {
                        gapItems.push(`closed-gap-key:${gapRow.gapKey}`);
                }
                const ledgerRow = ledgerRowOf(gapRow.gapKey);
                if (ledgerRow === undefined || gapRow.description !== ledgerRow.description || gapRow.evidenceLevel !== ledgerRow.evidenceLevel || gapRow.owner !== ledgerRow.owner) {
                        gapItems.push(`drifted-gap-row:${showValue(gapRow.gapKey)}`);
                }
        }
        const carriesBenchmark = candidate.benchmark !== null;
        if (gapItems.length > 0) {
                return fixtureRejected('gap-registration-inconsistent', 'THE CLOSED-ROW LAW (THE REGISTERED-VERBATIM LAW)', `validateIndustryAcceptanceFixture: every expectedGaps row must be its OPEN frozen ledger row carried VERBATIM (a closed row's closure is recorded IN the ledger row and is never registered as an open gap; the unknown/duplicate/closed/drifted row(s) ${showList(gapItems)} are refused)`, gapItems);
        }
        // THE COVERAGE LAW (the updated fail-closed truth): a fixture whose industry carries a
        // task-world (software through the landed base registry - the registry fact; an industry
        // whose world lives in the lab industry extension registry - the domain match over the
        // extension registry's own descriptors) MUST carry the curated benchmark - the coverage
        // row is CLOSED, there is no honest registration for an un-exercised evaluable benchmark
        // leg. A fixture whose industry carries NO task-world carries the honest null (the
        // gap-registered benchmark status; the journey composes the registry-bound floor).
        if (!carriesBenchmark && industryCarriesTaskWorld(candidate.industry)) {
                return fixtureRejected('gap-registration-missing', 'THE COVERAGE LAW (THE CLOSED-ROW LAW)', `validateIndustryAcceptanceFixture: a fixture for the covered industry '${showValue(candidate.industry)}' carries NO curated benchmark - the industry's task-world EXISTS (the combined catalog), the coverage row is CLOSED and cannot be registered as an open gap; carry the curated benchmark binding (never a silently skipped evaluable benchmark leg)`, ['benchmark', 'expectedGaps']);
        }
        return {
                ok: true,
                fixture: {
                        industry: candidate.industry,
                        companyProfile: company.value,
                        workTypes: [...workTypes.value],
                        roles: [...rolesList],
                        terms: [...termsList],
                        tasks: [...tasksList],
                        bodies: [...bodiesList],
                        packs: [...packsList],
                        profiles: [...profilesList],
                        benchmark: canonicalBenchmarkOf(candidate.benchmark),
                        expectedGaps: [...(candidate.expectedGaps as AcceptanceGapRow[])],
                },
        };
}

// --- the per-industry verdict row ---------------------------------------------------------------------

/** The frozen leg-verdict vocabulary: 'complete' (the leg's law held and its evidence is green) or 'refused' (the typed refusal). */
export const ACCEPTANCE_LEG_VERDICTS = ['complete', 'refused'] as const;
export type AcceptanceLegVerdict = (typeof ACCEPTANCE_LEG_VERDICTS)[number];

/** The frozen benchmark-status vocabulary: the DH-09 evaluation leg ran ('evaluated') or the honest gap row is registered ('gap-registered'). */
export const ACCEPTANCE_BENCHMARK_STATUSES = ['evaluated', 'gap-registered'] as const;
export type AcceptanceBenchmarkStatus = (typeof ACCEPTANCE_BENCHMARK_STATUSES)[number];

/** The frozen UI-section verdict vocabulary: the derived navigation section is populated or honestly not-composed. */
export const ACCEPTANCE_UI_SECTION_VERDICTS = ['populated', 'not-composed'] as const;
export type AcceptanceUiSectionVerdict = (typeof ACCEPTANCE_UI_SECTION_VERDICTS)[number];

/**
 * THE JOURNEY LEG: the DH-11 run's verdict - complete/refused, the
 * journey record's end stage, the FINAL harness link and the REAL
 * DH-01 lifecycle end-state re-read at the authority (THE
 * EVIDENCE-NOT-AUTHORITY LAW: the authority's own state wins), plus
 * the binding composition root (the draft harness id the composed
 * family records bind - THE LINEAGE LAW).
 */
export interface JourneyLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly journeyId: string;
        readonly journeyStage: ActivationJourneyStage;
        readonly harnessId: string;
        readonly bindingHarnessId: string;
        readonly harnessLifecycleEndState: HarnessLifecycleState;
        readonly approvalRecorded: boolean;
        readonly activationRecorded: boolean;
}

/** The frozen journey-leg schema keys, in the canonical fixed-key-order. */
export const JOURNEY_LEG_SCHEMA_KEYS = [
        'verdict',
        'journeyId',
        'journeyStage',
        'harnessId',
        'bindingHarnessId',
        'harnessLifecycleEndState',
        'approvalRecorded',
        'activationRecorded',
] as const;

/**
 * THE ROLE-COMPOSITION LEG: the multi-role composition proven - the
 * composed role keys (the journey record's own DH-03 session
 * evidence), the role count and the session link.
 */
export interface RoleCompositionLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly roleKeys: readonly string[];
        readonly rolesSessionId: string;
}

/** The frozen role-composition-leg schema keys, in the canonical fixed-key-order. */
export const ROLE_COMPOSITION_LEG_SCHEMA_KEYS = ['verdict', 'roleKeys', 'rolesSessionId'] as const;

/**
 * THE WORKFLOWS LEG: the templates composed + term-resolved - the
 * composed task keys, their term refs and the term-resolution proof
 * (the REAL DH-05 finalize boundary resolved every termRef against
 * the composed ontology record - the journey completing is the
 * proof).
 */
export interface WorkflowsLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly taskKeys: readonly string[];
        readonly termRefs: readonly string[];
        readonly termResolution: 'resolved';
}

/** The frozen workflows-leg schema keys, in the canonical fixed-key-order. */
export const WORKFLOWS_LEG_SCHEMA_KEYS = ['verdict', 'taskKeys', 'termRefs', 'termResolution'] as const;

/**
 * THE POLICIES LEG: the profiles' permission and approval legs - the
 * composed permission refs (REAL catalog members) and the approval
 * tiers (REAL risk tiers), per profile key.
 */
export interface PoliciesLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly profileKeys: readonly string[];
        readonly permissionRefs: readonly string[];
        readonly approvalTiers: readonly string[];
}

/** The frozen policies-leg schema keys, in the canonical fixed-key-order. */
export const POLICIES_LEG_SCHEMA_KEYS = ['verdict', 'profileKeys', 'permissionRefs', 'approvalTiers'] as const;

/**
 * THE EVIDENCE LEG: the profiles' evidence-floor legs - the composed
 * evidence floors (REAL ladder rungs), per profile key.
 */
export interface EvidenceLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly evidenceFloors: readonly string[];
}

/** The frozen evidence-leg schema keys, in the canonical fixed-key-order. */
export const EVIDENCE_LEG_SCHEMA_KEYS = ['verdict', 'evidenceFloors'] as const;

/**
 * THE APPROVALS LEG: the approval decisions recorded PRE-activation -
 * the user's approval and activation decisions as the journey record
 * mirrors them (the evidence mirror; the REAL DH-01 kit's own
 * decision records remain the authority).
 */
export interface ApprovalsLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly approvedBy: string;
        readonly activatedBy: string;
        readonly recordedBeforeActivation: true;
}

/** The frozen approvals-leg schema keys, in the canonical fixed-key-order. */
export const APPROVALS_LEG_SCHEMA_KEYS = ['verdict', 'approvedBy', 'activatedBy', 'recordedBeforeActivation'] as const;

/** One derived navigation section state (the DH-10 projection's own row, summarized). */
export interface UiSectionStateRow {
        readonly section: DomainNavigationSectionId;
        readonly state: AcceptanceUiSectionVerdict;
        readonly rowCount: number;
}

/** The frozen UI-section-row schema keys, in the canonical fixed-key-order. */
export const UI_SECTION_ROW_SCHEMA_KEYS = ['section', 'state', 'rowCount'] as const;

/**
 * THE UI-BEHAVIOR LEG: the DH-10 navigation model derived per
 * industry - populated/not-composed per section (THE SECTION-STATE
 * LAW: the honest two-state projection, never fabricated rows), the
 * anchor disclosure (THE LINEAGE LAW: the model anchors on the
 * binding composition root - the harness record the composed family
 * records bind).
 */
export interface UiBehaviorLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly anchorHarnessId: string;
        readonly sections: readonly UiSectionStateRow[];
        readonly populatedSections: number;
        readonly notComposedSections: number;
}

/** The frozen ui-behavior-leg schema keys, in the canonical fixed-key-order. */
export const UI_BEHAVIOR_LEG_SCHEMA_KEYS = ['verdict', 'anchorHarnessId', 'sections', 'populatedSections', 'notComposedSections'] as const;

/**
 * THE CAPABILITY-GAPS LEG: the ledger - the industry's expectedGaps
 * rows registered VERBATIM (the count and the keys; the rows ride the
 * industry row's expectedGaps field).
 */
export interface CapabilityGapsLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly registeredGapKeys: readonly AcceptanceGapKey[];
}

/** The frozen capability-gaps-leg schema keys, in the canonical fixed-key-order. */
export const CAPABILITY_GAPS_LEG_SCHEMA_KEYS = ['verdict', 'registeredGapKeys'] as const;

/**
 * THE TASK-EXECUTION LEG: the execution routing through the EXISTING
 * authorities - the DH-01 lifecycle authority pin (the harness record
 * at 'active' through the real transitions, re-read at the
 * authority's own ledger), the LAB closedLoop fixture execution
 * (present only when the fixture carries a benchmark - the SE leg),
 * the benchmark evaluation evidence and the honest execution
 * disclosure (fixture-level: the closedLoop executor is the
 * deterministic fixture port, honestly labeled; never Agent OS, never
 * a live provider).
 */
export interface TaskExecutionLegVerdict {
        readonly verdict: AcceptanceLegVerdict;
        readonly authorityState: HarnessLifecycleState;
        readonly authorityTransitionsWalked: readonly HarnessLifecycleState[];
        readonly closedLoopExecutions: number | null;
        readonly closedLoopLoopClosed: boolean | null;
        readonly benchmarkScores: readonly { readonly dimension: string; readonly value: number }[] | null;
        readonly benchmarkEvidenceLevel: string | null;
        readonly executionDisclosure: string;
}

/** The frozen task-execution-leg schema keys, in the canonical fixed-key-order. */
export const TASK_EXECUTION_LEG_SCHEMA_KEYS = [
        'verdict',
        'authorityState',
        'authorityTransitionsWalked',
        'closedLoopExecutions',
        'closedLoopLoopClosed',
        'benchmarkScores',
        'benchmarkEvidenceLevel',
        'executionDisclosure',
] as const;

/**
 * THE PER-INDUSTRY VERDICT ROW: one leg per assessed dimension (the
 * registry row's own assessment list), the benchmark status, the
 * composed-record version census input (THE COMPOSITION-NOT-FORK
 * census) and the fixture's expectedGaps carried VERBATIM.
 */
export interface IndustryAcceptanceVerdict {
        readonly industry: HarnessIndustry;
        readonly contractVersion: string;
        readonly journey: JourneyLegVerdict;
        readonly roleComposition: RoleCompositionLegVerdict;
        readonly workflows: WorkflowsLegVerdict;
        readonly policies: PoliciesLegVerdict;
        readonly evidence: EvidenceLegVerdict;
        readonly approvals: ApprovalsLegVerdict;
        readonly uiBehavior: UiBehaviorLegVerdict;
        readonly capabilityGaps: CapabilityGapsLegVerdict;
        readonly taskExecution: TaskExecutionLegVerdict;
        readonly benchmarkStatus: AcceptanceBenchmarkStatus;
        readonly composedRecordVersions: Readonly<Record<string, string>>;
        readonly expectedGaps: readonly AcceptanceGapRow[];
}

/** The frozen industry-verdict schema keys, in the canonical fixed-key-order (the serialization order AND the assessment order). */
export const INDUSTRY_VERDICT_SCHEMA_KEYS = [
        'industry',
        'contractVersion',
        'journey',
        'roleComposition',
        'workflows',
        'policies',
        'evidence',
        'approvals',
        'uiBehavior',
        'capabilityGaps',
        'taskExecution',
        'benchmarkStatus',
        'composedRecordVersions',
        'expectedGaps',
] as const;

// --- the composition-not-fork census ---------------------------------------------------------------------

/**
 * THE COMPOSITION-NOT-FORK census's frozen family keys: the twelve
 * prior families in their frozen registry order (DH-001..DH-012).
 * Each industry's composed records carry every family's contract
 * version; the census pins them IDENTICAL across all industries.
 */
export const COMPOSITION_VERSION_FAMILY_KEYS = [
        'domain-harness',
        'onboarding',
        'roles',
        'ontology',
        'templates',
        'bodies',
        'packs',
        'profiles',
        'benchmarks',
        'projections',
        'activation',
        'optimization',
] as const;
export type CompositionVersionFamilyKey = (typeof COMPOSITION_VERSION_FAMILY_KEYS)[number];

/** One census row: the family, the version carried by every industry's composed records, and the identity pin. */
export interface CompositionCensusRow {
        readonly family: CompositionVersionFamilyKey;
        readonly contractVersion: string;
        readonly identicalAcrossIndustries: boolean;
}

/** The frozen census-row schema keys, in the canonical fixed-key-order. */
export const COMPOSITION_CENSUS_ROW_SCHEMA_KEYS = ['family', 'contractVersion', 'identicalAcrossIndustries'] as const;

/**
 * THE COMPOSITION-NOT-FORK census: the twelve contract versions
 * carried identically across ALL industries' composed records, the
 * REAL LAB_CONTRACTS_VERSION, the module-identity pin (the runner
 * constructs ONE set of real kit constructions - the activation
 * journey kit, the projections kit, the optimization loop kit - with
 * the SAME injected seams, shared by ALL industries), the industries
 * served and the fixtures-are-pure-data pin (the industry content
 * modules export ONLY frozen data - pinned by source inspection in
 * the battery).
 */
export interface HarnessCompositionCensus {
        readonly labContractsVersion: string;
        readonly rows: readonly CompositionCensusRow[];
        readonly industriesServed: readonly HarnessIndustry[];
        readonly sharedKitConstructions: readonly string[];
        readonly fixturesArePureData: true;
}

/** The frozen census schema keys, in the canonical fixed-key-order. */
export const COMPOSITION_CENSUS_SCHEMA_KEYS = ['labContractsVersion', 'rows', 'industriesServed', 'sharedKitConstructions', 'fixturesArePureData'] as const;

// --- the overall verdict + the report --------------------------------------------------------------------

/**
 * THE OVERALL VERDICT (fail-closed): complete ONLY when every
 * industry's journey leg is complete AND every gap is registered. Any
 * refused leg or missing registration is the typed refusal carried in
 * this row (never a silent pass); the refusal names the law and the
 * offending industries.
 */
export interface OverallVerdictRow {
        readonly verdict: AcceptanceLegVerdict;
        readonly industriesComplete: number;
        readonly industriesRefused: number;
        readonly gapRowsRegistered: number;
        readonly refusalReason: string | null;
        readonly refusalLaw: string | null;
        readonly refusalMessage: string | null;
}

/** The frozen overall-verdict schema keys, in the canonical fixed-key-order. */
export const OVERALL_VERDICT_SCHEMA_KEYS = ['verdict', 'industriesComplete', 'industriesRefused', 'gapRowsRegistered', 'refusalReason', 'refusalLaw', 'refusalMessage'] as const;

/**
 * The frozen disclosure strings (the instrument's own laws, carried in
 * every report so a green verdict can never be over-read). The
 * DH-GAP-2 wave re-worded the evidence disclosure (the benchmark
 * legs' two binding lanes) and ADDED the content-census disclosure
 * (the declared censused representativeness bar and its bound) - both
 * re-pins disclosed in the wave's D-register.
 */
export const ACCEPTANCE_CONTENT_DISCLOSURE =
        'the four industry content sets are curated fixture-level acceptance content - representative, deliberately modest, honestly labeled; not a claim of comprehensive domain truth, not promoted evidence';
export const ACCEPTANCE_EVIDENCE_DISCLOSURE =
        'the task execution evidence is the LAB closedLoop fixture execution over the real deterministic instances (the landed closed-loop engine drives the base-registry SE scenario for every benchmark leg, honestly labeled) plus the real authority routing (the DH-01 lifecycle; the benchmark legs evaluated through the REAL DH-09 surfaces for the base-registry binding and through the acceptance family\'s combined-catalog composition over the REAL imported lab extension registry lookups for the industry-extension bindings), honestly labeled at the fixture/simulated ceiling - never a live-provider exchange, never a production deployment';
export const ACCEPTANCE_COMPOSITION_DISCLOSURE =
        'the industries differ only in data: one set of real kit constructions serves all four (the composition-not-fork census pins the twelve contract versions identical across every industry\'s composed records; a fifth industry is a new fixture module, never a code path)';
export const ACCEPTANCE_FAIL_CLOSED_DISCLOSURE =
        'the overall verdict is fail-closed: any refused leg or any missing gap registration is the typed refusal, never a silent pass';
export const ACCEPTANCE_CONTENT_CENSUS_DISCLOSURE =
        'the four industry content sets meet the declared censused representativeness bar: each industry carries at least six roles, ten terms, four tasks, four bodies, four packs and two profiles of real domain-shaped curated content (the census pinned by the battery); the bound is disclosed here - curated fixture-level acceptance content over the REAL family shapes, never a claim of comprehensive domain truth';

/** The frozen report disclosure list (in the canonical order). */
export const ACCEPTANCE_DISCLOSURES: readonly string[] = Object.freeze([
        ACCEPTANCE_CONTENT_DISCLOSURE,
        ACCEPTANCE_EVIDENCE_DISCLOSURE,
        ACCEPTANCE_COMPOSITION_DISCLOSURE,
        ACCEPTANCE_FAIL_CLOSED_DISCLOSURE,
        ACCEPTANCE_CONTENT_CENSUS_DISCLOSURE,
]);

/**
 * THE ACCEPTANCE REPORT (the CR-013 pattern's report-builder shape):
 * the family version, the per-industry verdict rows (in the frozen
 * lane order), the composition census, the honest gap ledger (the six
 * frozen rows VERBATIM), the overall verdict and the disclosures.
 */
export interface HarnessAcceptanceReport {
        readonly version: string;
        readonly industries: readonly IndustryAcceptanceVerdict[];
        readonly compositionCensus: HarnessCompositionCensus;
        readonly gapLedger: readonly AcceptanceGapRow[];
        readonly overallVerdict: OverallVerdictRow;
        readonly disclosures: readonly string[];
}

/** The frozen report schema keys, in the canonical fixed-key-order (the serialization order). */
export const HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS = ['version', 'industries', 'compositionCensus', 'gapLedger', 'overallVerdict', 'disclosures'] as const;

// --- the report walk + the canonical serialization + the fail-closed parse --------------------------------

/**
 * Closed frozen list of report parse rejection reasons:
 *   malformed-json    - the bytes are not JSON at all;
 *   version-mismatch  - THE SINGLE-VERSION LAW: the report version is
 *                       not HARNESS_ACCEPTANCE_VERSION;
 *   unknown-key       - a key outside the frozen report schema;
 *   missing-key       - a required report key is absent;
 *   invalid-row       - a report row fails the structural walk (the
 *                       industries / census / gap ledger / verdict
 *                       legs).
 */
export const ACCEPTANCE_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'version-mismatch',
        'unknown-key',
        'missing-key',
        'invalid-row',
] as const;
export type AcceptanceParseRejectionReason = (typeof ACCEPTANCE_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isAcceptanceParseRejectionReason(value: unknown): value is AcceptanceParseRejectionReason {
        return (ACCEPTANCE_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the deterministic message. */
export interface AcceptanceParseRejection {
        readonly reason: AcceptanceParseRejectionReason;
        readonly message: string;
}

/** The typed parse outcome: ok carries the canonical report; refusal carries the typed rejection. */
export type AcceptanceParseOutcome =
        | { readonly ok: true; readonly report: HarnessAcceptanceReport }
        | { readonly ok: false; readonly rejection: AcceptanceParseRejection };

/**
 * The deep report walk (pure): the structural stations of every row
 * (the industries in the frozen lane order with every leg's shape and
 * vocabulary, the census with the twelve frozen family keys, the gap
 * ledger VERBATIM against the frozen six, the overall verdict's
 * fail-closed coherence, the frozen disclosures) plus THE
 * SINGLE-VERSION LAW. Ok carries the canonical fixed-key-order copy.
 */
export function validateHarnessAcceptanceReport(value: unknown): AcceptanceParseOutcome {
        if (!isRecord(value)) {
                return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: the report must be a plain object');
        }
        const candidate = value as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return parseRejected('unknown-key', `validateHarnessAcceptanceReport: the report schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`);
        }
        const missingKeys = (HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return parseRejected('missing-key', `validateHarnessAcceptanceReport: the report schema requires every key - the key(s) ${showList(missingKeys)} are missing`);
        }
        if (candidate.version !== HARNESS_ACCEPTANCE_VERSION) {
                return parseRejected('version-mismatch', `validateHarnessAcceptanceReport: the report carries version '${showValue(candidate.version)}' - only '${HARNESS_ACCEPTANCE_VERSION}' is known (the single-version law)`);
        }
        if (!Array.isArray(candidate.industries) || !isRecord(candidate.compositionCensus) || !Array.isArray(candidate.gapLedger) || !isRecord(candidate.overallVerdict) || !Array.isArray(candidate.disclosures)) {
                return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: the industries / gapLedger / disclosures carriers must be arrays and the compositionCensus / overallVerdict must be plain objects');
        }
        const industries = candidate.industries as unknown[];
        if (industries.length !== ACCEPTANCE_INDUSTRIES.length) {
                return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the report carries exactly the four frozen industries in the frozen lane order (carried ${industries.length})`);
        }
        for (let i = 0; i < industries.length; i += 1) {
                const rowOutcome = validateIndustryVerdictRow(industries[i]);
                if (!rowOutcome.ok) {
                        return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the industry row ${i} fails the structural walk: ${rowOutcome.message}`);
                }
                if (rowOutcome.industry !== ACCEPTANCE_INDUSTRIES[i]) {
                        return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the industry row ${i} must be '${ACCEPTANCE_INDUSTRIES[i]}' (the frozen lane order) - carried '${rowOutcome.industry}'`);
                }
        }
        const census = candidate.compositionCensus as Record<string, unknown>;
        if (census.labContractsVersion !== LAB_CONTRACTS_VERSION || !Array.isArray(census.rows) || !Array.isArray(census.industriesServed) || !Array.isArray(census.sharedKitConstructions) || census.fixturesArePureData !== true) {
                return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: the composition census fails the structural walk (the REAL lab version, the twelve rows, the industries served, the shared constructions, the pure-data pin)');
        }
        if ((census.rows as unknown[]).length !== COMPOSITION_VERSION_FAMILY_KEYS.length) {
                return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the census carries exactly the twelve frozen family rows (carried ${(census.rows as unknown[]).length})`);
        }
        for (const row of census.rows as unknown[]) {
                if (!isRecord(row) || !(COMPOSITION_VERSION_FAMILY_KEYS as readonly string[]).includes((row as Record<string, unknown>).family as string) || typeof (row as Record<string, unknown>).contractVersion !== 'string' || (row as Record<string, unknown>).identicalAcrossIndustries !== true) {
                        return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: every census row is { family, contractVersion, identicalAcrossIndustries: true } over the frozen family keys');
                }
        }
        const ledger = candidate.gapLedger as unknown[];
        if (ledger.length !== HARNESS_ACCEPTANCE_GAP_LEDGER.length) {
                return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the gap ledger carries exactly the six frozen rows VERBATIM (carried ${ledger.length})`);
        }
        for (let i = 0; i < ledger.length; i += 1) {
                const ledgerRow = ledger[i] as Record<string, unknown>;
                const frozen = HARNESS_ACCEPTANCE_GAP_LEDGER[i];
                if (ledgerRow.gapKey !== frozen.gapKey || ledgerRow.description !== frozen.description || ledgerRow.evidenceLevel !== frozen.evidenceLevel || ledgerRow.owner !== frozen.owner) {
                        return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the gap ledger row ${i} ('${frozen.gapKey}') must be carried VERBATIM from the frozen ledger`);
                }
        }
        const verdict = candidate.overallVerdict as Record<string, unknown>;
        if (!(ACCEPTANCE_LEG_VERDICTS as readonly string[]).includes(verdict.verdict as string) || typeof verdict.industriesComplete !== 'number' || typeof verdict.industriesRefused !== 'number' || typeof verdict.gapRowsRegistered !== 'number') {
                return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: the overall verdict row fails the structural walk');
        }
        if (verdict.verdict === 'complete' && (verdict.industriesComplete !== ACCEPTANCE_INDUSTRIES.length || verdict.industriesRefused !== 0 || verdict.gapRowsRegistered !== HARNESS_ACCEPTANCE_GAP_LEDGER.length)) {
                return parseRejected('invalid-row', 'validateHarnessAcceptanceReport: a COMPLETE overall verdict requires every industry complete, zero refused and all six ledger rows registered (the fail-closed coherence law)');
        }
        const disclosures = candidate.disclosures as unknown[];
        for (let i = 0; i < ACCEPTANCE_DISCLOSURES.length; i += 1) {
                if (disclosures[i] !== ACCEPTANCE_DISCLOSURES[i]) {
                        return parseRejected('invalid-row', `validateHarnessAcceptanceReport: the disclosure ${i} must be carried VERBATIM from the frozen disclosure list`);
                }
        }
        const rows = industries.map((row) => (row as IndustryAcceptanceVerdict));
        return {
                ok: true,
                report: {
                        version: HARNESS_ACCEPTANCE_VERSION,
                        industries: rows,
                        compositionCensus: census as unknown as HarnessCompositionCensus,
                        gapLedger: [...(candidate.gapLedger as AcceptanceGapRow[])],
                        overallVerdict: verdict as unknown as OverallVerdictRow,
                        disclosures: [...(candidate.disclosures as string[])],
                },
        };
}

/**
 * The canonical fixed-key-order serialization (THE CANONICAL
 * SERIALIZATION LAW): the report is serialized with every object's
 * keys in its declared schema order; the same report always
 * serializes to the same bytes (restart-deterministic).
 */
export function serializeAcceptanceReport(report: unknown): string {
        return `${JSON.stringify(report)}\n`;
}

/**
 * The fail-closed parse: malformed JSON, a foreign version, an
 * unknown/missing key or an invalid row is the typed rejection -
 * never a silent partial report.
 */
export function parseAcceptanceReport(bytes: unknown): AcceptanceParseOutcome {
        if (typeof bytes !== 'string' || bytes.length === 0) {
                return parseRejected('malformed-json', 'parseAcceptanceReport: the bytes must be a non-empty string');
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(bytes);
        } catch {
                return parseRejected('malformed-json', 'parseAcceptanceReport: the bytes are not JSON');
        }
        return validateHarnessAcceptanceReport(parsed);
}

// --- internals (the family pattern's small pure helpers) ---------------------------------------------------

/**
 * The industry verdict row's structural walk (pure; the runner's
 * own row discipline and the ledger replay's line walk both route
 * through it): the frozen fourteen-key schema, the REAL industry
 * member, THE SINGLE-VERSION LAW, every leg's shape and frozen
 * verdict, the frozen benchmark status, the twelve-key census map
 * and THE CLOSED-ROW LAW re-proven from the row alone (an
 * expectedGaps row can never be a CLOSED ledger row - the closures
 * are recorded IN the ledger rows, never registered as open gaps).
 */
export function validateIndustryVerdictRow(row: unknown): { readonly ok: true; readonly industry: HarnessIndustry } | { readonly ok: false; readonly message: string } {
        if (!isRecord(row)) {
                return { ok: false, message: 'the row must be a plain object' };
        }
        const candidate = row as Record<string, unknown>;
        const unknownKeys = Object.keys(candidate).filter((key) => !(INDUSTRY_VERDICT_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return { ok: false, message: `the unknown key(s) ${showList(unknownKeys)} are rejected` };
        }
        const missingKeys = (INDUSTRY_VERDICT_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return { ok: false, message: `the key(s) ${showList(missingKeys)} are missing` };
        }
        if (!isHarnessIndustry(candidate.industry)) {
                return { ok: false, message: `the industry '${showValue(candidate.industry)}' is not a REAL vocabulary member` };
        }
        if (candidate.contractVersion !== HARNESS_ACCEPTANCE_VERSION) {
                return { ok: false, message: `the row version '${showValue(candidate.contractVersion)}' is not '${HARNESS_ACCEPTANCE_VERSION}'` };
        }
        for (const legKey of ['journey', 'roleComposition', 'workflows', 'policies', 'evidence', 'approvals', 'uiBehavior', 'capabilityGaps', 'taskExecution'] as const) {
                if (!isRecord(candidate[legKey])) {
                        return { ok: false, message: `the '${legKey}' leg must be a plain object` };
                }
                const leg = candidate[legKey] as Record<string, unknown>;
                if (!(ACCEPTANCE_LEG_VERDICTS as readonly string[]).includes(leg.verdict as string)) {
                        return { ok: false, message: `the '${legKey}' leg verdict '${showValue(leg.verdict)}' is not a frozen leg verdict` };
                }
        }
        if (!(ACCEPTANCE_BENCHMARK_STATUSES as readonly string[]).includes(candidate.benchmarkStatus as string)) {
                return { ok: false, message: `the benchmarkStatus '${showValue(candidate.benchmarkStatus)}' is not a frozen benchmark status` };
        }
        if (!isRecord(candidate.composedRecordVersions)) {
                return { ok: false, message: 'the composedRecordVersions must be a plain record' };
        }
        const versionKeys = Object.keys(candidate.composedRecordVersions).sort();
        const expectedVersionKeys = [...COMPOSITION_VERSION_FAMILY_KEYS].sort();
        if (versionKeys.length !== expectedVersionKeys.length || versionKeys.some((key, index) => key !== expectedVersionKeys[index])) {
                return { ok: false, message: 'the composedRecordVersions must carry exactly the twelve frozen family keys' };
        }
        for (const value of Object.values(candidate.composedRecordVersions)) {
                if (typeof value !== 'string' || value.length === 0) {
                        return { ok: false, message: 'every composedRecordVersions value must be a non-empty string' };
                }
        }
        if (!Array.isArray(candidate.expectedGaps)) {
                return { ok: false, message: 'the expectedGaps must be an array' };
        }
        // THE CLOSED-ROW LAW re-proven from the row alone: an expectedGaps row can never be a
        // CLOSED ledger row (its closure is recorded IN the ledger row - the DH-GAP-2 wave's
        // updated truth; the gap-registered benchmark status is the honest uncovered-industry
        // state and registers only OPEN rows).
        const gapKeys = (candidate.expectedGaps as Record<string, unknown>[]).map((gapRow) => gapRow.gapKey);
        for (const gapKey of gapKeys) {
                if (isAcceptanceClosedGapKey(gapKey)) {
                        return { ok: false, message: `the expectedGaps row '${gapKey}' is a CLOSED ledger row (its closure is recorded IN the ledger row and can never be registered as an open gap)` };
                }
        }
        return { ok: true, industry: candidate.industry };
}

/**
 * THE COVERAGE LAW's registry facts (pure): whether the industry
 * carries a task-world - software through the landed base registry
 * (THE REGISTRY FACT LAW: the base registry carries the SE fixture
 * world, the software industry's own), any other industry through the
 * lab industry extension registry's own descriptors (the declared
 * domain equals the industry). Imported by reference, never
 * transcribed.
 */
function industryCarriesTaskWorld(industry: unknown): boolean {
        if (industry === 'software') {
                return true;
        }
        return listIndustryWorlds().some((world) => world.world.domain === industry);
}

/**
 * The benchmark slot's canonical fixed-key-order copy: the honest null, the
 * wrapped industry-extension binding (bindingMode first - the frozen two-key
 * order), or the shallow-copied plain base-registry entry.
 */
function canonicalBenchmarkOf(benchmark: unknown): BenchmarkEntry | IndustryBenchmarkBinding | null {
        if (benchmark === null) {
                return null;
        }
        if (benchmarkBindingModeOf(benchmark) === 'industry-extension-registry') {
                const binding = benchmark as Record<string, unknown>;
                return { bindingMode: 'industry-extension-registry', entry: { ...(binding.entry as unknown as BenchmarkEntry) } };
        }
        return { ...(benchmark as unknown as BenchmarkEntry) };
}

function ledgerRowOf(gapKey: unknown): AcceptanceGapRow | undefined {
        return HARNESS_ACCEPTANCE_GAP_LEDGER.find((row) => row.gapKey === gapKey);
}

function duplicatesOf(values: readonly string[]): string[] {
        const seen: string[] = [];
        const duplicates: string[] = [];
        for (const value of values) {
                if (seen.includes(value)) {
                        if (!duplicates.includes(value)) {
                                duplicates.push(value);
                        }
                } else {
                        seen.push(value);
                }
        }
        return duplicates;
}

function fixtureRejected(reason: FixtureRejectionReason, law: string, message: string, items?: readonly string[]): { readonly ok: false; readonly rejection: FixtureRejection } {
        return { ok: false, rejection: { reason, law, message, ...(items === undefined ? {} : { items }) } };
}

function parseRejected(reason: AcceptanceParseRejectionReason, message: string): { readonly ok: false; readonly rejection: AcceptanceParseRejection } {
        return { ok: false, rejection: { reason, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
        return Object.prototype.hasOwnProperty.call(record, key);
}

function showList(items: readonly string[]): string {
        return `[${items.join(', ')}]`;
}

function showValue(value: unknown): string {
        if (typeof value === 'string') {
                return value;
        }
        if (value === undefined) {
                return 'undefined';
        }
        if (value === null) {
                return 'null';
        }
        return JSON.stringify(value) ?? 'unknown';
}
