/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see LICENSE in the repository root for
 * additional information.
 *
 * DH-013 acceptance contract battery: the version cross-pins (this
 * family + the TWELVE prior family versions + the REAL
 * LAB_CONTRACTS_VERSION, all imported by reference and pinned
 * equal), the frozen acceptance lane and the honest gap ledger (the
 * six rows verbatim), the curated-fixture walk (THE STRICT-SCHEMA
 * LAW, the REAL vocabulary stations, the OWNING families' REAL entry
 * validators, THE INTERNAL-REF LAW, THE CURATED CENSUS LAW, THE
 * REGISTRY FACT LAW and THE GAP LAWS - every fail-closed station
 * typed), the report walk + the canonical serialization + the
 * fail-closed parse, and the in-suite determinism greps.
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
        HARNESS_ACCEPTANCE_GAP_LEDGER,
        INDUSTRY_ACCEPTANCE_FIXTURE_SCHEMA_KEYS,
        validateIndustryAcceptanceFixture,
        FIXTURE_REJECTION_REASONS,
        isFixtureRejectionReason,
        FIXTURE_ENTRY_CENSUS,
        ACCEPTANCE_LEG_VERDICTS,
        ACCEPTANCE_BENCHMARK_STATUSES,
        ACCEPTANCE_UI_SECTION_VERDICTS,
        INDUSTRY_VERDICT_SCHEMA_KEYS,
        COMPOSITION_VERSION_FAMILY_KEYS,
        COMPOSITION_CENSUS_SCHEMA_KEYS,
        OVERALL_VERDICT_SCHEMA_KEYS,
        ACCEPTANCE_DISCLOSURES,
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
import { LAB_CONTRACTS_VERSION as REAL_LAB } from '../../../../lab/common/labContracts.js';
import { CATALOG_PERMISSION_IDS as REAL_PERMISSIONS, CATALOG_PERMISSION_RISK_TIERS as REAL_TIERS } from '../../../../capabilities/packs/common/catalog.js';
import { PROFILES_EVIDENCE_LADDER as REAL_LADDER, PROFILES_EVAL_DIMENSIONS as REAL_DIMS } from '../../../profiles/common/profilesContract.js';
import { DOMAIN_NAVIGATION_SECTIONS as REAL_SECTIONS } from '../../../projections/common/projectionsContract.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';
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

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL registry ids. */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

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

