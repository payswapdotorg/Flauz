/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see LICENSE in the repository root for
 * additional information.
 *
 * DH-013 acceptance contract battery (re-pinned by the DH-GAP-2 wave:
 * the closed-row ledger update, the benchmark binding modes, the
 * doubled curated census; re-pinned again by the DH-GAP-3 wave: row 3
 * closed by the INF-009 canary's station-verified live-real run;
 * re-pinned again by the DH-GAP-5 wave: row 5 closed by the binding
 * drill's station-verified bun-lane run): the
 * version cross-pins (this family + the TWELVE prior family versions +
 * the REAL LAB_CONTRACTS_VERSION, all imported by reference and pinned
 * equal), the frozen acceptance lane and the honest gap ledger (the
 * six rows verbatim - rows 1, 2, 3 and 5 CLOSED, their closures
 * recorded IN the rows; THE CLOSED-ROW LAW's closed-key list), the
 * curated-fixture
 * walk (THE STRICT-SCHEMA LAW, the REAL vocabulary stations, the OWNING
 * families' REAL entry validators, THE INTERNAL-REF LAW, THE CURATED
 * CENSUS LAW at the declared censused bar, THE BINDING-MODE LAW (the
 * base-registry walk, the industry-extension walk with THE TWO-PHASE
 * BINDING LAW + the combined-catalog scenario binding + THE
 * INDUSTRY-MATCH LAW), THE COVERAGE LAW and THE CLOSED-ROW LAW -
 * every fail-closed station typed), the report walk + the canonical
 * serialization + the fail-closed parse, and the in-suite determinism
 * greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
        HARNESS_ACCEPTANCE_VERSION,
        ACCEPTANCE_INDUSTRIES,
        isAcceptanceIndustry,
        ACCEPTANCE_GAP_KEYS,
        isAcceptanceGapKey,
        ACCEPTANCE_CLOSED_GAP_KEYS,
        isAcceptanceClosedGapKey,
        HARNESS_ACCEPTANCE_GAP_LEDGER,
        INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS,
        validateIndustryAcceptanceFixture,
        FIXTURE_REJECTION_REASONS,
        isFixtureRejectionReason,
        FIXTURE_ENTRY_CENSUS,
        ACCEPTANCE_BENCHMARK_BINDING_MODES,
        isAcceptanceBenchmarkBindingMode,
        INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS,
        benchmarkBindingModeOf,
        benchmarkBindingOf,
        ACCEPTANCE_LEG_VERDICTS,
        ACCEPTANCE_BENCHMARK_STATUSES,
        ACCEPTANCE_UI_SECTION_VERDICTS,
        INDUSTRY_VERDICT_SCHEMA_KEYS,
        COMPOSITION_VERSION_FAMILY_KEYS,
        COMPOSITION_CENSUS_SCHEMA_KEYS,
        OVERALL_VERDICT_SCHEMA_KEYS,
        ACCEPTANCE_DISCLOSURES,
        ACCEPTANCE_CONTENT_CENSUS_DISCLOSURE,
        HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS,
        validateHarnessAcceptanceReport,
        serializeAcceptanceReport,
        parseAcceptanceReport,
        validateIndustryVerdictRow,
        ACCEPTANCE_PARSE_REJECTION_REASONS,
} from '../../common/acceptanceContract.js';
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
        LAB_CONTRACTS_VERSION,
        CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS,
        PROFILES_EVIDENCE_LADDER,
        PROFILES_EVAL_DIMENSIONS,
        DOMAIN_NAVIGATION_SECTIONS,
} from '../../common/acceptanceContract.js';
import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DH01 } from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_DH02 } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_DH03 } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION as REAL_DH04 } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION as REAL_DH05 } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION as REAL_DH06 } from '../../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION as REAL_DH07 } from '../../../packs/common/packsContract.js';
import { PROFILES_CONTRACTS_VERSION as REAL_DH08 } from '../../../profiles/common/profilesContract.js';
import { BENCHMARKS_CONTRACTS_VERSION as REAL_DH09 } from '../../../benchmarks/common/benchmarksContract.js';
import { PROJECTIONS_CONTRACTS_VERSION as REAL_DH10 } from '../../../projections/common/projectionsContract.js';
import { ACTIVATION_CONTRACTS_VERSION as REAL_DH11 } from '../../../activation/common/activationContract.js';
import { OPTIMIZATION_CONTRACTS_VERSION as REAL_DH12 } from '../../../optimization/common/optimizationContract.js';
import { validateBenchmarkEntry } from '../../../benchmarks/common/benchmarksContract.js';
import { HARNESS_INDUSTRIES } from '../../../contract/common/domainHarnessContract.js';
import { LAB_CONTRACTS_VERSION as REAL_LAB } from '../../../../lab/common/labContracts.js';
import { CATALOG_PERMISSION_IDS as REAL_PERMISSIONS, CATALOG_PERMISSION_RISK_TIERS as REAL_TIERS } from '../../../../capabilities/packs/common/catalog.js';
import { PROFILES_EVIDENCE_LADDER as REAL_LADDER, PROFILES_EVAL_DIMENSIONS as REAL_DIMS } from '../../../profiles/common/profilesContract.js';
import { DOMAIN_NAVIGATION_SECTIONS as REAL_SECTIONS } from '../../../projections/common/projectionsContract.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';
import { INDUSTRY_TASK_WORLDS, getTaskScenario } from '../../../../lab/common/industryTaskWorlds.js';
import { FINANCE_WORLD_ID } from '../../../../lab/common/financeTaskWorld.js';
import { HEALTHCARE_WORLD_ID } from '../../../../lab/common/healthcareTaskWorld.js';
import { CONSTRUCTION_WORLD_ID } from '../../../../lab/common/constructionTaskWorld.js';
import type { IndustryAcceptanceFixture } from '../../common/acceptanceContract.js';
import { SOFTWARE_ACCEPTANCE_FIXTURE } from '../../industries/software.js';
import { FINANCE_ACCEPTANCE_FIXTURE } from '../../industries/finance.js';
import { HEALTHCARE_ACCEPTANCE_FIXTURE } from '../../industries/healthcare.js';
import { CONSTRUCTION_ACCEPTANCE_FIXTURE } from '../../industries/construction.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/acceptanceContract.ts', import.meta.url)), 'utf8');
const RUNNER_SOURCE = readFileSync(fileURLToPath(new URL('../../common/acceptanceRunner.ts', import.meta.url)), 'utf8');
const INDUSTRY_SOURCES: string[] = ['software', 'finance', 'healthcare', 'construction'].map(
        (name) => readFileSync(fileURLToPath(new URL(`../../industries/${name}.ts`, import.meta.url)), 'utf8'),
);

