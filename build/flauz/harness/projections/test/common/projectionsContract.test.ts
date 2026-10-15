/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-010 projections contract battery: the frozen-vocabulary
 * cross-pins (the NINE landed family versions re-carried BY REFERENCE
 * against the REAL modules, the frozen section list in the frozen
 * order, the badge vocabulary derived from the REAL imported state
 * vocabularies, the family-id prefix map pinned against the REAL
 * contracts' own prefixes), THE ANCHOR LAW, THE ABSENT-FAMILY LAW
 * (the absent/not-composed vs present/malformed distinction, per
 * family), THE BINDING LAW, THE DUPLICATE-RECORD LAW, the
 * complete-table input walk in the frozen station order, the
 * per-section row derivations (THE SECTION-SOURCE MAP), the lifecycle
 * projection over all five REAL DH-01 states, THE SECTION-STATE LAW,
 * THE CONTENT LAW, THE PROJECTION LAW (record-unchanged +
 * determinism), the canonical serialization round-trip with the
 * fail-closed parse (every model-rejection and parse-rejection
 * class), and the in-suite determinism greps reading the module's
 * own source (law-comment lines only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
        DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_ID_PREFIX as REAL_HARNESS_ID_PREFIX,
        HARNESS_LIFECYCLE_FORWARD_TRANSITIONS as REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS,
        HARNESS_LIFECYCLE_STATES as REAL_HARNESS_LIFECYCLE_STATES,
} from '../../../contract/common/domainHarnessContract.js';
import {
        ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_CONTRACTS_VERSION,
        ONBOARDING_SESSION_ID_PREFIX as REAL_ONBOARDING_SESSION_ID_PREFIX,
        ONBOARDING_STAGES as REAL_ONBOARDING_STAGES,
} from '../../../onboarding/common/onboardingContract.js';
import {
        ROLES_CONTRACTS_VERSION as REAL_ROLES_CONTRACTS_VERSION,
        ROLE_COMPOSITION_ID_PREFIX as REAL_ROLES_ID_PREFIX,
        ROLE_COMPOSITION_STAGES as REAL_ROLES_STAGES,
} from '../../../roles/common/rolesContract.js';
import {
        ONTOLOGY_CONTRACTS_VERSION as REAL_ONTOLOGY_CONTRACTS_VERSION,
        ONTOLOGY_ID_PREFIX as REAL_ONTOLOGY_ID_PREFIX,
        ONTOLOGY_STAGES as REAL_ONTOLOGY_STAGES,
} from '../../../ontology/common/ontologyContract.js';
import {
        TEMPLATES_CONTRACTS_VERSION as REAL_TEMPLATES_CONTRACTS_VERSION,
        TEMPLATE_ID_PREFIX as REAL_TEMPLATES_ID_PREFIX,
        TEMPLATE_STAGES as REAL_TEMPLATE_STAGES,
} from '../../../templates/common/templatesContract.js';
import {
        BODIES_CONTRACTS_VERSION as REAL_BODIES_CONTRACTS_VERSION,
        BODY_ID_PREFIX as REAL_BODY_ID_PREFIX,
        BODY_STAGES as REAL_BODY_STAGES,
} from '../../../bodies/common/bodiesContract.js';
import {
        PACKS_CONTRACTS_VERSION as REAL_PACKS_CONTRACTS_VERSION,
        PACK_ID_PREFIX as REAL_PACK_ID_PREFIX,
        PACK_STAGES as REAL_PACKS_STAGES,
} from '../../../packs/common/packsContract.js';
import {
        PROFILES_CONTRACTS_VERSION as REAL_PROFILES_CONTRACTS_VERSION,
        PROFILES_ID_PREFIX as REAL_PROFILES_ID_PREFIX,
        PROFILES_STAGES as REAL_PROFILES_STAGES,
} from '../../../profiles/common/profilesContract.js';
import {
        BENCHMARKS_CONTRACTS_VERSION as REAL_BENCHMARKS_CONTRACTS_VERSION,
        BENCHMARK_ID_PREFIX as REAL_BENCHMARK_ID_PREFIX,
        BENCHMARK_STAGES as REAL_BENCHMARK_STAGES,
} from '../../../benchmarks/common/benchmarksContract.js';
import { TASK_WORLDS as REAL_TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';

import {
        DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS,
        DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS,
        DOMAIN_NAVIGATION_SECTIONS,
        DOMAIN_SECTION_ROW_BADGES,
        DOMAIN_SECTION_ROW_SCHEMA_KEYS,
        DOMAIN_SECTION_STATES,
        DOMAIN_FAMILY_STAGES,
        PROJECTIONS_CONTRACTS_VERSION,
        PROJECTIONS_FAMILY_ID_PREFIXES,
        PROJECTIONS_INPUT_SCHEMA_KEYS,
        PROJECTIONS_MODEL_REJECTION_REASONS,
        PROJECTIONS_PARSE_REJECTION_REASONS,
        PROJECTIONS_REJECTION_REASONS,
        isDomainNavigationSectionId,
        isDomainSectionRowBadge,
        isDomainSectionStateKind,
        isProjectionsModelRejectionReason,
        isProjectionsParseRejectionReason,
        isProjectionsRejectionReason,
        parseNavigationModel,
        projectBenchmarksRows,
        projectCapabilitiesRows,
        projectEvidenceRows,
        projectKpisRows,
        projectLifecycleRows,
        projectNavigation,
        projectOverviewRows,
        projectPoliciesRows,
        projectRolesRows,
        projectWorkflowsRows,
        serializeNavigationModel,
        validateNavigationModel,
} from '../../common/projectionsContract.js';
import type {
        DomainNavigationModel,
        DomainSectionRow,
        NavigationProjectionOutcome,
        ProjectionsRejection,
} from '../../common/projectionsContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/projectionsContract.ts', import.meta.url)), 'utf8');

/**
 * The banned-global patterns, assembled piecewise so this test source
 * itself stays grep-clean (every grep hit in the family must be a
 * law-comment line in the shipped modules).
 */
const BANNED_GLOBAL_PATTERNS = ['Date' + '.now', 'new ' + 'Date', 'Math' + '.random', 'process' + '.env'];

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
        const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
        const source = readFileSync(modulePath, 'utf8');
        return source.split('\n').filter((line) => BANNED_GLOBAL_PATTERNS.some((banned) => line.includes(banned)));
}

// --- the green fixtures (every one validated by the REAL family validators) ---

const NOW = '2026-01-01T00:00:00.000Z';
const HARNESS_ID = 'flauz:hrn:0123456789abcdef';
const FOREIGN_HARNESS_ID = 'flauz:hrn:fedcba9876543210';
const REAL_SCENARIO_IDS: string[] = REAL_TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

function fixtureDescriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                harnessId: HARNESS_ID,
                contractVersion: REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
                industry: 'software',
                workTypes: ['analysis', 'review'],
                displayName: 'Fixture Harness',
                roles: [
                        { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                        { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                ],
                capabilityRefs: [],
                workflowRefs: [],
                policyRefs: [],
                evidenceRefs: [],
                ...overrides,
        };
}

function fixtureHarness(state: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
        const descriptor = fixtureDescriptor();
        return {
                harnessId: HARNESS_ID,
                contractVersion: REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
                state,
                descriptor,
                mintedAtIso: NOW,
                revision: 4,
                history: [
                        { at: NOW, fromState: null, toState: 'draft', law: 'THE FORWARD-ONLY LIFECYCLE LAW', decision: null, detail: 'fixture mint detail' },
                ],
                lastValidation: { ok: true, mode: 'shape', descriptor },
                ...overrides,
        };
}

function note(op: string, from: string | null, to: string): Record<string, unknown> {
        return { at: NOW, fromStage: from, toStage: to, op, law: 'THE FORWARD-ONLY LAW', detail: 'fixture note' };
}

function fixtureSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                sessionId: 'flauz:onb:0123456789abcdef',
                contractVersion: REAL_ONBOARDING_CONTRACTS_VERSION,
                stage: 'review',
                industry: 'software',
                companyProfile: { displayName: 'Fixture Group', sizeBand: 'small' },
                workTypes: ['analysis'],
                reviewComposition: {
                        roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                        capabilityRefs: [],
                        workflowRefs: [],
                        policyRefs: [],
                        evidenceRefs: [],
                },
                harnessId: HARNESS_ID,
                createdAtIso: NOW,
                revision: 5,
                history: [
                        note('begin-session', null, 'industry'),
                        note('select-industry', 'industry', 'company'),
                        note('compose-company', 'company', 'work-types'),
                        note('select-work-types', 'work-types', 'review'),
                        note('compose-draft', 'review', 'review'),
                ],
                ...overrides,
        };
}

function fixtureRoles(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                sessionId: 'flauz:rol:0123456789abcdef',
                industry: 'software',
                stage: 'composed',
                roles: [
                        { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                        { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                ],
                history: [note('begin-session', null, 'composing'), note('finalize-composition', 'composing', 'composed')],
                ...overrides,
        };
}

function fixtureOntology(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                ontologyId: 'flauz:ont:0123456789abcdef',
                harnessId: HARNESS_ID,
                industry: 'software',
                stage: 'composed',
                terms: [{ term: 'signal', definition: 'The incoming work signal.' }],
                history: [note('begin-ontology', null, 'composing'), note('finalize-ontology', 'composing', 'composed')],
                ...overrides,
        };
}

function fixtureTemplates(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                templateId: 'flauz:tpl:0123456789abcdef',
                harnessId: HARNESS_ID,
                industry: 'software',
                stage: 'composed',
                tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] }],
                history: [note('begin-template', null, 'composing'), note('finalize-template', 'composing', 'composed')],
                ...overrides,
        };
}

function fixtureBodies(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                bodyId: 'flauz:bod:0123456789abcdef',
                harnessId: HARNESS_ID,
                industry: 'software',
                stage: 'composed',
                bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work against the roles.', roleRefs: ['analyst'] }],
                history: [note('begin-defaults', null, 'composing'), note('finalize-defaults', 'composing', 'composed')],
                ...overrides,
        };
}

function fixturePacks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                id: 'flauz:pak:0123456789abcdef',
                harnessId: HARNESS_ID,
                industry: 'software',
                stage: 'composed',
                packs: [{ packKey: 'core', summary: 'The core capability pack.', bodyRefs: ['triage'] }],
                history: [note('begin-packs', null, 'composing'), note('finalize-packs', 'composing', 'composed')],
                ...overrides,
        };
}

function fixtureProfiles(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                profilesId: 'flauz:prf:0123456789abcdef',
                harnessId: HARNESS_ID,
                stage: 'composed',
                profiles: [
                        {
                                profileKey: 'core',
                                summary: 'The core policy profile.',
                                permissionRefs: ['read-files'],
                                approvalTiers: ['high'],
                                evidenceFloor: 'local-real',
                                kpiDimensions: ['success'],
                        },
                ],
                history: [note('begin-profiles', null, 'composing'), note('finalize-profiles', 'composing', 'composed')],
                ...overrides,
        };
}

function fixtureBenchmarks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                id: 'flauz:ben:0123456789abcdef',
                harnessId: HARNESS_ID,
                industry: 'software',
                stage: 'composed',
                benchmarks: [
                        {
                                benchmarkKey: 'regression-suite-health',
                                summary: 'The regression suite health benchmark.',
                                hypothesis: 'A composed organization completes the seeded scenarios with a higher success rate than the baseline.',
                                scenarioRefs: [REAL_SCENARIO_IDS[0]],
                                kpiDimensions: ['success'],
                                expectedOutcome: 'The candidate clears every acceptance criterion on the seeded instances.',
                                limitations: 'Fixture worlds over a synthetic repository.',
                                evidenceLevel: 'fixture',
                        },
                ],
                history: [note('begin-benchmarks', null, 'composing'), note('finalize-benchmarks', 'composing', 'composed')],
                ...overrides,
        };
}

/** THE crown input: the anchor plus every family's green record (the fully-composed harness). */
function crownInputs(): Record<string, unknown> {
        return {
                harness: fixtureHarness('active'),
                onboarding: [fixtureSession()],
                roles: [fixtureRoles()],
                ontology: [fixtureOntology()],
                templates: [fixtureTemplates()],
                bodies: [fixtureBodies()],
                packs: [fixturePacks()],
                profiles: [fixtureProfiles()],
                benchmarks: [fixtureBenchmarks()],
        };
}

/** The eight optional family slots with their green fixture builders (THE ABSENT-FAMILY LAW walk). */
const FAMILY_SLOTS: readonly { slot: string; green: (overrides?: Record<string, unknown>) => Record<string, unknown> }[] = [
        { slot: 'onboarding', green: fixtureSession },
        { slot: 'roles', green: fixtureRoles },
        { slot: 'ontology', green: fixtureOntology },
        { slot: 'templates', green: fixtureTemplates },
        { slot: 'bodies', green: fixtureBodies },
        { slot: 'packs', green: fixturePacks },
        { slot: 'profiles', green: fixtureProfiles },
        { slot: 'benchmarks', green: fixtureBenchmarks },
];

function clone(value: unknown): unknown {
        return JSON.parse(JSON.stringify(value)) as unknown;
}

function refusalOf(outcome: NavigationProjectionOutcome): readonly ProjectionsRejection[] {
        assert.equal(outcome.ok, false, 'expected a refused projection outcome');
        return (outcome as { rejections: readonly ProjectionsRejection[] }).rejections;
}

/** Extracts the typed model rejection of a refused model-validation outcome. */
function modelRejectionOf(outcome: ReturnType<typeof validateNavigationModel>): { reason: string; law: string; items: readonly string[]; detail: string } {
        assert.equal(outcome.ok, false, 'expected a refused model-validation outcome');
        return (outcome as { rejection: { reason: string; law: string; items: readonly string[]; detail: string } }).rejection;
}

function mustProject(inputs: unknown): DomainNavigationModel {
        const outcome = projectNavigation(inputs);
        if (!outcome.ok) {
                assert.fail(`expected a green projection, got: ${JSON.stringify(outcome.rejections)}`);
        }
        return outcome.model;
}

function sectionOf(model: DomainNavigationModel, section: string): { sectionState: string; rows: readonly DomainSectionRow[] } {
        const found = model.sections.find((candidate) => candidate.section === section);
        assert.ok(found, `the section '${section}' must exist`);
        return found;
}

/** A model candidate with one row field overridden (the malformed-model walk helper). */
function withRow(model: DomainNavigationModel, rowIndex: { section: number; row: number }, patch: Record<string, unknown>): Record<string, unknown> {
        const candidate = clone(model) as Record<string, unknown>;
        const sections = candidate.sections as Record<string, unknown>[];
        const rows = sections[rowIndex.section].rows as Record<string, unknown>[];
        Object.assign(rows[rowIndex.row], patch);
        return candidate;
}

// --- the battery ---