suite('acceptanceContract · the honest gap ledger (the six frozen rows)', () => {
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

        test('the ledger rows carry the registry row\'s own descriptions verbatim (the unproven is registered, never promoted)', () => {
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER.length, 6);
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[0].description, 'the LAB task-world registry covers the SE fixture world only; finance/healthcare/construction lack industry-specific simulation worlds (the benchmark legs gap-registered)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[1].description, 'the four industry content sets are curated fixture-level acceptance content, not comprehensive domain truth');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[2].description, 'no live-provider exchange is exercised here (tracked at the INF boundary: the INF-009 canary env-gated skip)');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[3].description, 'the harness families\' evidence ceiling is fixture/simulated; production deployment of harness configurations is a future TL-A-coordinated step');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[4].description, 'the flauz-harness extension\'s runtime binding is covered by the bundle+activation gates (the flauz-lab law), not the node lane; the UI behavior is verified here at the projection-derivation level + the extension\'s own node suites');
                assert.strictEqual(HARNESS_ACCEPTANCE_GAP_LEDGER[5].description, 'the Phase C-R terminal ledger\'s three exercised-but-unresolved and two unexercised integration gaps remain tracked in the CR records (cross-referenced, not re-litigated here)');
                for (const row of HARNESS_ACCEPTANCE_GAP_LEDGER) {
                        assert.ok((PROFILES_EVIDENCE_LADDER as readonly string[]).includes(row.evidenceLevel), `the row '${row.gapKey}' carries a REAL ladder rung as its honest evidence floor`);
                        assert.ok(row.owner.length > 0);
                }
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

        test('the curated census: three roles, five terms, two tasks, two bodies, two packs, one-or-two profiles', () => {
                for (const fixture of Object.values(LANE_FIXTURES)) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok);
                        assert.strictEqual(outcome.fixture.roles.length, FIXTURE_ENTRY_CENSUS.roles.min);
                        assert.strictEqual(outcome.fixture.terms.length, FIXTURE_ENTRY_CENSUS.terms.min);
                        assert.strictEqual(outcome.fixture.tasks.length, FIXTURE_ENTRY_CENSUS.tasks.min);
                        assert.strictEqual(outcome.fixture.bodies.length, FIXTURE_ENTRY_CENSUS.bodies.min);
                        assert.strictEqual(outcome.fixture.packs.length, FIXTURE_ENTRY_CENSUS.packs.min);
                        assert.ok(outcome.fixture.profiles.length >= FIXTURE_ENTRY_CENSUS.profiles.min && outcome.fixture.profiles.length <= FIXTURE_ENTRY_CENSUS.profiles.max);
                }
        });

        test('every fixture\'s vocabularies are REAL members (size bands, work types, permissions, tiers, rungs, dims, scenario ids)', () => {
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
                        if (fixture.benchmark !== null) {
                                for (const scenarioRef of fixture.benchmark.scenarioRefs) {
                                        assert.ok(REAL_SCENARIO_IDS.includes(scenarioRef), `the scenario '${scenarioRef}' is a REAL registry id`);
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

        test('the software fixture carries the curated benchmark (bound to the REAL three SE scenarios); the other three carry the honest null', () => {
                const software = validateIndustryAcceptanceFixture(SOFTWARE_ACCEPTANCE_FIXTURE);
                assert.ok(software.ok);
                assert.ok(software.fixture.benchmark !== null);
                assert.deepStrictEqual([...(software.fixture.benchmark as unknown as { scenarioRefs: readonly string[] }).scenarioRefs], REAL_SCENARIO_IDS);
                assert.strictEqual((software.fixture.benchmark as { evidenceLevel: string }).evidenceLevel, 'fixture');
                for (const fixture of [FINANCE_ACCEPTANCE_FIXTURE, HEALTHCARE_ACCEPTANCE_FIXTURE, CONSTRUCTION_ACCEPTANCE_FIXTURE]) {
                        const outcome = validateIndustryAcceptanceFixture(fixture);
                        assert.ok(outcome.ok);
                        assert.strictEqual(outcome.fixture.benchmark, null);
                }
        });

        test('the three non-SE fixtures register the benchmark gap honestly; the software fixture does not (a false registration would be a lie)', () => {
                for (const fixture of [FINANCE_ACCEPTANCE_FIXTURE, HEALTHCARE_ACCEPTANCE_FIXTURE, CONSTRUCTION_ACCEPTANCE_FIXTURE] as unknown as IndustryAcceptanceFixture[]) {
                        assert.ok(fixture.expectedGaps.some((row) => row.gapKey === 'lab-task-worlds-coverage'), 'the world-coverage row is registered');
                }
                assert.ok(!SOFTWARE_ACCEPTANCE_FIXTURE.expectedGaps.some((row) => row.gapKey === 'lab-task-worlds-coverage'));
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

        test('a curated benchmark on a non-software fixture is the typed benchmark-industry-mismatch rejection (THE REGISTRY FACT LAW)', () => {
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                mutated.benchmark = JSON.parse(JSON.stringify(SOFTWARE_ACCEPTANCE_FIXTURE.benchmark));
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'benchmark-industry-mismatch');
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
                        ['roles', 'roleKey', 'roleKeys', 'roles', 'duplicate-key'],
                        ['terms', 'term', 'terms', 'terms', 'duplicate-key'],
                        ['tasks', 'taskKey', 'taskKeys', 'taskKeys', 'duplicate-key'],
                        ['bodies', 'bodyKey', 'bodyKeys', 'bodyKeys', 'duplicate-key'],
                        ['packs', 'packKey', 'packKeys', 'packKeys', 'duplicate-key'],
                        // the profiles' duplicate is caught by the OWNING family's REAL validator FIRST
                        // (the entry stations precede the law table - THE VERBATIM-CARRY LAW's ordering).
                        ['profiles', 'profileKey', 'profileKeys', 'profileKeys', 'invalid-profiles'],
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
                const kpiMutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                (kpiMutated.profiles as { kpiDimensions: string[] }[])[0].kpiDimensions = [];
                const kpiOutcome = validateIndustryAcceptanceFixture(kpiMutated);
                assert.ok(!kpiOutcome.ok);
                assert.strictEqual(kpiOutcome.rejection.reason, 'fixture-count-law');
                assert.ok((kpiOutcome.rejection.items as string[]).includes('fixture-count-law:kpiDimensions-union-empty'));
        });

        test('a benchmark-absent fixture without the world-coverage row is the typed gap-registration-missing rejection (the gap MUST be registered)', () => {
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                mutated.expectedGaps = (mutated.expectedGaps as { gapKey: string }[]).filter((row) => row.gapKey !== 'lab-task-worlds-coverage');
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'gap-registration-missing');
        });

        test('a benchmark-carrying fixture WITH the world-coverage row is the typed gap-registration-inconsistent rejection (a false statement)', () => {
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                const financeRow = (FINANCE_ACCEPTANCE_FIXTURE.expectedGaps as readonly { gapKey: string }[]).find((row) => row.gapKey === 'lab-task-worlds-coverage');
                mutated.expectedGaps = [...(mutated.expectedGaps as unknown[]), JSON.parse(JSON.stringify(financeRow))];
                const outcome = validateIndustryAcceptanceFixture(mutated);
                assert.ok(!outcome.ok);
                assert.strictEqual(outcome.rejection.reason, 'gap-registration-inconsistent');
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

// --- the per-industry verdict row walk ---------------------------------------------------------------------------

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

        test('THE GAP-MUST-BE-REGISTERED LAW re-proven from the row alone: a gap-registered status REQUIRES the world-coverage row', () => {
                const row = JSON.parse(rowJson());
                assert.ok(validateIndustryVerdictRow(row).ok);
                row.expectedGaps = (row.expectedGaps as { gapKey: string }[]).filter((gapRow) => gapRow.gapKey !== 'lab-task-worlds-coverage');
                const outcome = validateIndustryVerdictRow(row);
                assert.ok(!outcome.ok);
                assert.ok(outcome.message.includes('lab-task-worlds-coverage'));
        });
});

/** A minimal structurally-green industry verdict row (for the row-walk stations). */
function rowJson(): string {
        const versions: Record<string, string> = {};
        for (const family of COMPOSITION_VERSION_FAMILY_KEYS) {
                versions[family] = '1.0.0';
        }
        const completeLeg = { verdict: 'complete' };
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
                capabilityGaps: { ...completeLeg, registeredGapKeys: ['lab-task-worlds-coverage'] },
                taskExecution: { ...completeLeg, authorityState: 'active', authorityTransitionsWalked: ['draft', 'active'], closedLoopExecutions: null, closedLoopLoopClosed: null, benchmarkScores: null, benchmarkEvidenceLevel: null, executionDisclosure: 'd' },
                benchmarkStatus: 'gap-registered',
                composedRecordVersions: versions,
                expectedGaps: [{ gapKey: 'lab-task-worlds-coverage', description: 'the LAB task-world registry covers the SE fixture world only; finance/healthcare/construction lack industry-specific simulation worlds (the benchmark legs gap-registered)', evidenceLevel: 'fixture', owner: 'TL-B (the Lab lane)' }],
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

        test('the frozen disclosure list carries the four laws verbatim', () => {
                assert.strictEqual(ACCEPTANCE_DISCLOSURES.length, 4);
                assert.ok(ACCEPTANCE_DISCLOSURES[0].includes('curated fixture-level acceptance content'));
                assert.ok(ACCEPTANCE_DISCLOSURES[1].includes('LAB closedLoop fixture execution'));
                assert.ok(ACCEPTANCE_DISCLOSURES[2].includes('the industries differ only in data'));
                assert.ok(ACCEPTANCE_DISCLOSURES[3].includes('fail-closed'));
        });
});

/** A structurally-green canonical report (four lanes; the software row evaluated, the other three gap-registered). */
function reportBytes(): string {
        const versions: Record<string, string> = {};
        for (const family of COMPOSITION_VERSION_FAMILY_KEYS) {
                versions[family] = '1.0.0';
        }
        const softwareRow = JSON.parse(rowJson());
        softwareRow.industry = 'software';
        softwareRow.benchmarkStatus = 'evaluated';
        softwareRow.expectedGaps = [];
        const rows = [softwareRow, JSON.parse(rowJson()), JSON.parse(rowJson()), JSON.parse(rowJson())];
        rows[1].industry = 'finance';
        rows[2].industry = 'healthcare';
        rows[3].industry = 'construction';
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