const LANE_FIXTURES: Readonly<Record<string, unknown>> = {
        software: SOFTWARE_ACCEPTANCE_FIXTURE,
        finance: FINANCE_ACCEPTANCE_FIXTURE,
        healthcare: HEALTHCARE_ACCEPTANCE_FIXTURE,
        construction: CONSTRUCTION_ACCEPTANCE_FIXTURE,
};

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL base-registry scenario ids (the landed SE world). */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL industry-extension scenario ids per world (the lab industry extension registry's own descriptors). */
const INDUSTRY_WORLD_IDS: Readonly<Record<string, string>> = {
        finance: FINANCE_WORLD_ID,
        healthcare: HEALTHCARE_WORLD_ID,
        construction: CONSTRUCTION_WORLD_ID,
};
function industryScenarioIdsOf(industry: string): string[] {
        const world = INDUSTRY_TASK_WORLDS.find((candidate) => candidate.world.worldId === INDUSTRY_WORLD_IDS[industry]);
        return world === undefined ? [] : world.taskScenarios.map((scenario) => scenario.id);
}
const REAL_FINANCE_SCENARIO_IDS: string[] = industryScenarioIdsOf('finance');
const REAL_HEALTHCARE_SCENARIO_IDS: string[] = industryScenarioIdsOf('healthcare');
const REAL_CONSTRUCTION_SCENARIO_IDS: string[] = industryScenarioIdsOf('construction');
const REAL_INDUSTRY_SCENARIO_IDS: string[] = [...REAL_FINANCE_SCENARIO_IDS, ...REAL_HEALTHCARE_SCENARIO_IDS, ...REAL_CONSTRUCTION_SCENARIO_IDS];

/** A structural deep copy (JSON) of a fixture for the mutation stations. */
function copy(fixture: unknown): Record<string, unknown> {
        return JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
}

/** The typed refusal extractor (the family pattern: a failed narrowing is a test bug, never a pass). */
function mustRefuse(outcome: { readonly ok: boolean } & ({ readonly ok: true } | { readonly ok: false; readonly rejection: { readonly reason: string; readonly law: string; readonly message: string; readonly items?: readonly string[] } })): { readonly reason: string; readonly law: string; readonly message: string; readonly items?: readonly string[] } {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejection;
}

function mustRefuseParse(outcome: { readonly ok: boolean } & ({ readonly ok: true } | { readonly ok: false; readonly rejection: { readonly reason: string; readonly message: string } })): { readonly reason: string; readonly message: string } {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejection;
}

function mustRefuseRow(outcome: { readonly ok: boolean } & ({ readonly ok: true } | { readonly ok: false; readonly message: string })): { readonly message: string } {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome;
}

// --- the version cross-pins -------------------------------------------------------------------------------------

suite('acceptanceContract · the version cross-pins (THE SINGLE-VERSION LAW + THE IMPORT LAW)', () => {
        test('HARNESS_ACCEPTANCE_VERSION is declared once and equals 1.0.0', () => {
                assert.strictEqual(HARNESS_ACCEPTANCE_VERSION, '1.0.0');
                const declarations = CONTRACT_SOURCE.match(/HARNESS_ACCEPTANCE_VERSION = /g) ?? [];
                assert.strictEqual(declarations.length, 1, 'the family version is declared exactly ONCE in the contract');
        });

        test('the TWELVE prior family versions are imported by reference and pinned equal to their owning modules', () => {
                assert.strictEqual(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_DH01);
                assert.strictEqual(ONBOARDING_CONTRACTS_VERSION, REAL_DH02);
                assert.strictEqual(ROLES_CONTRACTS_VERSION, REAL_DH03);
                assert.strictEqual(ONTOLOGY_CONTRACTS_VERSION, REAL_DH04);
                assert.strictEqual(TEMPLATES_CONTRACTS_VERSION, REAL_DH05);
                assert.strictEqual(BODIES_CONTRACTS_VERSION, REAL_DH06);
                assert.strictEqual(PACKS_CONTRACTS_VERSION, REAL_DH07);
                assert.strictEqual(PROFILES_CONTRACTS_VERSION, REAL_DH08);
                assert.strictEqual(BENCHMARKS_CONTRACTS_VERSION, REAL_DH09);
                assert.strictEqual(PROJECTIONS_CONTRACTS_VERSION, REAL_DH10);
                assert.strictEqual(ACTIVATION_CONTRACTS_VERSION, REAL_DH11);
                assert.strictEqual(OPTIMIZATION_CONTRACTS_VERSION, REAL_DH12);
                assert.strictEqual(LAB_CONTRACTS_VERSION, REAL_LAB);
        });

        test('the vocabulary re-exports are the REAL owning modules\' own lists (never transcribed)', () => {
                assert.deepStrictEqual([...CATALOG_PERMISSION_IDS], [...REAL_PERMISSIONS]);
                assert.deepStrictEqual([...CATALOG_PERMISSION_RISK_TIERS], [...REAL_TIERS]);
                assert.deepStrictEqual([...PROFILES_EVIDENCE_LADDER], [...REAL_LADDER]);
                assert.deepStrictEqual([...PROFILES_EVAL_DIMENSIONS], [...REAL_DIMS]);
                assert.deepStrictEqual([...DOMAIN_NAVIGATION_SECTIONS], [...REAL_SECTIONS]);
        });
});

// --- the frozen lane + the honest gap ledger ---------------------------------------------------------------------

suite('acceptanceContract · the frozen acceptance lane', () => {
        test('the lane is the four representative industries in the frozen order', () => {
                assert.deepStrictEqual([...ACCEPTANCE_INDUSTRIES], ['software', 'finance', 'healthcare', 'construction']);
        });

        test('every lane member is a REAL HARNESS_INDUSTRIES member (the lane is typed over the real union)', () => {
                // the `satisfies readonly HarnessIndustry[]` construction pins this at compile time;
                // the runtime pin is the predicate's total membership.
                for (const industry of ACCEPTANCE_INDUSTRIES) {
                        assert.ok(isAcceptanceIndustry(industry));
                }
                assert.ok(!isAcceptanceIndustry('legal'));
                assert.ok(!isAcceptanceIndustry(42));
        });
});

suite('acceptanceContract · the honest gap ledger (the six frozen rows; rows 1, 2, 3 and 5 CLOSED by the DH-GAP-2/GAP-3/GAP-5 waves)', () => {
        test('the six frozen gap keys, in the frozen order', () => {
                assert.deepStrictEqual([...ACCEPTANCE_GAP_KEYS], [
                        'lab-task-worlds-coverage',
                        'content-representativeness',
                        'no-live-provider-execution',
                        'no-production-real-harness-deployment',
                        'workbench-surface-runtime-binding',
                        'cr-ledger-integration-gaps',
                ]);
                assert.ok(isAcceptanceGapKey('no-live-provider-execution'));
                assert.ok(!isAcceptanceGapKey('made-up-gap'));
        });

        test('the ledger rows carry the registry row\'s own descriptions verbatim (rows 1, 2, 3 and 5 in their CLOSED successor states - the closures recorded IN the rows, never by silent removal)', () => {
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER.length, 6);
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[0].description, 'CLOSED 2026-10-15: the three industry task-worlds (finance/healthcare/construction) landed at PR #205 in the lab extension registry; the SE world plus three industry worlds - all four acceptance-lane industries carry industry-specific simulation worlds and their benchmark legs are bound; the coverage row is closed, recorded in the row (never by silent removal)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[1].description, 'CLOSED 2026-10-16: the four industry content sets are deepened to the declared censused representativeness bar - each industry carries at least six roles, ten terms, four tasks, four bodies, four packs and two profiles of real domain-shaped curated content (the census pinned by the battery, the content-census disclosure riding every report); the fixture-level bound stays disclosed - curated acceptance content, never a domain-truth claim; the row is closed, recorded in the row (never by silent removal)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[2].description, 'CLOSED 2026-10-16: the INF-009 live-provider canary ran green with a station-configured REAL provider endpoint (the station\'s endpoint contract over the platform\'s sanctioned inference gateway - a REAL chat-completion round-trip; the raw secret stays station-side, the drill binds only the opaque handle) - a REAL network exchange recorded as live-real DrillRecord (drillClass "acceptance-exchange", verdict "eligible", the byte-identical ledger read-back, the fixture-configured no-live-port rejection - live-real is claimed ONLY when a live exchange actually happened); the row is closed, recorded in the row (never by silent removal)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[3].description, 'the harness families\' evidence ceiling is fixture/simulated; production deployment of harness configurations is a future TL-A-coordinated step');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[4].description, 'CLOSED 2026-10-16: the flauz-harness extension\'s runtime binding executed live at the station - the binding drill (extensions/flauz-harness/test/flauzHarnessPort.binding.drill.ts, run under bun, the lane that resolves the kits\' .js specifiers Node dropped) drove the full op chain over the REAL kits: the port open over a fresh root, the REAL frozen vocabularies, the DH-02 session ops (industry -> company -> work-types -> review), the DH-03 compose+emit at the same root, the propose boundary minting the harness through the inner REAL DH-01 kit with the deterministic injected seams (the pinned harness id, the determinism double-run byte-equal), the REAL DH-010 navigation projection over the minted harness - the nine frozen sections with the honest not-composed families; the closed activation door pinned on the port surface (exactly the twelve ops + the id/mode data keys, no activation op - the DH-01 authority keeps the lifecycle); the extension\'s node --test lane still never imports the binding (the letter of the flauz-lab law kept); the row is closed, recorded in the row (never by silent removal)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[5].description, 'the Phase C-R terminal ledger\'s three exercised-but-unresolved and two unexercised integration gaps remain tracked in the CR records (cross-referenced, not re-litigated here)');
                for (const row of HARNESS_ACCEPTANCE_GAP_LEDGER) {
                        assert.ok((PROFILES_EVIDENCE_LADDER as readonly string[]).includes(row.evidenceLevel), `the row '${row.gapKey}' carries a REAL ladder rung as its honest evidence floor`);
                        assert.ok(row.owner.length > 0);
                }
        });

        test('THE CLOSED-ROW LAW: the closed-key list is exactly rows 1, 2, 3 and 5; every closed row\'s description records its closure; no open row\'s description does', () => {
                assert.deepStrictEqual([...ACCEPTANCE_CLOSED_GAP_KEYS], ['lab-task-worlds-coverage', 'content-representativeness', 'no-live-provider-execution', 'workbench-surface-runtime-binding']);
                for (const key of ACCEPTANCE_CLOSED_GAP_KEYS) {
                        const row = HARNESS_ACCEPTANCE_GAP_LEDGER.find((ledgerRow) => ledgerRow.gapKey === key);
                        assert.ok(row !== undefined, `the closed key '${key}' is a REAL frozen ledger row`);
                        assert.ok((row as { description: string }).description.startsWith('CLOSED '), `the closed row '${key}' records its closure IN its own description`);
                }
                for (const row of HARNESS_ACCEPTANCE_GAP_LEDGER) {
                        if (!isAcceptanceClosedGapKey(row.gapKey)) {
                                assert.ok(!row.description.startsWith('CLOSED '), `the open row '${row.gapKey}' carries no closure record`);
                        }
                }
                assert.ok(isAcceptanceClosedGapKey('lab-task-worlds-coverage'));
                assert.ok(isAcceptanceClosedGapKey('no-live-provider-execution'));
                assert.ok(isAcceptanceClosedGapKey('workbench-surface-runtime-binding'));
                assert.ok(!isAcceptanceClosedGapKey('no-production-real-harness-deployment'));
                assert.ok(!isAcceptanceClosedGapKey('cr-ledger-integration-gaps'));
                assert.ok(!isAcceptanceClosedGapKey('made-up-gap'));
        });

        test('the ledger is frozen (Object.freeze at every level)', () => {
                assert.ok(Object.isFrozen(HARNESS_ACCEPTANCE_GAP_LEDGER));
                for (const row of HARNESS_ACCEPTANCE_GAP_LEDGER) {
                        assert.ok(Object.isFrozen(row));
                }
        });
});

// --- the curated fixture walk ------------------------------------------------------------------------------------