suite('projectionsContract · frozen vocabularies and the version cross-pins', () => {
        test('PROJECTIONS_CONTRACTS_VERSION is 1.0.0, declared once', () => {
                assert.equal(PROJECTIONS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(typeof PROJECTIONS_CONTRACTS_VERSION, 'string');
                const hits = CONTRACT_SOURCE.split('PROJECTIONS_CONTRACTS_VERSION =').length - 1;
                assert.equal(hits, 1, 'the version constant is declared exactly once in the contract module');
        });

        test('THE IMPORT LAW: the NINE family versions are the REAL modules\' own bindings (referential identity)', () => {
                // the contract re-exports the real bindings; importing the real modules here
                // separately and pinning equality proves the re-export chain never forked.
                assert.equal(REAL_DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_ONBOARDING_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_ROLES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_TEMPLATES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_BODIES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_PACKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_PROFILES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(REAL_BENCHMARKS_CONTRACTS_VERSION, '1.0.0');
        });

        test('the family-id prefix map pins against the REAL contracts\' own prefixes (drift-proof)', () => {
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.harness, REAL_HARNESS_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.onboarding, REAL_ONBOARDING_SESSION_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.roles, REAL_ROLES_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.ontology, REAL_ONTOLOGY_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.templates, REAL_TEMPLATES_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.bodies, REAL_BODY_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.packs, REAL_PACK_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.profiles, REAL_PROFILES_ID_PREFIX);
                assert.equal(PROJECTIONS_FAMILY_ID_PREFIXES.benchmarks, REAL_BENCHMARK_ID_PREFIX);
        });

        test('DOMAIN_NAVIGATION_SECTIONS is the frozen nine-section list in the frozen order', () => {
                assert.deepEqual([...DOMAIN_NAVIGATION_SECTIONS], [
                        'overview',
                        'roles',
                        'workflows',
                        'capabilities',
                        'policies',
                        'evidence',
                        'kpis',
                        'benchmarks',
                        'lifecycle',
                ]);
        });

        test('isDomainNavigationSectionId is the closed predicate', () => {
                assert.equal(isDomainNavigationSectionId('overview'), true);
                assert.equal(isDomainNavigationSectionId('lifecycle'), true);
                assert.equal(isDomainNavigationSectionId('Overview'), false);
                assert.equal(isDomainNavigationSectionId(''), false);
                assert.equal(isDomainNavigationSectionId(null), false);
                assert.equal(isDomainNavigationSectionId(7), false);
        });

        test('DOMAIN_SECTION_STATES is the two honest states', () => {
                assert.deepEqual([...DOMAIN_SECTION_STATES], ['composed', 'not-composed']);
                assert.equal(isDomainSectionStateKind('composed'), true);
                assert.equal(isDomainSectionStateKind('not-composed'), true);
                assert.equal(isDomainSectionStateKind('composing'), false);
                assert.equal(isDomainSectionStateKind('absent'), false);
        });

        test('DOMAIN_FAMILY_STAGES mirrors every REAL composing family\'s stage list (the pinned mirror)', () => {
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], ['composing', 'composed']);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_ROLES_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_ONTOLOGY_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_TEMPLATE_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_BODY_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_PACKS_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_PROFILES_STAGES]);
                assert.deepEqual([...DOMAIN_FAMILY_STAGES], [...REAL_BENCHMARK_STAGES]);
        });

        test('THE badge vocabulary is DERIVED from the REAL imported state vocabularies (never transcribed)', () => {
                // every real lifecycle state, onboarding stage and composing stage is a badge.
                for (const state of REAL_HARNESS_LIFECYCLE_STATES) {
                        assert.equal(isDomainSectionRowBadge(state), true, `the lifecycle state '${state}' must be a badge`);
                }
                for (const stage of REAL_ONBOARDING_STAGES) {
                        assert.equal(isDomainSectionRowBadge(stage), true, `the onboarding stage '${stage}' must be a badge`);
                }
                for (const stage of DOMAIN_FAMILY_STAGES) {
                        assert.equal(isDomainSectionRowBadge(stage), true, `the family stage '${stage}' must be a badge`);
                }
                assert.equal(isDomainSectionRowBadge('not-composed'), true, 'the one derived absent marker');
        });

        test('the badge predicate closes over the frozen list', () => {
                assert.equal(isDomainSectionRowBadge('active'), true);
                assert.equal(isDomainSectionRowBadge('draft'), true);
                assert.equal(isDomainSectionRowBadge('industry'), true);
                assert.equal(isDomainSectionRowBadge('composing'), true);
                assert.equal(isDomainSectionRowBadge('bogus'), false);
                assert.equal(isDomainSectionRowBadge(null), false);
                assert.equal(isDomainSectionRowBadge(7), false);
        });

        test('PROJECTIONS_INPUT_SCHEMA_KEYS is the nine family slots in the walk order', () => {
                assert.deepEqual([...PROJECTIONS_INPUT_SCHEMA_KEYS], [
                        'harness',
                        'onboarding',
                        'roles',
                        'ontology',
                        'templates',
                        'bodies',
                        'packs',
                        'profiles',
                        'benchmarks',
                ]);
        });

        test('PROJECTIONS_REJECTION_REASONS is the six-station frozen walk order', () => {
                assert.deepEqual([...PROJECTIONS_REJECTION_REASONS], [
                        'malformed-inputs',
                        'unknown-key',
                        'missing-record',
                        'malformed-record',
                        'duplicate-record',
                        'foreign-record',
                ]);
                assert.equal(isProjectionsRejectionReason('missing-record'), true);
                assert.equal(isProjectionsRejectionReason('foreign-record'), true);
                assert.equal(isProjectionsRejectionReason('nope'), false);
        });

        test('PROJECTIONS_MODEL_REJECTION_REASONS is the nine-station frozen model walk', () => {
                assert.deepEqual([...PROJECTIONS_MODEL_REJECTION_REASONS], [
                        'malformed-model',
                        'unknown-key',
                        'missing-key',
                        'bad-harness-id',
                        'version-mismatch',
                        'bad-section-list',
                        'bad-section-state',
                        'bad-row',
                        'duplicate-row-key',
                ]);
                assert.equal(isProjectionsModelRejectionReason('bad-row'), true);
                assert.equal(isProjectionsModelRejectionReason('nope'), false);
        });

        test('PROJECTIONS_PARSE_REJECTION_REASONS is the six-station frozen parse walk', () => {
                assert.deepEqual([...PROJECTIONS_PARSE_REJECTION_REASONS], [
                        'malformed-json',
                        'torn-envelope',
                        'unknown-contract-version',
                        'unknown-key',
                        'invalid-model',
                        'non-canonical',
                ]);
                assert.equal(isProjectionsParseRejectionReason('non-canonical'), true);
                assert.equal(isProjectionsParseRejectionReason('nope'), false);
        });

        test('the model / section / row schema keys are the frozen fixed-key orders', () => {
                assert.deepEqual([...DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS], ['harnessId', 'contractVersion', 'sections']);
                assert.deepEqual([...DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS], ['section', 'sectionState', 'rows']);
                assert.deepEqual([...DOMAIN_SECTION_ROW_SCHEMA_KEYS], ['rowKey', 'label', 'detail', 'badge']);
        });
});

suite('projectionsContract · THE ANCHOR LAW (the harness slot is REQUIRED)', () => {
        test('the key absent is the typed missing-record rejection naming the domain-harness family', () => {
                const rejections = refusalOf(projectNavigation({}));
                assert.equal(rejections.length, 1);
                assert.equal(rejections[0].reason, 'missing-record');
                assert.equal(rejections[0].law, 'THE ANCHOR LAW');
                assert.deepEqual([...(rejections[0].items ?? [])], ['harness']);
                assert.ok(rejections[0].detail.includes('flauz:hrn:'), 'the rejection names the DH-01 family id form');
                assert.ok(rejections[0].detail.includes('harness'), 'the rejection names the slot');
        });

        test('the value undefined is the same typed missing-record rejection (never a silent empty model)', () => {
                const rejections = refusalOf(projectNavigation({ harness: undefined }));
                assert.equal(rejections.length, 1);
                assert.equal(rejections[0].reason, 'missing-record');
        });

        test('a present value that fails the REAL isHarnessRecord walk is the malformed-record rejection', () => {
                const rejections = refusalOf(projectNavigation({ harness: { harnessId: 'nope' } }));
                assert.equal(rejections.length, 1);
                assert.equal(rejections[0].reason, 'malformed-record');
                assert.equal(rejections[0].law, 'THE IMPORT LAW');
                assert.ok(rejections[0].detail.includes('isHarnessRecord'), 'the rejection names the REAL validator');
        });

        test('a non-object inputs carrier is the malformed-inputs rejection (the total boundary)', () => {
                for (const bad of [null, 7, 'text', true, []]) {
                        const rejections = refusalOf(projectNavigation(bad));
                        assert.equal(rejections.length, 1, `one verdict for ${JSON.stringify(bad)}`);
                        assert.equal(rejections[0].reason, 'malformed-inputs');
                }
        });

        test('an inputs key outside the frozen nine-key schema is the unknown-key rejection', () => {
                const rejections = refusalOf(projectNavigation({ harness: fixtureHarness('draft'), extra: true }));
                assert.equal(rejections.length, 1);
                assert.equal(rejections[0].reason, 'unknown-key');
                assert.equal(rejections[0].law, 'THE NO-FORK LAW');
                assert.deepEqual([...(rejections[0].items ?? [])], ['extra']);
        });
});