suite('acceptanceContract · the curated fixture walk (the four shipped fixtures are green)', () => {
        test('every shipped fixture passes the walk and returns the canonical fixed-key-order copy', () => {
                for (const [industry, fixture] of Object.entries(LANE_FIXTURES)) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok, `the ${industry} fixture must be green: ${outcome.ok ? '' : outcome.rejection.message}`);
                        assert.deepStrictEqual(Object.keys(outcome.fixture), [...INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS]);
                        assert.strictEqual(outcome.fixture.industry, industry);
                }
        });

        test('the curated census (the DH-GAP-2 declared censused representativeness bar): six roles, ten terms, four tasks, four bodies, four packs, two profiles', () => {
                for (const fixture of Object.values(LANE_FIXTURES)) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok);
                        assert.strictEqual(outcome.fixture.roles.length, FIXTURE_ENTRY_CENSUS.roles.min);
                        assert.strictEqual(outcome.fixture.terms.length, FIXTURE_ENTRY_CENSUS.terms.min);
                        assert.strictEqual(outcome.fixture.tasks.length, FIXTURE_ENTRY_CENSUS.tasks.min);
                        assert.strictEqual(outcome.fixture.bodies.length, FIXTURE_ENTRY_CENSUS.bodies.min);
                        assert.strictEqual(outcome.fixture.packs.length, FIXTURE_ENTRY_CENSUS.packs.min);
                        assert.strictEqual(outcome.fixture.profiles.length, FIXTURE_ENTRY_CENSUS.profiles.min);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.roles.max, 6);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.terms.max, 10);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.tasks.max, 4);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.bodies.max, 4);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.packs.max, 4);
                        assert.strictEqual(FIXTURE_ENTRY_CENSUS.profiles.max, 2);
                }
        });

        test('every fixture\'s vocabularies are REAL members (size bands, work types, permissions, tiers, rungs, dims, scenario ids over the lane each binding uses)', () => {
                for (const fixture of Object.values(LANE_FIXTURES) as unknown as IndustryAcceptanceFixture[]) {
                        assert.ok(['solo', 'small', 'medium', 'large', 'enterprise'].includes(fixture.companyProfile.sizeBand), 'a REAL COMPANY_SIZE_BANDS member');
                        for (const workType of fixture.workTypes) {
                                assert.ok(['analysis', 'drafting', 'review', 'planning', 'research', 'reporting', 'data-processing', 'compliance', 'communication', 'administration'].includes(workType), `the work type '${workType}' is a REAL member`);
                        }
                        for (const profile of fixture.profiles) {
                                for (const permissionRef of profile.permissionRefs) {
                                        assert.ok((REAL_PERMISSIONS as readonly string[]).includes(permissionRef), `the permission '${permissionRef}' is a REAL catalog member`);
                                }
                                for (const tier of profile.approvalTiers) {
                                        assert.ok((REAL_TIERS as readonly string[]).includes(tier), `the tier '${tier}' is a REAL risk tier`);
                                }
                                assert.ok((REAL_LADDER as readonly string[]).includes(profile.evidenceFloor), 'a REAL evidence rung');
                                for (const dimension of profile.kpiDimensions) {
                                        assert.ok((REAL_DIMS as readonly string[]).includes(dimension), `the KPI dimension '${dimension}' is a REAL eval dimension`);
                                }
                        }
                        const binding = benchmarkBindingOf(fixture.benchmark);
                        if (binding !== null) {
                                const scenarioIds = binding.mode === 'base-registry' ? REAL_SCENARIO_IDS : REAL_INDUSTRY_SCENARIO_IDS;
                                for (const scenarioRef of binding.entry.scenarioRefs) {
                                        assert.ok(scenarioIds.includes(scenarioRef), `the scenario '${scenarioRef}' is a REAL registry id on the ${binding.mode} lane`);
                                }
                        }
                }
        });

        test('every fixture\'s internal refs resolve (termRefs -> terms, roleRefs -> roles, bodyRefs -> bodies)', () => {
                for (const fixture of Object.values(LANE_FIXTURES) as unknown as IndustryAcceptanceFixture[]) {
                        const terms = fixture.terms.map((term) => term.term);
                        const roleKeys = fixture.roles.map((role) => role.roleKey);
                        const bodyKeys = fixture.bodies.map((body) => body.bodyKey);
                        for (const task of fixture.tasks) {
                                for (const termRef of task.termRefs) {
                                        assert.ok(terms.includes(termRef), `the task '${task.taskKey}' termRef '${termRef}' resolves`);
                                }
                        }
                        for (const body of fixture.bodies) {
                                for (const roleRef of body.roleRefs) {
                                        assert.ok(roleKeys.includes(roleRef), `the body '${body.bodyKey}' roleRef '${roleRef}' resolves`);
                                }
                        }
                        for (const pack of fixture.packs) {
                                for (const bodyRef of pack.bodyRefs) {
                                        assert.ok(bodyKeys.includes(bodyRef), `the pack '${pack.packKey}' bodyRef '${bodyRef}' resolves`);
                                }
                        }
                }
        });

        test('all four fixtures carry curated benchmarks (software: the base-registry binding over the REAL three SE scenarios; the three industry fixtures: the industry-extension bindings over their OWN worlds\' REAL three scenarios)', () => {
                const software = validateIndustryAcceptanceFixture(SOFTWARE_ACCEPTANCE_FIXTURE);
                assert.ok(software.ok);
                assert.strictEqual(benchmarkBindingModeOf(software.fixture.benchmark), 'base-registry');
                assert.deepStrictEqual([...(software.fixture.benchmark as unknown as { scenarioRefs: readonly string[] }).scenarioRefs], REAL_SCENARIO_IDS);
                assert.strictEqual((software.fixture.benchmark as { evidenceLevel: string }).evidenceLevel, 'fixture');
                const expectedIndustryIds: Readonly<Record<string, string[]>> = {
                        finance: REAL_FINANCE_SCENARIO_IDS,
                        healthcare: REAL_HEALTHCARE_SCENARIO_IDS,
                        construction: REAL_CONSTRUCTION_SCENARIO_IDS,
                };
                for (const [industry, fixture] of Object.entries(LANE_FIXTURES)) {
                        if (industry === 'software') {
                                continue;
                        }
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok);
                        const binding = benchmarkBindingOf(outcome.fixture.benchmark);
                        assert.ok(binding !== null, `${industry}: the curated binding is present`);
                        assert.strictEqual(binding?.mode, 'industry-extension-registry', `${industry}: the industry-extension binding mode`);
                        assert.deepStrictEqual([...(binding as { entry: { scenarioRefs: readonly string[] } }).entry.scenarioRefs], expectedIndustryIds[industry], `${industry}: the industry's OWN three REAL scenario ids`);
                        assert.strictEqual((binding as { entry: { evidenceLevel: string } }).entry.evidenceLevel, 'fixture');
                }
        });

        test('no fixture registers a CLOSED row; every fixture registers exactly the TWO OPEN rows (the closures are recorded IN the ledger rows)', () => {
                for (const [industry, fixture] of Object.entries(LANE_FIXTURES) as unknown as [string, IndustryAcceptanceFixture][]) {
                        const keys = fixture.expectedGaps.map((row) => row.gapKey);
                        for (const key of keys) {
                                assert.ok(!isAcceptanceClosedGapKey(key), `${industry}: the closed row '${key}' is registered by none`);
                        }
                        assert.deepStrictEqual(keys, ['no-production-real-harness-deployment', 'cr-ledger-integration-gaps'], `${industry}: exactly the two open rows`);
                }
        });

        test('every fixture\'s expectedGaps rows are the frozen ledger rows carried verbatim', () => {
                for (const fixture of Object.values(LANE_FIXTURES) as unknown as IndustryAcceptanceFixture[]) {
                        for (const row of fixture.expectedGaps) {
                                const frozen = HARNESS_ACCEPTANCE_GAP_LEDGER.find((ledgerRow) => ledgerRow.gapKey === row.gapKey);
                                assert.ok(frozen !== undefined);
                                assert.strictEqual(row.description, frozen.description);
                                assert.strictEqual(row.evidenceLevel, frozen.evidenceLevel);
                                assert.strictEqual(row.owner, frozen.owner);
                        }
                }
        });
});