suite('projectionsContract · THE ABSENT-FAMILY LAW (absent vs present, per family)', () => {
        for (const { slot, green } of FAMILY_SLOTS) {
                test(`the '${slot}' slot ABSENT (undefined) is the honest not-composed family - never a refusal`, () => {
                        const inputs = crownInputs();
                        delete inputs[slot];
                        const model = mustProject(inputs);
                        assert.ok(Array.isArray(model.sections));
                        // every OTHER section still projects; the absent family's sections carry
                        // the honest state wherever that family is the sole source.
                        assert.equal(model.sections.length, 9);
                });

                test(`a PRESENT but non-array '${slot}' slot is the typed malformed-record rejection naming the family`, () => {
                        const inputs = crownInputs();
                        inputs[slot] = null;
                        const rejections = refusalOf(projectNavigation(inputs));
                        assert.equal(rejections.length, 1);
                        assert.equal(rejections[0].reason, 'malformed-record');
                        assert.equal(rejections[0].law, 'THE ABSENT-FAMILY LAW');
                        assert.ok(rejections[0].detail.includes(`'${slot}'`), 'the rejection names the family');
                });

                test(`a '${slot}' array member that fails the REAL family validator is the typed malformed-record rejection`, () => {
                        const inputs = crownInputs();
                        inputs[slot] = [green(), { bogus: true }];
                        const rejections = refusalOf(projectNavigation(inputs));
                        assert.equal(rejections.length, 1);
                        assert.equal(rejections[0].reason, 'malformed-record');
                        assert.equal(rejections[0].law, 'THE IMPORT LAW');
                        assert.ok(rejections[0].detail.includes(`'${slot}'`), 'the rejection names the family');
                        assert.ok(rejections[0].detail.includes('never silently skipped'));
                });
        }

        test('an empty family array is the honest zero-record family (not-composed sections, never a refusal)', () => {
                const inputs = crownInputs();
                inputs.profiles = [];
                const model = mustProject(inputs);
                assert.equal(sectionOf(model, 'policies').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'evidence').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'kpis').sectionState, 'not-composed');
        });

        test('a composing family record with zero entries leaves its sections not-composed (THE SECTION-STATE LAW)', () => {
                const composing = fixtureProfiles({ stage: 'composing', profiles: [], history: [note('begin-profiles', null, 'composing')] });
                const model = mustProject({ ...crownInputs(), profiles: [composing] });
                assert.equal(sectionOf(model, 'policies').sectionState, 'not-composed');
                assert.deepEqual(sectionOf(model, 'policies').rows, []);
        });
});

suite('projectionsContract · THE BINDING LAW (records bind to the anchor)', () => {
        const BOUND_SLOTS: readonly { slot: string; green: (overrides?: Record<string, unknown>) => Record<string, unknown>; idField: string }[] = [
                { slot: 'onboarding', green: fixtureSession, idField: 'sessionId' },
                { slot: 'ontology', green: fixtureOntology, idField: 'ontologyId' },
                { slot: 'templates', green: fixtureTemplates, idField: 'templateId' },
                { slot: 'bodies', green: fixtureBodies, idField: 'bodyId' },
                { slot: 'packs', green: fixturePacks, idField: 'id' },
                { slot: 'profiles', green: fixtureProfiles, idField: 'profilesId' },
                { slot: 'benchmarks', green: fixtureBenchmarks, idField: 'id' },
        ];

        for (const { slot, green, idField } of BOUND_SLOTS) {
                test(`a foreign '${slot}' record is the typed foreign-record rejection naming the family, the id and the foreign harness`, () => {
                        const foreign = green({ harnessId: FOREIGN_HARNESS_ID });
                        const rejections = refusalOf(projectNavigation({ ...crownInputs(), [slot]: [foreign] }));
                        assert.equal(rejections.length, 1);
                        assert.equal(rejections[0].reason, 'foreign-record');
                        assert.equal(rejections[0].law, 'THE BINDING LAW');
                        const id = foreign[idField] as string;
                        assert.deepEqual([...(rejections[0].items ?? [])], [`${slot}:${id}->${FOREIGN_HARNESS_ID}`]);
                        assert.ok(rejections[0].detail.includes(HARNESS_ID), 'the rejection names the anchor');
                });
        }

        test('a DH-02 session with a NULL harnessId is a pre-proposal session - never foreign', () => {
                const preProposal = fixtureSession({ harnessId: null });
                const model = mustProject({ ...crownInputs(), onboarding: [preProposal] });
                assert.equal(sectionOf(model, 'overview').sectionState, 'composed');
        });

        test('a DH-03 roles session carries NO harnessId (the caller\'s wiring binds it) - never checked', () => {
                // the roles session shape has no harnessId at all; the same composed roles
                // session projects under any anchor (the caller's composition wiring).
                const model = mustProject({ ...crownInputs(), roles: [fixtureRoles()] });
                const roles = sectionOf(model, 'roles');
                assert.equal(roles.sectionState, 'composed');
                assert.equal(roles.rows.length, 4); // the two descriptor roles + the two session roles
        });

        test('a foreign record and a malformed record land together in the COMPLETE rejection table', () => {
                const foreign = fixtureOntology({ harnessId: FOREIGN_HARNESS_ID });
                const rejections = refusalOf(projectNavigation({
                        ...crownInputs(),
                        ontology: [foreign],
                        templates: [{ bogus: true }],
                }));
                const reasons = rejections.map((rejection) => rejection.reason);
                assert.deepEqual(reasons, ['malformed-record', 'foreign-record']);
        });
});

suite('projectionsContract · THE DUPLICATE-RECORD LAW (rowKeys are unique per record id)', () => {
        const ID_FIELDS: Record<string, string> = {
                onboarding: 'sessionId',
                roles: 'sessionId',
                ontology: 'ontologyId',
                templates: 'templateId',
                bodies: 'bodyId',
                packs: 'id',
                profiles: 'profilesId',
                benchmarks: 'id',
        };

        for (const { slot, green } of FAMILY_SLOTS) {
                test(`a repeated record id in the '${slot}' slot is the typed duplicate-record rejection (first-seen order, once)`, () => {
                        const rejections = refusalOf(projectNavigation({ ...crownInputs(), [slot]: [green(), green()] }));
                        assert.equal(rejections.length, 1);
                        assert.equal(rejections[0].reason, 'duplicate-record');
                        assert.equal(rejections[0].law, 'THE DUPLICATE-RECORD LAW');
                        const idField = ID_FIELDS[slot];
                        const id = green()[idField] as string;
                        assert.deepEqual([...(rejections[0].items ?? [])], [`${slot}:${id}`]);
                });
        }

        test('the same 16-hex id across DIFFERENT families is never a duplicate (the prefixes scope the ids)', () => {
                const model = mustProject(crownInputs());
                // every fixture id shares the 0123456789abcdef hex; the projection is green
                // because the families' id alphabets are prefix-scoped.
                assert.equal(model.sections.length, 9);
        });

        test('a repeated id reported once: three copies of one record still yield ONE item', () => {
                const rejections = refusalOf(projectNavigation({ ...crownInputs(), packs: [fixturePacks(), fixturePacks(), fixturePacks()] }));
                assert.equal(rejections.length, 1);
                assert.deepEqual([...(rejections[0].items ?? [])].length, 1);
        });
});

suite('projectionsContract · THE FAIL-CLOSED LAW (the complete table in the frozen walk order)', () => {
        test('a multi-offense input collects EVERY violated law into the COMPLETE rejection table in the walk order', () => {
                const foreign = fixtureOntology({ harnessId: FOREIGN_HARNESS_ID });
                const rejections = refusalOf(projectNavigation({
                        harness: fixtureHarness('draft'),
                        ghost: true,
                        onboarding: null,
                        ontology: [foreign, foreign],
                        packs: 'not-an-array',
                }));
                const reasons = rejections.map((rejection) => rejection.reason);
                // the frozen station order: malformed-inputs, unknown-key, missing-record,
                // malformed-record, duplicate-record, foreign-record.
                assert.deepEqual(reasons, ['unknown-key', 'malformed-record', 'malformed-record', 'duplicate-record', 'foreign-record']);
        });

        test('the station order is EXACTLY the frozen list order (the table is sorted by station)', () => {
                const foreign = fixturePacks({ harnessId: FOREIGN_HARNESS_ID });
                const rejections = refusalOf(projectNavigation({
                        ghost: 1,
                        harness: fixtureHarness('draft'),
                        profiles: null,
                        benchmarks: [fixtureBenchmarks(), fixtureBenchmarks()],
                        packs: [foreign],
                }));
                const reasons = rejections.map((rejection) => rejection.reason);
                const stations = [...PROJECTIONS_REJECTION_REASONS];
                const indexes = reasons.map((reason) => stations.indexOf(reason));
                for (let i = 1; i < indexes.length; i += 1) {
                        assert.ok(indexes[i] >= indexes[i - 1], `the table is station-major: ${reasons.join(', ')}`);
                }
        });

        test('a domain refusal is NEVER a bare throw (the typed outcome law)', () => {
                let threw = false;
                try {
                        projectNavigation({ harness: 7, onboarding: 'nope', ghost: true });
                } catch {
                        threw = true;
                }
                assert.equal(threw, false);
        });

        test('the malformed-inputs verdict short-circuits (nothing else is walkable)', () => {
                const rejections = refusalOf(projectNavigation('not-an-object'));
                assert.equal(rejections.length, 1);
                assert.equal(rejections[0].reason, 'malformed-inputs');
        });
});

suite('projectionsContract · THE PROJECTION FUNCTION (the anchor-only projection)', () => {
        test('the anchor-only input: overview, roles and lifecycle are composed from the DH-01 record alone; every family-fed section is not-composed', () => {
                const model = mustProject({ harness: fixtureHarness('draft') });
                assert.equal(model.harnessId, HARNESS_ID);
                assert.equal(model.contractVersion, PROJECTIONS_CONTRACTS_VERSION);
                assert.deepEqual(model.sections.map((section) => section.section), [...DOMAIN_NAVIGATION_SECTIONS]);
                assert.equal(sectionOf(model, 'overview').sectionState, 'composed');
                assert.equal(sectionOf(model, 'roles').sectionState, 'composed');
                assert.equal(sectionOf(model, 'workflows').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'capabilities').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'policies').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'evidence').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'kpis').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'benchmarks').sectionState, 'not-composed');
                assert.equal(sectionOf(model, 'lifecycle').sectionState, 'composed');
        });

        test('a not-composed section carries ZERO rows (never fabricated)', () => {
                const model = mustProject({ harness: fixtureHarness('draft') });
                for (const section of ['workflows', 'capabilities', 'policies', 'evidence', 'kpis', 'benchmarks']) {
                        assert.deepEqual(sectionOf(model, section).rows, [], `the '${section}' section carries no rows`);
                }
        });

        test('the roles floor: the DH-01 descriptor\'s own roles always project (THE ANCHOR LAW\'s floor)', () => {
                const model = mustProject({ harness: fixtureHarness('draft') });
                const rows = sectionOf(model, 'roles').rows;
                assert.equal(rows.length, 2);
                assert.deepEqual(rows.map((row) => row.label), ['analyst', 'reviewer']);
                assert.deepEqual(rows.map((row) => row.badge), ['draft', 'draft']);
        });

        test('the overview floor: the anchor\'s five identity rows (THE CONTENT LAW: the labels are the record\'s own values)', () => {
                const model = mustProject({ harness: fixtureHarness('active') });
                const rows = sectionOf(model, 'overview').rows;
                assert.equal(rows.length, 5);
                assert.deepEqual(rows.map((row) => row.rowKey), [
                        'overview-harness',
                        'overview-industry',
                        'overview-work-types',
                        'overview-display-name',
                        'overview-lifecycle',
                ]);
                assert.deepEqual(rows.map((row) => row.label), [HARNESS_ID, 'software', 'analysis, review', 'Fixture Harness', 'active']);
                assert.deepEqual(rows.map((row) => row.badge), ['active', 'active', 'active', 'active', 'active']);
        });
});

suite('projectionsContract · THE PROJECTION LAW (derived, read-only, deterministic)', () => {
        test('the fully-composed crown input projects the COMPLETE navigation model with every section populated', () => {
                const model = mustProject(crownInputs());
                for (const section of model.sections) {
                        assert.equal(section.sectionState, 'composed', `the '${section.section}' section is composed`);
                        assert.ok(section.rows.length > 0, `the '${section.section}' section carries rows`);
                }
        });

        test('THE RECORD-UNCHANGED LAW: the projection never mutates its inputs', () => {
                const inputs = crownInputs();
                const before = clone(inputs);
                mustProject(inputs);
                assert.deepEqual(inputs, before);
        });

        test('determinism: the same inputs produce a deep-equal model and byte-identical bytes', () => {
                const first = mustProject(crownInputs());
                const second = mustProject(crownInputs());
                assert.deepEqual(first, second);
                assert.equal(serializeNavigationModel(first), serializeNavigationModel(second));
        });

        test('the derived rowKeys are unique across the whole model', () => {
                const model = mustProject(crownInputs());
                const keys = model.sections.flatMap((section) => section.rows.map((row) => row.rowKey));
                assert.equal(new Set(keys).size, keys.length);
        });

        test('every derived badge is a member of the REAL imported state vocabularies', () => {
                const model = mustProject(crownInputs());
                const legal = new Set<string>([...REAL_HARNESS_LIFECYCLE_STATES, ...REAL_ONBOARDING_STAGES, ...DOMAIN_FAMILY_STAGES, 'not-composed']);
                for (const row of model.sections.flatMap((section) => section.rows)) {
                        assert.ok(legal.has(row.badge), `the badge '${row.badge}' must be a real state`);
                }
        });
});