suite('acceptanceContract · the fixture walk\'s fail-closed stations', () => {
        test('the frozen rejection vocabulary (twenty stations in the walk order)', () => {
                assert.strictEqual(FIXTURE_REJECTION_REASONS.length, 20);
                assert.ok(isFixtureRejectionReason('dangling-ref'));
                assert.ok(!isFixtureRejectionReason('made-up-reason'));
        });

        test('a non-object fixture is the typed malformed-fixture rejection', () => {
                for (const candidate of [undefined, null, 42, 'fixture', []]) {
                        const outcome = validateIndustryAcceptanceFixture(candidate);
                        assert.ok(!outcome.ok);
                        assert.strictEqual(outcome.rejection.reason, 'malformed-fixture');
                }
        });

        test('an unknown key is the typed unknown-key rejection (THE STRICT-SCHEMA LAW)', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.extraKey = true;
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-key');
                assert.deepStrictEqual(outcome.rejection.items, ['extraKey']);
        });

        test('a missing key is the typed missing-key rejection (every key is required - absence is the null carrier, never an absent key)', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                delete mutated.benchmark;
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'missing-key');
                assert.deepStrictEqual(outcome.rejection.items, ['benchmark']);
        });

        test('an industry outside the REAL vocabulary is the typed unknown-industry rejection', () => {
                // NOTE: a REAL member outside the acceptance four (e.g. 'legal') is NOT an
                // unknown-industry rejection - it is a well-formed fifth-industry fixture (a
                // fifth industry is a new fixture module, never a code path). The rejection
                // fires only OUTSIDE the REAL 16-member HARNESS_INDUSTRIES vocabulary.
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.industry = 'aerospace';
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-industry');
        });

        test('a company profile outside the REAL DH-02 walk is the typed invalid-company-profile rejection (surfaced verbatim)', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.companyProfile = { displayName: 'x', sizeBand: 'gigantic' };
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-company-profile');
                // THE VERBATIM-CARRY LAW: the REAL DH-02 walk's own message rides the rejection
                // (the real walk names the violated law, not the offending value - its own items
                // carry 'gigantic'; the fixture rejection surfaces the real MESSAGE verbatim).
                assert.ok(outcome.rejection.message.includes('the sizeBand must be a member of the frozen COMPANY_SIZE_BANDS list'));
                assert.ok(outcome.rejection.message.includes('validateOnboardingCompanyProfile'));
        });

        test('work types outside the REAL DH-02 walk are the typed invalid-work-types rejection', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.workTypes = ['analysis', 'witchcraft'];
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-work-types');
        });

        test('an entry failing its OWNING family\'s REAL validator is the typed entry rejection (per family)', () => {
                for (const [key, reason] of [
                        ['roles', 'invalid-roles'],
                        ['terms', 'invalid-terms'],
                        ['tasks', 'invalid-tasks'],
                        ['bodies', 'invalid-bodies'],
                        ['packs', 'invalid-packs'],
                        ['profiles', 'invalid-profiles'],
                ] as const) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        (mutated[key] as unknown[])[0] = { junk: true };
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `the ${key} station must refuse`);
                        assert.strictEqual(outcome.rejection.reason, reason, `the ${key} station's typed reason`);
                }
        });

        test('a malformed benchmark carrier is the typed invalid-benchmark rejection', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.benchmark = 42;
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-benchmark');
        });

        test('a benchmark entry failing the REAL DH-09 validator is the typed invalid-benchmark rejection', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                (mutated.benchmark as Record<string, unknown>).scenarioRefs = [];
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-benchmark');
        });

        test("a dangling scenarioRef is the typed invalid-benchmark rejection (THE OWNING FAMILY's OWN SCENARIO-BINDING LAW fires first)", () => {
                // THE VERBATIM-CARRY LAW's ordering: the entry stations precede the contract's
                // own defense-in-depth stations - the REAL DH-09 validator already binds every
                // scenarioRef against the REAL registry through the SAME imported getScenario,
                // so a fabricated id refuses at the entry station (invalid-benchmark) carrying
                // the family's own 'dangling-scenario-ref' table verbatim. The contract's own
                // unknown-scenario-ref station is defense-in-depth behind the real walk (it
                // would fire only if the owning family ever relaxed its binding).
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                (mutated.benchmark as Record<string, unknown>).scenarioRefs = ['scenario-made-up-world'];
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-benchmark');
                assert.ok(outcome.rejection.message.includes("the OWNING family's REAL DH-09 validator"));
                // THE VERBATIM-CARRY LAW's proof at the owning family level: the REAL DH-09
                // walk's own rejection table for the same mutated entry carries its
                // 'dangling-scenario-ref' station naming the fabricated id.
                const familyWalk = validateBenchmarkEntry(mutated.benchmark);
                assert.ok(!familyWalk.ok);
                const scenarioStation = familyWalk.rejections.find((rejection) => rejection.reason === 'dangling-scenario-ref');
                assert.ok(scenarioStation !== undefined, 'the real DH-09 walk carries the dangling-scenario-ref station');
                assert.deepStrictEqual([...(scenarioStation as { items: readonly string[] }).items], ['scenario-made-up-world']);
        });

        test('a BASE-REGISTRY benchmark on a non-software fixture is the typed benchmark-industry-mismatch rejection (THE REGISTRY FACT LAW)', () => {
                // The landed base registry carries the SE fixture world - the software
                // industry's own. A plain (base-registry) SE-bound entry on the finance
                // fixture is the registry-fact refusal; the finance fixture's lawful lane
                // is the industry-extension binding.
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                mutated.benchmark = JSON.parse(JSON.stringify(SOFTWARE_ACCEPTANCE_FIXTURE.benchmark));
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'benchmark-industry-mismatch');
                assert.ok(outcome.rejection.message.includes('the software industry\'s own'));
        });

        test('a dangling internal ref is the typed dangling-ref rejection (task termRef / body roleRef / pack bodyRef)', () => {
                for (const [mutator, field] of [
                        [(mutated: Record<string, unknown>) => { ((mutated.tasks as { termRefs: string[] }[])[0]).termRefs = ['no.such.term']; }, 'tasks'],
                        [(mutated: Record<string, unknown>) => { ((mutated.bodies as { roleRefs: string[] }[])[0]).roleRefs = ['no-such-role']; }, 'bodies'],
                        [(mutated: Record<string, unknown>) => { ((mutated.packs as { bodyRefs: string[] }[])[0]).bodyRefs = ['no-such-body']; }, 'packs'],
                ] as const) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        mutator(mutated);
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `the ${field} dangling-ref station must refuse`);
                        assert.strictEqual(outcome.rejection.reason, 'dangling-ref');
                        assert.ok((outcome.rejection.items as string[])[0].startsWith(`dangling-ref:${field}`));
                }
        });

        test('a repeated identity key is the typed duplicate-key rejection (per family)', () => {
                for (const [key, field, itemLabel, reason, expected] of [
                        // the law table's item labels are the fixture's own identity-key labels
                        // ('roleKeys', 'terms', 'taskKeys', 'bodyKeys', 'packKeys', 'profileKeys').
                        // NOTE (the DH-GAP-2 re-pin): the landed one-profile fixture made the
                        // profiles mutation a MALFORMED entry caught by the entry station first;
                        // the two-profile census now exercises the law table's own
                        // duplicate-key station for every family (the entry-stations-precede
                        // ordering is separately pinned by the per-family entry-failure test).
                        ['roles', 'roleKey', 'roleKeys', 'roles', 'duplicate-key'],
                        ['terms', 'term', 'terms', 'terms', 'duplicate-key'],
                        ['tasks', 'taskKey', 'taskKeys', 'taskKeys', 'duplicate-key'],
                        ['bodies', 'bodyKey', 'bodyKeys', 'bodyKeys', 'duplicate-key'],
                        ['packs', 'packKey', 'packKeys', 'packKeys', 'duplicate-key'],
                        ['profiles', 'profileKey', 'profileKeys', 'profileKeys', 'duplicate-key'],
                ] as const) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        const entries = mutated[key] as Record<string, unknown>[];
                        entries[1] = { ...entries[1], [field]: entries[0][field] };
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `the ${key} duplicate-key station must refuse`);
                        assert.strictEqual(outcome.rejection.reason, expected);
                        if (expected === 'duplicate-key') {
                                assert.ok((outcome.rejection.items as string[]).some((item) => item.startsWith(`duplicate-key:${itemLabel}`)), `the item label '${itemLabel}'`);
                        }
                }
        });

        test('a census violation is the typed fixture-count-law rejection (per family + the KPI floor)', () => {
                const extraKeys: Readonly<Record<string, string>> = {
                        roles: 'roleKey:extra-role',
                        terms: 'term:se.extra-term',
                        tasks: 'taskKey:extra-task',
                        bodies: 'bodyKey:extra-body',
                        packs: 'packKey:extra-pack',
                };
                for (const key of ['roles', 'terms', 'tasks', 'bodies', 'packs'] as const) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        const entries = mutated[key] as unknown[];
                        entries.push(JSON.parse(JSON.stringify(entries[0])));
                        const [field, value] = extraKeys[key].split(':');
                        (entries[entries.length - 1] as Record<string, unknown>)[field] = value;
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `the ${key} census station must refuse`);
                        assert.strictEqual(outcome.rejection.reason, 'fixture-count-law');
                        assert.ok((outcome.rejection.items as string[]).some((item) => item.startsWith(`fixture-count-law:${key}=`)));
                }
                // THE KPI floor re-pin (the DH-GAP-2 two-profile census): the union floor
                // considers EVERY profile - emptying the dimensions of all of them empties
                // the union (a single emptied profile leaves the other's dimensions).
                const kpiMutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                for (const profile of kpiMutated.profiles as { kpiDimensions: string[] }[]) {
                        profile.kpiDimensions = [];
                }
                const kpiOutcome = validateIndustryAcceptanceFixture(kpiMutated);
                assert.ok(!kpiOutcome.ok);
                assert.strictEqual(kpiOutcome.rejection.reason, 'fixture-count-law');
                assert.ok((kpiOutcome.rejection.items as string[]).includes('fixture-count-law:kpiDimensions-union-empty'));
        });

        test('a benchmark-absent fixture for a COVERED industry is the typed gap-registration-missing rejection (THE COVERAGE LAW - the updated fail-closed truth)', () => {
                // The finance industry's task-world EXISTS (the lab industry extension
                // registry); the coverage row is CLOSED and cannot be registered as an open
                // gap - an un-exercised evaluable benchmark leg has no honest registration.
                for (const fixture of [SOFTWARE_ACCEPTANCE_FIXTURE, FINANCE_ACCEPTANCE_FIXTURE, HEALTHCARE_ACCEPTANCE_FIXTURE, CONSTRUCTION_ACCEPTANCE_FIXTURE]) {
                        const mutated = copy(fixture);
                        mutated.benchmark = null;
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, 'the covered-industry benchmark-absent station must refuse');
                        assert.strictEqual(outcome.rejection.reason, 'gap-registration-missing');
                        assert.ok(outcome.rejection.message.includes('the coverage row is CLOSED'));
                }
        });

        test('a benchmark-absent fixture for an UNCOVERED industry is green (the honest null; the two open rows only - a fifth industry is a new fixture module, never a code path)', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.industry = 'legal';
                mutated.benchmark = null;
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.rejection.message);
                assert.strictEqual(outcome.fixture.benchmark, null);
                assert.deepStrictEqual(outcome.fixture.expectedGaps.map((row) => row.gapKey), ['no-production-real-harness-deployment', 'cr-ledger-integration-gaps']);
        });

        test('a fixture registering a CLOSED ledger row is the typed gap-registration-inconsistent rejection (THE CLOSED-ROW LAW - rows 1, 2, 3 and 5)', () => {
                for (const closedKey of ACCEPTANCE_CLOSED_GAP_KEYS) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        const closedRow = HARNESS_ACCEPTANCE_GAP_LEDGER.find((row) => row.gapKey === closedKey);
                        assert.ok(closedRow !== undefined);
                        mutated.expectedGaps = [...(mutated.expectedGaps as unknown[]), JSON.parse(JSON.stringify(closedRow))];
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `the closed row '${closedKey}' must not be registrable`);
                        assert.strictEqual(outcome.rejection.reason, 'gap-registration-inconsistent');
                        assert.ok((outcome.rejection.items as string[]).some((item) => item.startsWith(`closed-gap-key:${closedKey}`)));
                }
        });

        test('an unknown / duplicate / drifted gap row is the typed gap-registration-inconsistent rejection (the rows are registered VERBATIM)', () => {
                const unknownKey = copy(FINANCE_ACCEPTANCE_FIXTURE);
                (unknownKey.expectedGaps as unknown[]).push({ gapKey: 'made-up-gap', description: 'x', evidenceLevel: 'fixture', owner: 'x' });
                assert.strictEqual(mustRefuse(validateIndustryAcceptanceFixture(unknownKey)).reason, 'gap-registration-inconsistent');

                const drifted = copy(FINANCE_ACCEPTANCE_FIXTURE);
                (drifted.expectedGaps as { description: string }[])[1].description = 'a paraphrased description';
                assert.strictEqual(mustRefuse(validateIndustryAcceptanceFixture(drifted)).reason, 'gap-registration-inconsistent');

                const duplicated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                (duplicated.expectedGaps as unknown[]).push(JSON.parse(JSON.stringify((duplicated.expectedGaps as unknown[])[0])));
                assert.strictEqual(mustRefuse(validateIndustryAcceptanceFixture(duplicated)).reason, 'gap-registration-inconsistent');
        });
});

// --- the benchmark binding modes (the DH-GAP-2 wave's additive contract addition) --------------------------------

suite('acceptanceContract · THE BENCHMARK BINDING MODES (the DH-GAP-2 additive contract addition)', () => {
        test('the frozen two-mode vocabulary + the pure classifier (data-driven over the carrier\'s own shape, never an industry branch)', () => {
                assert.deepStrictEqual([...ACCEPTANCE_BENCHMARK_BINDING_MODES], ['base-registry', 'industry-extension-registry']);
                assert.ok(isAcceptanceBenchmarkBindingMode('base-registry'));
                assert.ok(!isAcceptanceBenchmarkBindingMode('combined-catalog'));
                assert.strictEqual(benchmarkBindingModeOf(null), null);
                assert.strictEqual(benchmarkBindingModeOf(SOFTWARE_ACCEPTANCE_FIXTURE.benchmark), 'base-registry');
                assert.strictEqual(benchmarkBindingModeOf(FINANCE_ACCEPTANCE_FIXTURE.benchmark), 'industry-extension-registry');
                const binding = benchmarkBindingOf(FINANCE_ACCEPTANCE_FIXTURE.benchmark);
                assert.ok(binding !== null);
                assert.strictEqual(binding?.mode, 'industry-extension-registry');
                assert.strictEqual(binding?.entry.benchmarkKey, 'lending-operations-health');
                assert.strictEqual(benchmarkBindingOf(null), null);
                assert.deepStrictEqual([...INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS], ['bindingMode', 'entry']);
        });

        test('the wrapped binding\'s strict two-key schema: an unknown key or a missing key is the typed invalid-benchmark rejection', () => {
                const unknownKey = copy(FINANCE_ACCEPTANCE_FIXTURE);
                (unknownKey.benchmark as Record<string, unknown>).extraKey = true;
                const unknownOutcome = validateIndustryAcceptanceFixture(unknownKey);
                assert.ok(!unknownOutcome.ok);
                assert.strictEqual(unknownOutcome.rejection.reason, 'invalid-benchmark');
                assert.deepStrictEqual(unknownOutcome.rejection.items, ['extraKey']);

                const missingKey = copy(FINANCE_ACCEPTANCE_FIXTURE);
                delete (missingKey.benchmark as Record<string, unknown>).entry;
                const missingOutcome = validateIndustryAcceptanceFixture(missingKey);
                assert.ok(!missingOutcome.ok);
                assert.strictEqual(missingOutcome.rejection.reason, 'invalid-benchmark');
                assert.deepStrictEqual(missingOutcome.rejection.items, ['entry']);
        });

        test('THE TWO-PHASE BINDING LAW: a wrapped entry must fail the REAL DH-09 walk with EXACTLY the dangling-scenario-ref station', () => {
                // A well-formed industry entry: the REAL DH-09 walk refuses it with exactly
                // the dangling-scenario-ref station (every other station green - proven by
                // the family-level walk over the shipped finance entry).
                const familyWalk = validateBenchmarkEntry((FINANCE_ACCEPTANCE_FIXTURE.benchmark as { entry: unknown }).entry);
                assert.ok(!familyWalk.ok);
                assert.strictEqual(familyWalk.rejections.length, 1, 'exactly one station');
                assert.strictEqual(familyWalk.rejections[0].reason, 'dangling-scenario-ref');
                assert.deepStrictEqual([...(familyWalk.rejections[0].items ?? [])], REAL_FINANCE_SCENARIO_IDS);

                // The same proof over the other two shipped industry entries: each fails the
                // REAL walk with EXACTLY the dangling station naming its OWN industry's refs.
                for (const [fixture, ownIds] of [
                        [HEALTHCARE_ACCEPTANCE_FIXTURE, REAL_HEALTHCARE_SCENARIO_IDS],
                        [CONSTRUCTION_ACCEPTANCE_FIXTURE, REAL_CONSTRUCTION_SCENARIO_IDS],
                ] as const) {
                        const walk = validateBenchmarkEntry((fixture.benchmark as { entry: unknown }).entry);
                        assert.ok(!walk.ok);
                        assert.strictEqual(walk.rejections.length, 1, 'exactly one station');
                        assert.strictEqual(walk.rejections[0].reason, 'dangling-scenario-ref');
                        assert.deepStrictEqual([...(walk.rejections[0].items ?? [])], [...ownIds]);
                }

                // A wrapped entry with SE scenario refs: the REAL walk is GREEN (no dangling
                // station) - the wrapped binding is refused (a base-registry binding must be
                // the plain BenchmarkEntry shape, never the wrapped binding).
                const baseRefs = copy(FINANCE_ACCEPTANCE_FIXTURE);
                ((baseRefs.benchmark as { entry: { scenarioRefs: string[] } }).entry).scenarioRefs = [...REAL_SCENARIO_IDS];
                const baseRefsOutcome = validateIndustryAcceptanceFixture(baseRefs);
                assert.ok(!baseRefsOutcome.ok);
                assert.strictEqual(baseRefsOutcome.rejection.reason, 'invalid-benchmark');
                assert.ok(baseRefsOutcome.rejection.message.includes('EXACTLY the dangling-scenario-ref station'));

                // A wrapped entry with a malformed text leg AND industry refs: the REAL walk
                // carries MORE than the dangling station - the wrapped binding is refused
                // with the real table's stations carried.
                const malformed = copy(FINANCE_ACCEPTANCE_FIXTURE);
                ((malformed.benchmark as { entry: { summary: string } }).entry).summary = '';
                const malformedOutcome = validateIndustryAcceptanceFixture(malformed);
                assert.ok(!malformedOutcome.ok);
                assert.strictEqual(malformedOutcome.rejection.reason, 'invalid-benchmark');
                assert.ok((malformedOutcome.rejection.items as string[]).some((item) => item.startsWith('summary-length')));
        });

        test('THE SCENARIO-BINDING LAW over the combined catalog: a fabricated scenarioRef is the typed unknown-scenario-ref rejection', () => {
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                ((mutated.benchmark as { entry: { scenarioRefs: string[] } }).entry).scenarioRefs = ['scenario-finance-made-up-probe'];
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'unknown-scenario-ref');
                assert.deepStrictEqual([...outcome.rejection.items ?? []], ['scenario-finance-made-up-probe']);
                assert.ok(outcome.rejection.message.includes('getTaskScenario'));
        });

        test('THE INDUSTRY-MATCH LAW: a wrapped binding on a neighbor\'s world / the SE world / an uncovered industry is the typed benchmark-industry-mismatch rejection', () => {
                // a finance fixture binding the healthcare world's scenarios
                const neighbor = copy(FINANCE_ACCEPTANCE_FIXTURE);
                ((neighbor.benchmark as { entry: { scenarioRefs: string[] } }).entry).scenarioRefs = [...REAL_HEALTHCARE_SCENARIO_IDS];
                const neighborOutcome = validateIndustryAcceptanceFixture(neighbor);
                assert.ok(!neighborOutcome.ok);
                assert.strictEqual(neighborOutcome.rejection.reason, 'benchmark-industry-mismatch');
                assert.ok((neighborOutcome.rejection.items as string[]).every((item) => item.endsWith('->healthcare')));

                // a finance fixture binding the SE world's scenarios
                const seWorld = copy(FINANCE_ACCEPTANCE_FIXTURE);
                ((seWorld.benchmark as { entry: { scenarioRefs: string[] } }).entry).scenarioRefs = [...REAL_SCENARIO_IDS.slice(0, 1), ...REAL_FINANCE_SCENARIO_IDS.slice(0, 1)];
                const seWorldOutcome = validateIndustryAcceptanceFixture(seWorld);
                assert.ok(!seWorldOutcome.ok);
                assert.strictEqual(seWorldOutcome.rejection.reason, 'benchmark-industry-mismatch');

                // a software fixture with a wrapped binding binding the finance world's scenarios
                const softwareWrapped = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                softwareWrapped.benchmark = JSON.parse(JSON.stringify(FINANCE_ACCEPTANCE_FIXTURE.benchmark));
                const softwareOutcome = validateIndustryAcceptanceFixture(softwareWrapped);
                assert.ok(!softwareOutcome.ok);
                assert.strictEqual(softwareOutcome.rejection.reason, 'benchmark-industry-mismatch');

                // an UNCOVERED industry (legal) with a wrapped binding binding the finance world's scenarios
                const legalWrapped = copy(FINANCE_ACCEPTANCE_FIXTURE);
                legalWrapped.industry = 'legal';
                const legalOutcome = validateIndustryAcceptanceFixture(legalWrapped);
                assert.ok(!legalOutcome.ok);
                assert.strictEqual(legalOutcome.rejection.reason, 'benchmark-industry-mismatch');
        });

        test('the combined-catalog lookups are the REAL imported extension registry\'s own (THE IMPORT LAW: getTaskScenario resolves every industry scenario and none of the SE ones)', () => {
                for (const scenarioId of REAL_INDUSTRY_SCENARIO_IDS) {
                        assert.ok(getTaskScenario(scenarioId) !== undefined, `the industry scenario '${scenarioId}' resolves through the combined catalog`);
                }
                for (const scenarioId of REAL_SCENARIO_IDS) {
                        const resolved = getTaskScenario(scenarioId);
                        assert.ok(resolved !== undefined, `the SE scenario '${scenarioId}' resolves through the combined catalog (the base resolution is referential)`);
                }
                assert.strictEqual(getTaskScenario('scenario-finance-made-up-probe'), undefined);
        });

        test('the benchmark legs\' binding surface: the lab industry extension registry carries the three industry worlds with exactly three scenarios each (the combined catalog = the landed SE world + the three)', () => {
                assert.strictEqual(INDUSTRY_TASK_WORLDS.length, 3);
                for (const world of INDUSTRY_TASK_WORLDS) {
                        assert.strictEqual(world.taskScenarios.length, 3, `the world '${world.world.worldId}' carries exactly three scenarios`);
                        assert.ok(['finance', 'healthcare', 'construction'].includes(world.world.domain), `the world '${world.world.worldId}' declares its industry domain`);
                }
                assert.strictEqual(REAL_SCENARIO_IDS.length + REAL_INDUSTRY_SCENARIO_IDS.length, 12, 'the combined catalog carries twelve scenarios (three SE + three per industry world)');
        });

        test('a wrapped binding whose entry is not a record is the typed invalid-benchmark rejection (THE TWO-PHASE BINDING LAW over a malformed carrier)', () => {
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                (mutated.benchmark as Record<string, unknown>).entry = 42;
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'invalid-benchmark');
        });

        test('THE COVERAGE LAW over the REAL industry vocabulary: the four lane industries are covered; every other REAL member is uncovered (the honest-null path)', () => {
                // the four lane industries all carry task-worlds (software through the landed
                // base registry; the three through the lab industry extension registry); a
                // REAL member outside them (the vocabulary carries sixteen) has no world -
                // the honest null is the lawful benchmark carrier for it.
                const uncovered = HARNESS_INDUSTRIES.filter((industry) => !ACCEPTANCE_INDUSTRIES.includes(industry as (typeof ACCEPTANCE_INDUSTRIES)[number]));
                assert.ok(uncovered.length > 0, 'the REAL vocabulary carries members outside the acceptance lane');
                for (const industry of uncovered) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        mutated.industry = industry;
                        mutated.benchmark = null;
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(outcome.ok, `${industry}: the uncovered industry carries the honest null lawfully`);
                }
                for (const industry of ACCEPTANCE_INDUSTRIES) {
                        const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                        mutated.industry = industry;
                        mutated.benchmark = null;
                        const outcome = validateIndustryAcceptanceFixture(mutated);
                        assert.ok(!outcome.ok, `${industry}: the covered industry refuses the benchmark-absent carrier`);
                }
        });

        test('the canonical copy preserves the wrapped binding\'s frozen two-key order (bindingMode first, then the entry)', () => {
                for (const fixture of [FINANCE_ACCEPTANCE_FIXTURE, HEALTHCARE_ACCEPTANCE_FIXTURE, CONSTRUCTION_ACCEPTANCE_FIXTURE]) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok);
                        assert.deepStrictEqual(Object.keys(outcome.fixture.benchmark as unknown as Record<string, unknown>), [...INDUSTRY_BENCHMARK_BINDING_SCHEMA_KEYS]);
                }
                const software = validateIndustryAcceptanceFixture(SOFTWARE_ACCEPTANCE_FIXTURE);
                assert.ok(software.ok);
                assert.strictEqual((software.fixture.benchmark as { bindingMode?: unknown }).bindingMode, undefined, 'the base-registry binding stays the plain eight-key entry shape');
        });
});