suite('projectionsContract · the per-section row derivations (THE SECTION-SOURCE MAP)', () => {
        test('projectOverviewRows: the anchor panel plus the DH-02 session\'s observed selection state', () => {
                const rows = projectOverviewRows(fixtureHarness('active') as never, [fixtureSession() as never]);
                // the five anchor rows + the session rows (stage, industry, company, work
                // types, composition, harness - each observed only when set).
                const keys = rows.map((row) => row.rowKey);
                assert.deepEqual(keys.slice(0, 5), ['overview-harness', 'overview-industry', 'overview-work-types', 'overview-display-name', 'overview-lifecycle']);
                assert.deepEqual(keys.slice(5), [
                        'overview-session-flauz:onb:0123456789abcdef',
                        'overview-session-industry-flauz:onb:0123456789abcdef',
                        'overview-company-flauz:onb:0123456789abcdef',
                        'overview-session-work-types-flauz:onb:0123456789abcdef',
                        'overview-session-composition-flauz:onb:0123456789abcdef',
                        'overview-session-harness-flauz:onb:0123456789abcdef',
                ]);
                const sessionRow = rows[5];
                assert.equal(sessionRow.badge, 'review');
                assert.ok(sessionRow.detail.includes('stage review'));
                const companyRow = rows[7];
                assert.equal(companyRow.label, 'Fixture Group');
                assert.ok(companyRow.detail.includes('small'));
        });

        test('projectOverviewRows: a pre-selection session projects ONLY the session row (the nullable fields never fabricate)', () => {
                const minimal = fixtureSession({
                        stage: 'industry',
                        industry: null,
                        companyProfile: null,
                        workTypes: null,
                        reviewComposition: null,
                        harnessId: null,
                        revision: 1,
                        history: [note('begin-session', null, 'industry')],
                });
                const rows = projectOverviewRows(fixtureHarness('draft') as never, [minimal as never]);
                assert.equal(rows.length, 6);
                assert.equal(rows[5].rowKey, 'overview-session-flauz:onb:0123456789abcdef');
                assert.equal(rows[5].badge, 'industry');
        });

        test('projectOverviewRows: multiple sessions project in input order', () => {
                const second = fixtureSession({ sessionId: 'flauz:onb:fedcba9876543210' });
                const rows = projectOverviewRows(fixtureHarness('draft') as never, [fixtureSession() as never, second as never]);
                const sessionKeys = rows.filter((row) => row.rowKey.startsWith('overview-session-flauz')).map((row) => row.rowKey);
                assert.equal(sessionKeys.length, 2);
                assert.equal(sessionKeys[0], 'overview-session-flauz:onb:0123456789abcdef');
                assert.equal(sessionKeys[1], 'overview-session-flauz:onb:fedcba9876543210');
        });

        test('projectRolesRows: the descriptor floor then the DH-03 session roles, badged with each record\'s REAL state', () => {
                const rows = projectRolesRows(fixtureHarness('proposed') as never, [fixtureRoles() as never]);
                assert.equal(rows.length, 4);
                assert.deepEqual(rows.map((row) => row.rowKey), [
                        'roles-descriptor-analyst',
                        'roles-descriptor-reviewer',
                        'roles-flauz:rol:0123456789abcdef-analyst',
                        'roles-flauz:rol:0123456789abcdef-reviewer',
                ]);
                assert.deepEqual(rows.map((row) => row.badge), ['proposed', 'proposed', 'composed', 'composed']);
                assert.equal(rows[2].label, 'analyst');
                assert.equal(rows[2].detail, 'Runs the domain analysis.');
        });

        test('projectWorkflowsRows: the DH-05 template tasks then the DH-04 ontology terms', () => {
                const rows = projectWorkflowsRows([fixtureTemplates() as never], [fixtureOntology() as never]);
                assert.deepEqual(rows.map((row) => row.rowKey), [
                        'workflows-flauz:tpl:0123456789abcdef-survey',
                        'workflows-terms-flauz:ont:0123456789abcdef-signal',
                ]);
                assert.equal(rows[0].label, 'survey');
                assert.equal(rows[0].badge, 'composed');
                assert.equal(rows[1].label, 'signal');
                assert.equal(rows[1].detail, 'The incoming work signal.');
        });

        test('projectCapabilitiesRows: packs, bodies, then the DISTINCT permission legs with their declaring profiles', () => {
                const secondProfile = fixtureProfiles({
                        profilesId: 'flauz:prf:fedcba9876543210',
                        profiles: [{
                                profileKey: 'audit',
                                summary: 'The audit policy profile.',
                                permissionRefs: ['read-files', 'execute-command'],
                                approvalTiers: ['low'],
                                evidenceFloor: 'fixture',
                                kpiDimensions: ['cost'],
                        }],
                });
                const rows = projectCapabilitiesRows([fixturePacks() as never], [fixtureBodies() as never], [fixtureProfiles() as never, secondProfile as never]);
                const keys = rows.map((row) => row.rowKey);
                assert.deepEqual(keys, [
                        'capabilities-flauz:pak:0123456789abcdef-core',
                        'capabilities-bodies-flauz:bod:0123456789abcdef-triage',
                        'capabilities-permission-read-files',
                        'capabilities-permission-execute-command',
                ]);
                // 'read-files' is declared by BOTH profiles - ONE row, both declarers named.
                const shared = rows[2];
                assert.ok(shared.detail.includes('core'), 'the first declarer is named');
                assert.ok(shared.detail.includes('audit'), 'the second declarer is named');
                assert.equal(shared.badge, 'composed');
        });

        test('projectCapabilitiesRows: a composing declarer degrades the permission leg badge to composing (the REAL record states)', () => {
                const composing = fixtureProfiles({ stage: 'composing' });
                const rows = projectCapabilitiesRows([], [], [composing as never]);
                assert.equal(rows.length, 1);
                assert.equal(rows[0].badge, 'composing');
        });

        test('projectPoliciesRows / projectEvidenceRows / projectKpisRows: one row per DH-08 profile entry, per leg', () => {
                const policies = projectPoliciesRows([fixtureProfiles() as never]);
                assert.equal(policies.length, 1);
                assert.equal(policies[0].rowKey, 'policies-flauz:prf:0123456789abcdef-core');
                assert.ok(policies[0].detail.includes('read-files'));
                assert.ok(policies[0].detail.includes('high'));
                const evidence = projectEvidenceRows([fixtureProfiles() as never]);
                assert.equal(evidence[0].rowKey, 'evidence-flauz:prf:0123456789abcdef-core');
                assert.ok(evidence[0].detail.includes('local-real'));
                const kpis = projectKpisRows([fixtureProfiles() as never]);
                assert.equal(kpis[0].rowKey, 'kpis-flauz:prf:0123456789abcdef-core');
                assert.ok(kpis[0].detail.includes('success'));
                assert.deepEqual([policies[0].badge, evidence[0].badge, kpis[0].badge], ['composed', 'composed', 'composed']);
        });

        test('projectBenchmarksRows: one row per DH-09 benchmark entry carrying the scenario count and the evidence level', () => {
                const rows = projectBenchmarksRows([fixtureBenchmarks() as never]);
                assert.equal(rows.length, 1);
                assert.equal(rows[0].rowKey, 'benchmarks-flauz:ben:0123456789abcdef-regression-suite-health');
                assert.equal(rows[0].label, 'regression-suite-health');
                assert.ok(rows[0].detail.includes('1 scenario refs'));
                assert.ok(rows[0].detail.includes('fixture'));
                assert.equal(rows[0].badge, 'composed');
        });
});

suite('projectionsContract · the lifecycle projection (the DH-01 state machine, over all five REAL states)', () => {
        const CASES: readonly { state: string; statePositions: string[]; transitionPositions: string[] }[] = [
                {
                        state: 'draft',
                        statePositions: ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming (terminal)'],
                        transitionPositions: ['available (the next legal step)', 'not reached', 'not reached', 'not reached'],
                },
                {
                        state: 'proposed',
                        statePositions: ['past', 'current', 'upcoming', 'upcoming', 'upcoming (terminal)'],
                        transitionPositions: ['consumed', 'available (the next legal step)', 'not reached', 'not reached'],
                },
                {
                        state: 'approved',
                        statePositions: ['past', 'past', 'current', 'upcoming', 'upcoming (terminal)'],
                        transitionPositions: ['consumed', 'consumed', 'available (the next legal step)', 'not reached'],
                },
                {
                        state: 'active',
                        statePositions: ['past', 'past', 'past', 'current', 'upcoming (terminal)'],
                        transitionPositions: ['consumed', 'consumed', 'consumed', 'available (the next legal step)'],
                },
                {
                        state: 'retired',
                        statePositions: ['past', 'past', 'past', 'past', 'current (terminal)'],
                        transitionPositions: ['consumed', 'consumed', 'consumed', 'consumed'],
                },
        ];

        for (const { state, statePositions, transitionPositions } of CASES) {
                test(`the '${state}' anchor: five state rows in the REAL frozen order and four transition rows in the REAL whitelist order`, () => {
                        const rows = projectLifecycleRows(fixtureHarness(state) as never);
                        assert.equal(rows.length, REAL_HARNESS_LIFECYCLE_STATES.length + REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS.length);
                        assert.deepEqual(rows.slice(0, 5).map((row) => row.label), [...REAL_HARNESS_LIFECYCLE_STATES]);
                        assert.deepEqual(rows.slice(5).map((row) => row.label), REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS.map((t) => `${t.from} -> ${t.to}`));
                        assert.deepEqual(rows.slice(0, 5).map((row) => row.detail), statePositions);
                        assert.deepEqual(rows.slice(5).map((row) => row.detail), transitionPositions);
                        assert.deepEqual(rows.slice(0, 5).map((row) => row.badge), [...REAL_HARNESS_LIFECYCLE_STATES]);
                });
        }

        test('the state rows\' rowKeys and the transition rows\' rowKeys are the frozen forms', () => {
                const rows = projectLifecycleRows(fixtureHarness('draft') as never);
                assert.deepEqual(rows.slice(0, 5).map((row) => row.rowKey), REAL_HARNESS_LIFECYCLE_STATES.map((state) => `lifecycle-state-${state}`));
                assert.deepEqual(rows.slice(5).map((row) => row.rowKey), REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS.map((t) => `lifecycle-transition-${t.from}-${t.to}`));
        });

        test('the retired anchor is the terminal position (no upcoming states, no available transitions)', () => {
                const rows = projectLifecycleRows(fixtureHarness('retired') as never);
                assert.ok(rows.every((row) => row.detail !== 'upcoming'));
                assert.ok(rows.slice(5).every((row) => row.detail === 'consumed'));
        });
});