// --- the content census at the declared bar (the DH-GAP-2 content deepening, per industry) ------------------------

suite('acceptanceContract · THE CONTENT CENSUS at the declared censused representativeness bar (the DH-GAP-2 content deepening)', () => {
        interface CensusShape {
                readonly industry: string;
                readonly roleKeys: readonly string[];
                readonly terms: readonly string[];
                readonly taskKeys: readonly string[];
                readonly bodyKeys: readonly string[];
                readonly packKeys: readonly string[];
                readonly profileKeys: readonly string[];
        }

        function censusOf(fixture: IndustryAcceptanceFixture): CensusShape {
                return {
                        industry: fixture.industry,
                        roleKeys: fixture.roles.map((role) => role.roleKey),
                        terms: fixture.terms.map((term) => term.term),
                        taskKeys: fixture.tasks.map((task) => task.taskKey),
                        bodyKeys: fixture.bodies.map((body) => body.bodyKey),
                        packKeys: fixture.packs.map((pack) => pack.packKey),
                        profileKeys: fixture.profiles.map((profile) => profile.profileKey),
                };
        }

        /** The shared depth pins: the declared bar's counts, the unique domain-shaped keys, the internal-ref closure and the per-entry ref floors. */
        function assertCensusDepth(fixture: IndustryAcceptanceFixture, expected: CensusShape): void {
                const industry = fixture.industry;
                assert.strictEqual(fixture.roles.length, 6, `${industry}: six roles`);
                assert.strictEqual(fixture.terms.length, 10, `${industry}: ten terms`);
                assert.strictEqual(fixture.tasks.length, 4, `${industry}: four tasks`);
                assert.strictEqual(fixture.bodies.length, 4, `${industry}: four bodies`);
                assert.strictEqual(fixture.packs.length, 4, `${industry}: four packs`);
                assert.strictEqual(fixture.profiles.length, 2, `${industry}: two profiles`);
                assert.deepStrictEqual(fixture.roles.map((role) => role.roleKey), [...expected.roleKeys], `${industry}: the six role keys by name`);
                assert.deepStrictEqual(fixture.terms.map((term) => term.term), [...expected.terms], `${industry}: the ten terms by name`);
                assert.deepStrictEqual(fixture.tasks.map((task) => task.taskKey), [...expected.taskKeys], `${industry}: the four task keys by name`);
                assert.deepStrictEqual(fixture.bodies.map((body) => body.bodyKey), [...expected.bodyKeys], `${industry}: the four body keys by name`);
                assert.deepStrictEqual(fixture.packs.map((pack) => pack.packKey), [...expected.packKeys], `${industry}: the four pack keys by name`);
                assert.deepStrictEqual(fixture.profiles.map((profile) => profile.profileKey), [...expected.profileKeys], `${industry}: the two profile keys by name`);
                for (const task of fixture.tasks) {
                        assert.ok(task.termRefs.length >= 2, `${industry}/${task.taskKey}: at least two termRefs (the domain-shaped composition)`);
                        for (const termRef of task.termRefs) {
                                assert.ok(expected.terms.includes(termRef), `${industry}/${task.taskKey}: the termRef '${termRef}' resolves`);
                        }
                }
                for (const body of fixture.bodies) {
                        assert.ok(body.roleRefs.length >= 1, `${industry}/${body.bodyKey}: at least one roleRef`);
                        for (const roleRef of body.roleRefs) {
                                assert.ok(expected.roleKeys.includes(roleRef), `${industry}/${body.bodyKey}: the roleRef '${roleRef}' resolves`);
                        }
                }
                for (const pack of fixture.packs) {
                        assert.ok(pack.bodyRefs.length >= 1, `${industry}/${pack.packKey}: at least one bodyRef`);
                        for (const bodyRef of pack.bodyRefs) {
                                assert.ok(expected.bodyKeys.includes(bodyRef), `${industry}/${pack.packKey}: the bodyRef '${bodyRef}' resolves`);
                        }
                }
                for (const profile of fixture.profiles) {
                        assert.ok(profile.permissionRefs.length >= 1 && profile.approvalTiers.length >= 1 && profile.kpiDimensions.length >= 1, `${industry}/${profile.profileKey}: the REAL vocabulary legs`);
                }
        }

        test('the software content census: the six roles / ten terms / four tasks / four bodies / four packs / two profiles by name (the doubled domain-shaped composition)', () => {
                assertCensusDepth(SOFTWARE_ACCEPTANCE_FIXTURE, {
                        industry: 'software',
                        roleKeys: ['code-reviewer', 'feature-implementer', 'release-verifier', 'build-engineer', 'test-automation-engineer', 'incident-responder'],
                        terms: ['se.regression-suite', 'se.merge-queue', 'se.flaky-test', 'se.release-candidate', 'se.code-review', 'se.build-pipeline', 'se.canary-deploy', 'se.test-coverage-gap', 'se.incident-postmortem', 'se.api-contract'],
                        taskKeys: ['regression-fix', 'feature-rollout', 'harden-test-coverage', 'respond-production-incident'],
                        bodyKeys: ['triage-engineer', 'release-guardian', 'platform-reliability-desk', 'quality-enablement-desk'],
                        packKeys: ['core-dev-pack', 'release-verification-pack', 'platform-operations-pack', 'test-automation-pack'],
                        profileKeys: ['default-engineering', 'platform-reliability'],
                });
        });

        test('the finance content census: the six roles / ten terms / four tasks / four bodies / four packs / two profiles by name', () => {
                assertCensusDepth(FINANCE_ACCEPTANCE_FIXTURE, {
                        industry: 'finance',
                        roleKeys: ['mortgage-underwriter', 'credit-analyst', 'compliance-reporter', 'reconciliation-analyst', 'treasury-desk-operator', 'payments-ops-specialist'],
                        terms: ['fin.loan-to-value', 'fin.credit-memo', 'fin.kyc-check', 'fin.risk-weight', 'fin.disclosure-statement', 'fin.reconciliation-break', 'fin.nostro-account', 'fin.payment-retry-budget', 'fin.subledger', 'fin.exception-queue'],
                        taskKeys: ['underwrite-mortgage', 'file-compliance-report', 'investigate-reconciliation-break', 'triage-payment-failures'],
                        bodyKeys: ['underwriting-desk', 'compliance-desk', 'reconciliation-desk', 'payments-operations-desk'],
                        packKeys: ['underwriting-pack', 'regulatory-reporting-pack', 'reconciliation-ops-pack', 'payments-triage-pack'],
                        profileKeys: ['default-lending', 'payments-operations'],
                });
        });

        test('the healthcare content census: the six roles / ten terms / four tasks / four bodies / four packs / two profiles by name', () => {
                assertCensusDepth(HEALTHCARE_ACCEPTANCE_FIXTURE, {
                        industry: 'healthcare',
                        roleKeys: ['clinical-documenter', 'billing-coder', 'audit-reviewer', 'care-coordinator', 'utilization-review-nurse', 'release-of-information-officer'],
                        terms: ['hc.chief-complaint', 'hc.icd-code', 'hc.prior-authorization', 'hc.discharge-summary', 'hc.audit-trail', 'hc.coverage-determination', 'hc.encounter-note', 'hc.claim-denial', 'hc.consent-form', 'hc.clinical-pathway'],
                        taskKeys: ['document-encounter', 'prepare-billing-claim', 'coordinate-care-transitions', 'appeal-claim-denial'],
                        bodyKeys: ['clinical-documentation-desk', 'revenue-cycle-desk', 'care-coordination-desk', 'health-information-desk'],
                        packKeys: ['clinical-documentation-pack', 'revenue-cycle-pack', 'care-coordination-pack', 'health-information-pack'],
                        profileKeys: ['default-clinical', 'care-coordination'],
                });
        });

        test('the construction content census: the six roles / ten terms / four tasks / four bodies / four packs / two profiles by name', () => {
                assertCensusDepth(CONSTRUCTION_ACCEPTANCE_FIXTURE, {
                        industry: 'construction',
                        roleKeys: ['site-inspector', 'quantity-surveyor', 'safety-compliance-officer', 'submittal-coordinator', 'schedule-planner', 'commissioning-agent'],
                        terms: ['con.site-diary', 'con.bill-of-quantities', 'con.change-order', 'con.safety-violation', 'con.snag-list', 'con.submittal-package', 'con.lookahead-schedule', 'con.request-for-information', 'con.material-certification', 'con.punch-list-closure'],
                        taskKeys: ['record-site-inspection', 'prepare-valuation', 'coordinate-submittal-review', 'analyze-schedule-impact'],
                        bodyKeys: ['site-supervision-desk', 'commercial-desk', 'submittal-review-desk', 'planning-desk'],
                        packKeys: ['site-operations-pack', 'commercial-surveying-pack', 'submittal-coordination-pack', 'schedule-planning-pack'],
                        profileKeys: ['default-site-delivery', 'commercial-controls'],
                });
        });

        test('the census pins agree with the walked fixture (the walk is green over exactly this content)', () => {
                for (const fixture of Object.values(LANE_FIXTURES) as unknown as IndustryAcceptanceFixture[]) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok, `${fixture.industry}: the deepened content is green`);
                        assert.deepStrictEqual(censusOf(outcome.fixture), censusOf(fixture), `${fixture.industry}: the canonical copy preserves the deepened content`);
                }
        });
});

suite('acceptanceContract · the industry verdict row walk + the verdict vocabularies', () => {
        test('the frozen leg-verdict / benchmark-status / UI-section verdict vocabularies', () => {
                assert.deepStrictEqual([...ACCEPTANCE_LEG_VERDICTS], ['complete', 'refused']);
                assert.deepStrictEqual([...ACCEPTANCE_BENCHMARK_STATUSES], ['evaluated', 'gap-registered']);
                assert.deepStrictEqual([...ACCEPTANCE_UI_SECTION_VERDICTS], ['populated', 'not-composed']);
        });

        test('the fourteen-key industry verdict schema, the census keys and the overall-verdict keys (the frozen serialization orders)', () => {
                assert.deepStrictEqual([...INDUSTRY_VERDICT_SCHEMA_KEYS], [
                        'industry', 'contractVersion', 'journey', 'roleComposition', 'workflows', 'policies', 'evidence',
                        'approvals', 'uiBehavior', 'capabilityGaps', 'taskExecution', 'benchmarkStatus', 'composedRecordVersions', 'expectedGaps',
                ]);
                assert.deepStrictEqual([...COMPOSITION_CENSUS_SCHEMA_KEYS], ['labContractsVersion', 'rows', 'industriesServed', 'sharedKitConstructions', 'fixturesArePureData']);
                assert.deepStrictEqual([...OVERALL_VERDICT_SCHEMA_KEYS], ['verdict', 'industriesComplete', 'industriesRefused', 'gapRowsRegistered', 'refusalReason', 'refusalLaw', 'refusalMessage']);
                assert.deepStrictEqual([...HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS], ['version', 'industries', 'compositionCensus', 'gapLedger', 'overallVerdict', 'disclosures']);
        });

        test('the twelve frozen census family keys in the registry order (DH-001..DH-012)', () => {
                assert.deepStrictEqual([...COMPOSITION_VERSION_FAMILY_KEYS], [
                        'domain-harness', 'onboarding', 'roles', 'ontology', 'templates', 'bodies', 'packs', 'profiles',
                        'benchmarks', 'projections', 'activation', 'optimization',
                ]);
        });

        test('the row walk refuses an unknown key, a missing key, a foreign version and a non-member industry', () => {
                const row = JSON.parse(rowJson());
                row.extraKey = true;
                assert.strictEqual(validateIndustryVerdictRow(row).ok, false);
                const missing = JSON.parse(rowJson());
                delete missing.evidence;
                assert.ok(!validateIndustryVerdictRow(missing).ok);
                const version = JSON.parse(rowJson());
                version.contractVersion = '9.9.9';
                assert.ok(!validateIndustryVerdictRow(version).ok);
                const industry = JSON.parse(rowJson());
                industry.industry = 'not-an-industry';
                assert.ok(!validateIndustryVerdictRow(industry).ok);
        });

        test('the row walk refuses a malformed leg, a foreign benchmark status and a foreign census map', () => {
                const leg = JSON.parse(rowJson());
                leg.policies = { verdict: 'maybe' };
                assert.ok(!validateIndustryVerdictRow(leg).ok);
                const status = JSON.parse(rowJson());
                status.benchmarkStatus = 'maybe';
                assert.ok(!validateIndustryVerdictRow(status).ok);
                const versions = JSON.parse(rowJson());
                versions.composedRecordVersions = { 'domain-harness': '1.0.0' };
                assert.ok(!validateIndustryVerdictRow(versions).ok);
        });

        test('THE CLOSED-ROW LAW re-proven from the row alone: a CLOSED ledger row in expectedGaps is refused (the closures are recorded IN the ledger rows)', () => {
                for (const closedKey of ACCEPTANCE_CLOSED_GAP_KEYS) {
                        const row = JSON.parse(rowJson());
                        assert.ok(validateIndustryVerdictRow(row).ok);
                        const closedRow = HARNESS_ACCEPTANCE_GAP_LEDGER.find((ledgerRow) => ledgerRow.gapKey === closedKey);
                        assert.ok(closedRow !== undefined);
                        row.expectedGaps = [...(row.expectedGaps as unknown[]), JSON.parse(JSON.stringify(closedRow))];
                        const outcome = validateIndustryVerdictRow(row);
                        assert.ok(!outcome.ok, `the closed row '${closedKey}' must not ride a verdict row`);
                        assert.ok(outcome.message.includes('CLOSED ledger row'));
                }
        });
});

/** A minimal structurally-green industry verdict row (for the row-walk stations; the gap-registered status is the honest uncovered-industry state over OPEN rows only). */
function rowJson(): string {
        const versions: Record<string, string> = {};
        for (const family of COMPOSITION_VERSION_FAMILY_KEYS) {
                versions[family] = '1.0.0';
        }
        const completeLeg = { verdict: 'complete' };
        const openRow = HARNESS_ACCEPTANCE_GAP_LEDGER.find((row) => row.gapKey === 'no-production-real-harness-deployment');
        assert.ok(openRow !== undefined);
        return JSON.stringify({
                industry: 'finance',
                contractVersion: HARNESS_ACCEPTANCE_VERSION,
                journey: { ...completeLeg, journeyId: 'flauz:jrn:0000000000000001', journeyStage: 'active', harnessId: 'flauz:hrn:0000000000000002', bindingHarnessId: 'flauz:hrn:0000000000000003', harnessLifecycleEndState: 'active', approvalRecorded: true, activationRecorded: true },
                roleComposition: { ...completeLeg, roleKeys: ['a'], rolesSessionId: 'flauz:rol:0000000000000004' },
                workflows: { ...completeLeg, taskKeys: ['t'], termRefs: ['x.y'], termResolution: 'resolved' },
                policies: { ...completeLeg, profileKeys: ['p'], permissionRefs: ['read-files'], approvalTiers: ['high'] },
                evidence: { ...completeLeg, evidenceFloors: ['fixture'] },
                approvals: { ...completeLeg, approvedBy: 'a', activatedBy: 'b', recordedBeforeActivation: true },
                uiBehavior: { ...completeLeg, anchorHarnessId: 'flauz:hrn:0000000000000003', sections: [{ section: 'overview', state: 'populated', rowCount: 1 }], populatedSections: 1, notComposedSections: 0 },
                capabilityGaps: { ...completeLeg, registeredGapKeys: ['no-production-real-harness-deployment'] },
                taskExecution: { ...completeLeg, authorityState: 'active', authorityTransitionsWalked: ['draft', 'active'], closedLoopExecutions: null, closedLoopLoopClosed: null, benchmarkScores: null, benchmarkEvidenceLevel: null, executionDisclosure: 'd' },
                benchmarkStatus: 'gap-registered',
                composedRecordVersions: versions,
                expectedGaps: [openRow],
        });
}