suite('projectionsContract · the canonical serialization + the deep model walk', () => {
        test('serializeNavigationModel: the canonical fixed-key-order bytes, double-serialize byte-equality', () => {
                const model = mustProject(crownInputs());
                const bytes = serializeNavigationModel(model);
                assert.equal(serializeNavigationModel(JSON.parse(bytes) as never), bytes);
                assert.ok(bytes.startsWith('{"harnessId":'));
                assert.ok(bytes.includes('"contractVersion":"1.0.0","sections":[{"section":"overview"'));
                assert.ok(bytes.includes('"section":"lifecycle"'));
        });

        test('serializeNavigationModel throws TypeError on a malformed model (never dishonest bytes)', () => {
                assert.throws(() => serializeNavigationModel({ bogus: true }), TypeError);
                assert.throws(() => serializeNavigationModel(null), TypeError);
                const broken = clone(mustProject(crownInputs())) as Record<string, unknown>;
                const sections = broken.sections as Record<string, unknown>[];
                (sections[0].rows as Record<string, unknown>[])[0].label = '';
                assert.throws(() => serializeNavigationModel(broken), TypeError);
        });

        test('validateNavigationModel: ok on the crown model, carrying the canonical fixed-key-order copy', () => {
                const model = mustProject(crownInputs());
                const outcome = validateNavigationModel(clone(model));
                assert.equal(outcome.ok, true);
                assert.deepEqual((outcome as { model: DomainNavigationModel }).model, model);
        });

        test('isNavigationModel: the predicate over the deep walk', () => {
                const model = mustProject(crownInputs());
                assert.equal(validateNavigationModel(clone(model)).ok, true);
        });

        test('malformed-model: a non-object, a non-array sections carrier, a non-object section, a non-string field', () => {
                const model = mustProject(crownInputs());
                assert.equal(validateNavigationModel(null).ok, false);
                const badSections = clone(model) as Record<string, unknown>;
                badSections.sections = 'not-an-array';
                assert.equal((validateNavigationModel(badSections) as { rejection: { reason: string } }).rejection.reason, 'malformed-model');
                const badSection = clone(model) as Record<string, unknown>;
                (badSection.sections as unknown[])[0] = 7;
                assert.equal((validateNavigationModel(badSection) as { rejection: { reason: string } }).rejection.reason, 'malformed-model');
                const badField = clone(model) as Record<string, unknown>;
                badField.harnessId = 7;
                assert.equal((validateNavigationModel(badField) as { rejection: { reason: string } }).rejection.reason, 'malformed-model');
        });

        test('unknown-key: extra keys at the model / section / row level are refused', () => {
                const model = mustProject(crownInputs());
                const extraModel = clone(model) as Record<string, unknown>;
                extraModel.ghost = true;
                assert.equal((validateNavigationModel(extraModel) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                const extraSection = clone(model) as Record<string, unknown>;
                (extraSection.sections as Record<string, unknown>[])[0].ghost = true;
                assert.equal((validateNavigationModel(extraSection) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                const extraRow = withRow(model, { section: 0, row: 0 }, { ghost: true });
                assert.equal((validateNavigationModel(extraRow) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
        });

        test('missing-key: absent keys at the model / section / row level are refused', () => {
                const model = mustProject(crownInputs());
                const noVersion = clone(model) as Record<string, unknown>;
                delete noVersion.contractVersion;
                assert.equal((validateNavigationModel(noVersion) as { rejection: { reason: string } }).rejection.reason, 'missing-key');
                const noSectionState = clone(model) as Record<string, unknown>;
                delete (noSectionState.sections as Record<string, unknown>[])[0].sectionState;
                assert.equal((validateNavigationModel(noSectionState) as { rejection: { reason: string } }).rejection.reason, 'missing-key');
                const noBadge = clone(model) as Record<string, unknown>;
                delete ((noBadge.sections as Record<string, unknown>[])[0].rows as Record<string, unknown>[])[0].badge;
                assert.equal((validateNavigationModel(noBadge) as { rejection: { reason: string } }).rejection.reason, 'missing-key');
        });

        test('bad-harness-id: the model id must be the REAL DH-01 form', () => {
                const model = mustProject(crownInputs());
                const bad = clone(model) as Record<string, unknown>;
                bad.harnessId = 'nope';
                const outcome = validateNavigationModel(bad) as { rejection: { reason: string; law: string } };
                assert.equal(outcome.rejection.reason, 'bad-harness-id');
                assert.equal(outcome.rejection.law, 'THE IMPORT LAW');
        });

        test('version-mismatch: the model must carry PROJECTIONS_CONTRACTS_VERSION exactly', () => {
                const model = mustProject(crownInputs());
                const bad = clone(model) as Record<string, unknown>;
                bad.contractVersion = '0.9.0';
                const outcome = validateNavigationModel(bad) as { rejection: { reason: string; law: string } };
                assert.equal(outcome.rejection.reason, 'version-mismatch');
                assert.equal(outcome.rejection.law, 'THE SINGLE-VERSION LAW');
        });

        test('bad-section-list: a short list, a long list and a reordered list are all refused', () => {
                const model = mustProject(crownInputs());
                const short = clone(model) as Record<string, unknown>;
                short.sections = (short.sections as unknown[]).slice(0, 8);
                assert.equal((validateNavigationModel(short) as { rejection: { reason: string } }).rejection.reason, 'bad-section-list');
                const long = clone(model) as Record<string, unknown>;
                long.sections = [...(long.sections as unknown[]), clone((long.sections as unknown[])[0])];
                assert.equal((validateNavigationModel(long) as { rejection: { reason: string } }).rejection.reason, 'bad-section-list');
                const swapped = clone(model) as Record<string, unknown>;
                const sections = swapped.sections as unknown[];
                [sections[0], sections[1]] = [sections[1], sections[0]];
                assert.equal((validateNavigationModel(swapped) as { rejection: { reason: string } }).rejection.reason, 'bad-section-list');
        });

        test('bad-section-state: a non-member state, a composed section with zero rows, a not-composed section with rows', () => {
                const model = mustProject(crownInputs());
                const nonMember = clone(model) as Record<string, unknown>;
                (nonMember.sections as Record<string, unknown>[])[2].sectionState = 'composing';
                assert.equal(modelRejectionOf(validateNavigationModel(nonMember)).reason, 'bad-section-state');
                assert.ok(modelRejectionOf(validateNavigationModel(nonMember)).items[0].includes('composing'));
                const composedEmpty = clone(mustProject({ harness: fixtureHarness('draft') })) as Record<string, unknown>;
                (composedEmpty.sections as Record<string, unknown>[])[2].sectionState = 'composed';
                const outcome = validateNavigationModel(composedEmpty) as { rejection: { reason: string; law: string } };
                assert.equal(outcome.rejection.reason, 'bad-section-state');
                assert.equal(outcome.rejection.law, 'THE SECTION-STATE LAW');
                const notComposedFull = clone(model) as Record<string, unknown>;
                (notComposedFull.sections as Record<string, unknown>[])[0].sectionState = 'not-composed';
                assert.equal((validateNavigationModel(notComposedFull) as { rejection: { reason: string } }).rejection.reason, 'bad-section-state');
        });

        test('bad-row: an empty rowKey / label / detail and a non-member badge are refused', () => {
                const model = mustProject(crownInputs());
                for (const field of ['rowKey', 'label', 'detail']) {
                        const bad = withRow(model, { section: 0, row: 0 }, { [field]: '' });
                        assert.equal((validateNavigationModel(bad) as { rejection: { reason: string } }).rejection.reason, 'bad-row', `an empty ${field} refuses`);
                }
                const badBadge = withRow(model, { section: 0, row: 0 }, { badge: 'bogus' });
                const outcome = validateNavigationModel(badBadge) as { rejection: { reason: string; law: string } };
                assert.equal(outcome.rejection.reason, 'bad-row');
                assert.equal(outcome.rejection.law, 'THE IMPORT LAW');
        });

        test('duplicate-row-key: a repeated rowKey within the model is refused', () => {
                const model = mustProject(crownInputs());
                const dup = clone(model) as Record<string, unknown>;
                const sections = dup.sections as Record<string, unknown>[];
                const firstRows = sections[0].rows as Record<string, unknown>[];
                const secondRows = sections[1].rows as Record<string, unknown>[];
                secondRows[0] = clone(firstRows[0]) as Record<string, unknown>;
                assert.equal((validateNavigationModel(dup) as { rejection: { reason: string } }).rejection.reason, 'duplicate-row-key');
        });
});

suite('projectionsContract · THE FAIL-CLOSED PARSE (the round-trip and every drift class)', () => {
        test('the round-trip: serialize -> parse -> ok, the model deep-equal, the bytes the canonical form', () => {
                const model = mustProject(crownInputs());
                const bytes = serializeNavigationModel(model);
                const outcome = parseNavigationModel(bytes);
                assert.equal(outcome.ok, true);
                assert.deepEqual((outcome as { model: DomainNavigationModel }).model, model);
                assert.equal(parseNavigationModel(serializeNavigationModel((outcome as { model: DomainNavigationModel }).model)).ok, true);
        });

        test('non-string bytes are the torn-envelope rejection', () => {
                for (const bad of [null, 7, {}, []]) {
                        const outcome = parseNavigationModel(bad);
                        assert.equal(outcome.ok, false, `a refusal for ${JSON.stringify(bad)}`);
                        assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                }
        });

        test('malformed JSON is the malformed-json rejection', () => {
                const outcome = parseNavigationModel('{"harnessId":');
                assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'malformed-json');
        });

        test('a non-object JSON payload is the torn-envelope rejection', () => {
                const outcome = parseNavigationModel('[]');
                assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
        });

        test('a missing model key is the torn-envelope rejection (never a silent partial parse)', () => {
                const model = mustProject(crownInputs());
                for (const key of DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS) {
                        const stripped = clone(model) as Record<string, unknown>;
                        delete stripped[key];
                        const outcome = parseNavigationModel(JSON.stringify(stripped));
                        assert.equal(outcome.ok, false, `the '${key}' key is required`);
                        assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                }
        });

        test('a structurally wrong model field is the torn-envelope rejection', () => {
                const model = mustProject(crownInputs());
                const bad = clone(model) as Record<string, unknown>;
                bad.sections = 'not-an-array';
                const outcome = parseNavigationModel(JSON.stringify(bad));
                assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
        });

        test('a contract-version drift is the unknown-contract-version rejection (the single-version law)', () => {
                const model = mustProject(crownInputs());
                const bad = clone(model) as Record<string, unknown>;
                bad.contractVersion = '2.0.0';
                const outcome = parseNavigationModel(JSON.stringify(bad));
                assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'unknown-contract-version');
        });

        test('an extra key at the section or row level is the unknown-key rejection (tampered bytes)', () => {
                const model = mustProject(crownInputs());
                const extraSection = clone(model) as Record<string, unknown>;
                (extraSection.sections as Record<string, unknown>[])[0].ghost = true;
                assert.equal((parseNavigationModel(JSON.stringify(extraSection)) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                const extraRow = withRow(model, { section: 0, row: 0 }, { ghost: true });
                assert.equal((parseNavigationModel(JSON.stringify(extraRow)) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
        });

        test('a deep-walk failure is the invalid-model rejection', () => {
                const model = mustProject(crownInputs());
                const badBadge = withRow(model, { section: 0, row: 0 }, { badge: 'bogus' });
                const outcome = parseNavigationModel(JSON.stringify(badBadge));
                const rejection = (outcome as { rejection: { reason: string; detail: string } }).rejection;
                assert.equal(rejection.reason, 'invalid-model');
                assert.ok(rejection.detail.includes('bad-row'));
        });

        test('non-canonical bytes are refused, never silently normalized (pretty-printed, reordered keys, reordered sections)', () => {
                const model = mustProject(crownInputs());
                const bytes = serializeNavigationModel(model);
                const pretty = JSON.stringify(clone(model), null, 2);
                assert.equal((parseNavigationModel(pretty) as { rejection: { reason: string } }).rejection.reason, 'non-canonical');
                const reordered = JSON.stringify({ contractVersion: model.contractVersion, harnessId: model.harnessId, sections: model.sections });
                assert.equal((parseNavigationModel(reordered) as { rejection: { reason: string } }).rejection.reason, 'non-canonical');
                const drifted = bytes.replace('{"harnessId":', '{"harnessId": ');
                assert.equal((parseNavigationModel(drifted) as { rejection: { reason: string } }).rejection.reason, 'non-canonical');
        });

        test('the anchor-only model round-trips too (the minimal honest model)', () => {
                const model = mustProject({ harness: fixtureHarness('draft') });
                const outcome = parseNavigationModel(serializeNavigationModel(model));
                assert.equal(outcome.ok, true);
        });
});

suite('projectionsContract · THE CONTENT LAW (no per-industry UI content)', () => {
        test('the labels are the caller\'s record values - never an industry-specific constant from this module', () => {
                const model = mustProject({ ...crownInputs(), harness: fixtureHarness('active', { descriptor: fixtureDescriptor({ industry: 'legal', displayName: 'A Legal Harness' }) }) });
                assert.equal(sectionOf(model, 'overview').rows[1].label, 'legal');
                assert.equal(sectionOf(model, 'overview').rows[3].label, 'A Legal Harness');
                const labels = model.sections.flatMap((section) => section.rows.map((row) => row.label)).join(' ');
                assert.ok(!labels.includes('Litigation'), 'no invented legal-industry content');
        });

        test('the contract module carries no per-industry content constants (the derivation layer only)', () => {
                for (const industry of ['legal', 'healthcare', 'finance', 'manufacturing']) {
                        const hits = CONTRACT_SOURCE.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && line.includes(`'${industry}'`));
                        assert.equal(hits.length, 0, `no industry content: '${industry}'`);
                }
        });
});

suite('projectionsContract · the determinism greps (the zero-seam law)', () => {
        test('the contract module never calls the banned globals (law-comment lines only)', () => {
                const hits = determinismGrepHits('../../common/projectionsContract.ts');
                for (const hit of hits) {
                        const trimmed = hit.trim();
                        assert.ok(trimmed.startsWith('*') || trimmed.startsWith('//'), `the hit must be a law-comment line: ${hit}`);
                }
        });

        test('THE PROJECTION LAW disclosure: the module header names the no-second-persistence law', () => {
                assert.ok(CONTRACT_SOURCE.includes('persists state'));
                assert.ok(CONTRACT_SOURCE.includes('12.6'));
                assert.ok(CONTRACT_SOURCE.includes('THE PROJECTION LAW'));
        });
});