// --- the report walk + the canonical serialization + the fail-closed parse ---------------------------------------

suite('acceptanceContract · the report walk, the canonical serialization and the fail-closed parse', () => {
        test('a structurally-green report passes the walk (the four frozen lanes, the census, the ledger, the verdict, the disclosures)', () => {
                const outcome = parseAcceptanceReport(reportBytes());
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.rejection.message);
                assert.deepStrictEqual(Object.keys(outcome.report), [...HARNESS_ACCEPTANCE_REPORT_SCHEMA_KEYS]);
        });

        test('the walk refuses: a non-object, an unknown key, a missing key, a foreign version', () => {
                assert.ok(!validateHarnessAcceptanceReport(42).ok);
                const unknown = JSON.parse(reportBytes());
                unknown.extra = true;
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(unknown)).reason, 'unknown-key');
                const missing = JSON.parse(reportBytes());
                delete missing.gapLedger;
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(missing)).reason, 'missing-key');
                const version = JSON.parse(reportBytes());
                version.version = '0.0.1';
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(version)).reason, 'version-mismatch');
        });

        test('the walk refuses: the wrong industry count, the wrong lane order, a malformed industry row', () => {
                const short = JSON.parse(reportBytes());
                short.industries = short.industries.slice(0, 3);
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(short)).reason, 'invalid-row');
                const order = JSON.parse(reportBytes());
                [order.industries[0], order.industries[1]] = [order.industries[1], order.industries[0]];
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(order)).reason, 'invalid-row');
                const malformed = JSON.parse(reportBytes());
                malformed.industries[2].journey = { verdict: 'nope' };
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(malformed)).reason, 'invalid-row');
        });

        test('the walk refuses: a census drift (rows count / lab version / identity pin / pure-data pin)', () => {
                const rows = JSON.parse(reportBytes());
                rows.compositionCensus.rows = rows.compositionCensus.rows.slice(0, 11);
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(rows)).reason, 'invalid-row');
                const lab = JSON.parse(reportBytes());
                lab.compositionCensus.labContractsVersion = '0.0.0';
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(lab)).reason, 'invalid-row');
                const identity = JSON.parse(reportBytes());
                identity.compositionCensus.rows[0].identicalAcrossIndustries = false;
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(identity)).reason, 'invalid-row');
                const pure = JSON.parse(reportBytes());
                pure.compositionCensus.fixturesArePureData = false;
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(pure)).reason, 'invalid-row');
        });

        test('the walk refuses: a gap-ledger drift (count / a drifted row) and a verdict-coherence breach', () => {
                const count = JSON.parse(reportBytes());
                count.gapLedger = count.gapLedger.slice(0, 5);
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(count)).reason, 'invalid-row');
                const drifted = JSON.parse(reportBytes());
                drifted.gapLedger[0].description = 'paraphrased';
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(drifted)).reason, 'invalid-row');
                const incoherent = JSON.parse(reportBytes());
                incoherent.overallVerdict.industriesComplete = 3;
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(incoherent)).reason, 'invalid-row');
        });

        test('the walk refuses a drifted disclosure list (carried VERBATIM)', () => {
                const mutated = JSON.parse(reportBytes());
                mutated.disclosures[0] = 'paraphrased disclosure';
                assert.strictEqual(mustRefuseParse(validateHarnessAcceptanceReport(mutated)).reason, 'invalid-row');
        });

        test('the canonical serialization is byte-stable (the same report serializes to the same bytes) and the round-trip is green', () => {
                const bytes = reportBytes();
                const outcome = parseAcceptanceReport(bytes);
                assert.ok(outcome.ok);
                assert.strictEqual(serializeAcceptanceReport(outcome.report), bytes);
                assert.strictEqual(serializeAcceptanceReport(outcome.report), serializeAcceptanceReport(JSON.parse(JSON.stringify(outcome.report))));
        });

        test('the fail-closed parse: non-string bytes, malformed JSON, and the five frozen rejection reasons', () => {
                assert.deepStrictEqual([...ACCEPTANCE_PARSE_REJECTION_REASONS], ['malformed-json', 'version-mismatch', 'unknown-key', 'missing-key', 'invalid-row']);
                assert.strictEqual(mustRefuseParse(parseAcceptanceReport(undefined as never)).reason, 'malformed-json');
                assert.strictEqual(mustRefuseParse(parseAcceptanceReport('')).reason, 'malformed-json');
                assert.strictEqual(mustRefuseParse(parseAcceptanceReport('not json')).reason, 'malformed-json');
        });

        test('the frozen disclosure list carries the five laws verbatim (the DH-GAP-2 wave re-worded the evidence law and ADDED the content-census law)', () => {
                assert.strictEqual(ACCEPTANCE_DISCLOSURES.length, 5);
                assert.ok(ACCEPTANCE_DISCLOSURES[0].includes('curated fixture-level acceptance content'));
                assert.ok(ACCEPTANCE_DISCLOSURES[1].includes('LAB closedLoop fixture execution'));
                assert.ok(ACCEPTANCE_DISCLOSURES[1].includes('combined-catalog composition over the REAL imported lab extension registry lookups'));
                assert.ok(ACCEPTANCE_DISCLOSURES[2].includes('the industries differ only in data'));
                assert.ok(ACCEPTANCE_DISCLOSURES[3].includes('fail-closed'));
                assert.ok(ACCEPTANCE_DISCLOSURES[4].includes('declared censused representativeness bar'));
                assert.ok(ACCEPTANCE_DISCLOSURES[4].includes('six roles, ten terms, four tasks, four bodies, four packs and two profiles'));
                assert.ok(ACCEPTANCE_CONTENT_CENSUS_DISCLOSURE.includes('never a claim of comprehensive domain truth'));
        });
});

/** A structurally-green canonical report (four lanes; every row evaluated over the two OPEN rows - the closed rows ride the gapLedger verbatim). */
function reportBytes(): string {
        const openRows = HARNESS_ACCEPTANCE_GAP_LEDGER.filter((row) => !isAcceptanceClosedGapKey(row.gapKey));
        const rows = ACCEPTANCE_INDUSTRIES.map((industry) => {
                const row = JSON.parse(rowJson());
                row.industry = industry;
                row.benchmarkStatus = 'evaluated';
                row.expectedGaps = openRows.map((gapRow) => ({ gapKey: gapRow.gapKey, description: gapRow.description, evidenceLevel: gapRow.evidenceLevel, owner: gapRow.owner }));
                row.capabilityGaps = { verdict: 'complete', registeredGapKeys: openRows.map((gapRow) => gapRow.gapKey) };
                return row;
        });
        const report = {
                version: HARNESS_ACCEPTANCE_VERSION,
                industries: rows,
                compositionCensus: {
                        labContractsVersion: LAB_CONTRACTS_VERSION,
                        rows: COMPOSITION_VERSION_FAMILY_KEYS.map((family) => ({ family, contractVersion: '1.0.0', identicalAcrossIndustries: true })),
                        industriesServed: [...ACCEPTANCE_INDUSTRIES],
                        sharedKitConstructions: ['activation-kit', 'projections-kit', 'optimization-kit'],
                        fixturesArePureData: true,
                },
                gapLedger: HARNESS_ACCEPTANCE_GAP_LEDGER.map((row) => ({ gapKey: row.gapKey, description: row.description, evidenceLevel: row.evidenceLevel, owner: row.owner })),
                overallVerdict: { verdict: 'complete', industriesComplete: 4, industriesRefused: 0, gapRowsRegistered: 6, refusalReason: null, refusalLaw: null, refusalMessage: null },
                disclosures: [...ACCEPTANCE_DISCLOSURES],
        };
        return serializeAcceptanceReport(report);
}

// --- the determinism greps ---------------------------------------------------------------------------------------

suite('acceptanceContract · THE DETERMINISM LAW (the in-suite source greps)', () => {
        const SOURCES = [CONTRACT_SOURCE, RUNNER_SOURCE, ...INDUSTRY_SOURCES];

        test('no Math.random / Date.now / new Date( / process.env outside the law-comment lines', () => {
                for (const source of SOURCES) {
                        const lines = source.split('\n');
                        for (let i = 0; i < lines.length; i += 1) {
                                const line = lines[i];
                                for (const pattern of ['Math.random', 'Date.now', 'new Date(', 'process.env']) {
                                        if (line.includes(pattern)) {
                                                assert.ok(
                                                        line.trim().startsWith('*') || line.trim().startsWith('/*') || line.trim().startsWith('//'),
                                                        `the determinism violation at line ${i + 1}: ${line.trim()}`,
                                                );
                                        }
                                }
                        }
                }
        });
});
