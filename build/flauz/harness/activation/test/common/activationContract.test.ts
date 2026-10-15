/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-011 activation contract battery: THE SINGLE-VERSION LAW's cross-pins
 * (ACTIVATION_CONTRACTS_VERSION + the NINE prior family versions, all
 * imported by reference and pinned equal), THE FORWARD-ONLY LAW's journey
 * stage machine (the four whitelisted rows, every illegal edge typed),
 * the frozen journey-leg / op-name / op-leg / required-leg / leg-stage
 * tables, the journey id alphabet, THE CONTENT LAW's record-content walk
 * (the strict-schema stations + the OWNING families' REAL validators,
 * their complete typed rejection tables surfaced verbatim), the deep
 * journey-record walk (THE EVIDENCE-NOT-AUTHORITY LAW's honest record
 * shape - every station's typed refusal), the decision-mirror walk, the
 * canonical fixed-key-order serialization and THE FAIL-CLOSED PARSE
 * (malformed-json / torn-envelope / unknown-contract-version /
 * unknown-key / invalid-record, first-failure-is-the-verdict), and the
 * in-suite determinism greps over the shipped contract module.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION as REAL_ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION as REAL_TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION as REAL_BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION as REAL_PACKS_CONTRACTS_VERSION } from '../../../packs/common/packsContract.js';
import { PROFILES_CONTRACTS_VERSION as REAL_PROFILES_CONTRACTS_VERSION } from '../../../profiles/common/profilesContract.js';
import { BENCHMARKS_CONTRACTS_VERSION as REAL_BENCHMARKS_CONTRACTS_VERSION } from '../../../benchmarks/common/benchmarksContract.js';
import { MAX_ROLES as REAL_MAX_ROLES } from '../../../roles/common/rolesContract.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';

import {
        ACTIVATION_CONTRACTS_VERSION,
        ACTIVATION_FORWARD_TRANSITIONS,
        ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS,
        ACTIVATION_JOURNEY_REJECTION_REASONS,
        ACTIVATION_NOTE_SCHEMA_KEYS,
        ACTIVATION_PARSE_REJECTION_REASONS,
        ACTIVATION_STAGES,
        BENCHMARKS_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        canTransitionActivationStage,
        COMPOSED_RECORD_LINKS_SCHEMA_KEYS,
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        isActivationJourneyRejectionReason,
        isActivationJourneyStage,
        isActivationParseRejectionReason,
        isJourneyId,
        isJourneyLeg,
        JOURNEY_ID_PREFIX,
        JOURNEY_LEGS,
        JOURNEY_LEG_STAGES,
        JOURNEY_OP_LEGS,
        JOURNEY_OP_REQUIRED_LEGS,
        JOURNEY_RECORD_CONTENT_SCHEMA_KEYS,
        MAX_ROLES,
        ONBOARDING_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        parseActivationJourney,
        PROFILES_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        serializeActivationJourney,
        TEMPLATES_CONTRACTS_VERSION,
        validateJourneyDecisionMirror,
        validateJourneyRecordContent,
        validateActivationJourneyRecord,
        ACTIVATION_OP_NAMES,
        isActivationOpName,
        journeyLegIndex,
} from '../../common/activationContract.js';
import type { ActivationJourneyRecord } from '../../common/activationContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/activationContract.ts', import.meta.url)), 'utf8');

/** THE SCENARIO-BINDING LAW's pin-by-import: the benchmark fixture binds the REAL registry ids (never a fabricated list). */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

// --- the shared fixtures (THE CONTENT LAW: the caller supplies the domain content; fixture level) ---

function greenJourneyRecord(): Record<string, unknown> {
        return {
                journeyId: 'flauz:jrn:0123456789abcdef',
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
                onboardingSessionId: null,
                createdAtIso: '2026-01-01T00:00:00.000Z',
                revision: 1,
                history: [
                        { at: '2026-01-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began the journey' },
                ],
        };
}

function walkedJourneyRecord(): Record<string, unknown> {
        const record = greenJourneyRecord();
        record.stage = 'composed';
        record.industry = 'software';
        record.companyProfile = { displayName: 'fixture litigation harness', sizeBand: 'small' };
        record.workTypes = ['analysis', 'drafting', 'review'];
        record.rolesSession = {
                sessionId: 'flauz:rol:0123456789abcdee',
                industry: 'software',
                stage: 'composed',
                roles: [
                        { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
                        { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
                ],
                history: [
                        { at: '2026-01-01T00:00:01.000Z', fromStage: null, toStage: 'composing', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail: 'began' },
                        { at: '2026-01-01T00:00:02.000Z', fromStage: 'composing', toStage: 'composed', op: 'finalize-composition', law: 'THE FORWARD-ONLY LAW', detail: 'finalized' },
                ],
        };
        record.history = [
                { at: '2026-01-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began' },
                { at: '2026-01-01T00:00:01.000Z', leg: 'industry-selection', fromStage: 'selection', toStage: 'selection', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail: 'industry' },
                { at: '2026-01-01T00:00:02.000Z', leg: 'company-composition', fromStage: 'selection', toStage: 'selection', op: 'compose-company', law: 'THE FORWARD-ONLY LAW', detail: 'company' },
                { at: '2026-01-01T00:00:03.000Z', leg: 'work-type-selection', fromStage: 'selection', toStage: 'selection', op: 'select-work-types', law: 'THE FORWARD-ONLY LAW', detail: 'work types' },
                { at: '2026-01-01T00:00:04.000Z', leg: 'role-composition', fromStage: 'selection', toStage: 'composed', op: 'compose-roles', law: 'THE MULTI-ROLE LAW', detail: 'roles' },
        ];
        record.revision = 5;
        return record;
}

function greenRecordContent(): Record<string, unknown> {
        return {
                terms: [
                        { term: 'fixture.discovery', definition: 'the fixture discovery term' },
                        { term: 'fixture.affidavit', definition: 'the fixture affidavit term' },
                ],
                tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['fixture.discovery'] }],
                bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst'] }],
                packs: [{ packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] }],
                profiles: [{
                        profileKey: 'core',
                        summary: 'The core policy profile.',
                        permissionRefs: ['read-files'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'local-real',
                        kpiDimensions: ['success', 'cost'],
                }],
                benchmarks: [{
                        benchmarkKey: 'regression-suite-health',
                        summary: 'The regression suite health benchmark.',
                        hypothesis: 'A composed agent organization completes the seeded regression-fix scenarios with a higher success rate than the single-agent baseline.',
                        scenarioRefs: [...REAL_SCENARIO_IDS],
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The candidate clears every acceptance criterion on at least 6 of 8 seeded instances per scenario.',
                        limitations: 'Fixture worlds over a synthetic repository; no real telemetry, no live repositories, single-seed runs only.',
                        evidenceLevel: 'fixture',
                }],
        };
}

function rejectionOf(outcome: { ok: boolean; rejection?: { reason: string; law: string; message: string; items?: readonly string[]; familyRejections?: readonly unknown[] } }): { reason: string; law: string; message: string; items?: readonly string[]; familyRejections?: readonly unknown[] } {
        if (outcome.ok || outcome.rejection === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejection;
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('activationContract · THE SINGLE-VERSION LAW cross-pins', () => {
        test('ACTIVATION_CONTRACTS_VERSION is 1.0.0 and JOURNEY_ID_PREFIX is flauz:jrn:', () => {
                assert.equal(ACTIVATION_CONTRACTS_VERSION, '1.0.0');
                assert.equal(JOURNEY_ID_PREFIX, 'flauz:jrn:');
        });

        test('the NINE prior family versions are re-carried equal by reference (DH-01..DH-09)', () => {
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_CONTRACTS_VERSION);
                assert.equal(ROLES_CONTRACTS_VERSION, REAL_ROLES_CONTRACTS_VERSION);
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, REAL_ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(TEMPLATES_CONTRACTS_VERSION, REAL_TEMPLATES_CONTRACTS_VERSION);
                assert.equal(BODIES_CONTRACTS_VERSION, REAL_BODIES_CONTRACTS_VERSION);
                assert.equal(PACKS_CONTRACTS_VERSION, REAL_PACKS_CONTRACTS_VERSION);
                assert.equal(PROFILES_CONTRACTS_VERSION, REAL_PROFILES_CONTRACTS_VERSION);
                assert.equal(BENCHMARKS_CONTRACTS_VERSION, REAL_BENCHMARKS_CONTRACTS_VERSION);
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
                assert.equal(TEMPLATES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(BODIES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(PACKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(PROFILES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(BENCHMARKS_CONTRACTS_VERSION, '1.0.0');
        });

        test('MAX_ROLES is the REAL DH-03 bound (32), imported by reference - THE MULTI-ROLE LAW', () => {
                assert.equal(MAX_ROLES, REAL_MAX_ROLES);
                assert.equal(MAX_ROLES, 32);
        });

        test('the version is declared ONCE (the single declaration law)', () => {
                const declarations = CONTRACT_SOURCE.match(/export const ACTIVATION_CONTRACTS_VERSION =/g) ?? [];
                assert.equal(declarations.length, 1);
        });
});

suite('activationContract · THE FORWARD-ONLY LAW (the journey stage machine)', () => {
        test('ACTIVATION_STAGES is the frozen five-stage walk (selection -> composed -> proposed -> approved -> active)', () => {
                assert.deepStrictEqual([...ACTIVATION_STAGES], ['selection', 'composed', 'proposed', 'approved', 'active']);
        });

        test('ACTIVATION_FORWARD_TRANSITIONS is the frozen four-row whitelist', () => {
                assert.deepStrictEqual([...ACTIVATION_FORWARD_TRANSITIONS], [
                        { from: 'selection', to: 'composed' },
                        { from: 'composed', to: 'proposed' },
                        { from: 'proposed', to: 'approved' },
                        { from: 'approved', to: 'active' },
                ]);
        });

        test('every whitelisted row grants with its 1-based row number', () => {
                assert.deepStrictEqual(canTransitionActivationStage('selection', 'composed'), { ok: true, from: 'selection', to: 'composed', row: 1 });
                assert.deepStrictEqual(canTransitionActivationStage('composed', 'proposed'), { ok: true, from: 'composed', to: 'proposed', row: 2 });
                assert.deepStrictEqual(canTransitionActivationStage('proposed', 'approved'), { ok: true, from: 'proposed', to: 'approved', row: 3 });
                assert.deepStrictEqual(canTransitionActivationStage('approved', 'active'), { ok: true, from: 'approved', to: 'active', row: 4 });
        });

        test('a skip (selection -> proposed) refuses naming the whitelisted successor', () => {
                const verdict = canTransitionActivationStage('selection', 'proposed');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, 1);
                assert.equal(verdict.expectedTo, 'composed');
                assert.match(verdict.detail, /THE FORWARD-ONLY LAW/);
        });

        test('a backwards move (approved -> proposed) refuses naming the whitelisted successor', () => {
                const verdict = canTransitionActivationStage('approved', 'proposed');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, 4);
                assert.equal(verdict.expectedTo, 'active');
        });

        test("a self-loop (composed -> composed) refuses (the stage edges are strict)", () => {
                const verdict = canTransitionActivationStage('composed', 'composed');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, 2);
                assert.equal(verdict.expectedTo, 'proposed');
        });

        test("'active' is TERMINAL for the journey record (THE EVIDENCE-NOT-AUTHORITY LAW)", () => {
                const verdict = canTransitionActivationStage('active', 'active');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, null);
                assert.equal(verdict.expectedTo, null);
                assert.match(verdict.detail, /TERMINAL/);
                assert.match(verdict.detail, /REAL DH-01 kit/);
        });

        test('unknown or non-string stages refuse closed (both sides)', () => {
                for (const pair of [[7, 'composed'], ['composed', 7], ['hatched', 'composed'], ['composed', 'hatched'], [null, 'active'], ['active', null]] as const) {
                        const verdict = canTransitionActivationStage(pair[0], pair[1]);
                        assert.ok(!verdict.ok, `the pair ${JSON.stringify(pair)} must refuse`);
                        assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                }
        });

        test('the stage predicate is closed over the frozen list', () => {
                for (const stage of ACTIVATION_STAGES) {
                        assert.ok(isActivationJourneyStage(stage), `the stage '${stage}' must be a member`);
                }
                assert.ok(!isActivationJourneyStage('draft'));
                assert.ok(!isActivationJourneyStage('hatched'));
                assert.ok(!isActivationJourneyStage(7));
        });
});

suite('activationContract · the frozen journey-leg vocabulary', () => {
        test('JOURNEY_LEGS is the frozen nine-leg walk in the registry row order', () => {
                assert.deepStrictEqual([...JOURNEY_LEGS], [
                        'industry-selection',
                        'company-composition',
                        'work-type-selection',
                        'role-composition',
                        'record-composition',
                        'proposal',
                        'validation',
                        'approval',
                        'activation',
                ]);
        });

        test('ACTIVATION_OP_NAMES is the frozen nine-op vocabulary', () => {
                assert.deepStrictEqual([...ACTIVATION_OP_NAMES], [
                        'begin-journey',
                        'select-industry',
                        'compose-company',
                        'select-work-types',
                        'compose-roles',
                        'compose-records',
                        'propose-harness',
                        'approve-harness',
                        'activate-harness',
                ]);
        });

        test('JOURNEY_OP_LEGS is the frozen op->legs table (propose-harness walks proposal then validation)', () => {
                assert.deepStrictEqual(JOURNEY_OP_LEGS['begin-journey'], []);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['select-industry'], ['industry-selection']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['compose-company'], ['company-composition']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['select-work-types'], ['work-type-selection']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['compose-roles'], ['role-composition']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['compose-records'], ['record-composition']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['propose-harness'], ['proposal', 'validation']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['approve-harness'], ['approval']);
                assert.deepStrictEqual(JOURNEY_OP_LEGS['activate-harness'], ['activation']);
        });

        test('JOURNEY_OP_REQUIRED_LEGS is the frozen prerequisites table (the walk order law)', () => {
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['begin-journey'], []);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['select-industry'], []);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['compose-company'], ['industry-selection']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['select-work-types'], ['company-composition']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['compose-roles'], ['work-type-selection']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['compose-records'], ['role-composition']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['propose-harness'], ['record-composition']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['approve-harness'], ['validation']);
                assert.deepStrictEqual(JOURNEY_OP_REQUIRED_LEGS['activate-harness'], ['approval']);
        });

        test('JOURNEY_LEG_STAGES is the frozen leg->stage table (the journey stages mirror the real DH-01 lifecycle)', () => {
                assert.deepStrictEqual({ ...JOURNEY_LEG_STAGES } as Record<string, unknown>, {
                        'industry-selection': 'selection',
                        'company-composition': 'selection',
                        'work-type-selection': 'selection',
                        'role-composition': 'composed',
                        'record-composition': 'composed',
                        proposal: 'composed',
                        validation: 'proposed',
                        approval: 'approved',
                        activation: 'active',
                });
        });

        test('the leg and op predicates are closed; journeyLegIndex walks the frozen order', () => {
                for (const leg of JOURNEY_LEGS) {
                        assert.ok(isJourneyLeg(leg), `the leg '${leg}' must be a member`);
                }
                assert.ok(!isJourneyLeg('inspection'));
                assert.ok(!isJourneyLeg(7));
                for (const op of ACTIVATION_OP_NAMES) {
                        assert.ok(isActivationOpName(op), `the op '${op}' must be a member`);
                }
                assert.ok(!isActivationOpName('inspect-journey'));
                assert.equal(journeyLegIndex('industry-selection'), 0);
                assert.equal(journeyLegIndex('activation'), 8);
                assert.equal(journeyLegIndex('not-a-leg'), -1);
        });

        test('the journey id alphabet is the frozen flauz:jrn:<16-hex> form', () => {
                assert.ok(isJourneyId('flauz:jrn:0123456789abcdef'));
                assert.ok(!isJourneyId('flauz:jrn:0123456789abcde'));
                assert.ok(!isJourneyId('flauz:jrn:0123456789abcdeff'));
                assert.ok(!isJourneyId('flauz:jrn:0123456789ABCDEF'));
                assert.ok(!isJourneyId('flauz:hrn:0123456789abcdef'));
                assert.ok(!isJourneyId('flauz:jrn:gggggggggggggggg'));
                assert.ok(!isJourneyId(7));
                assert.ok(!isJourneyId(null));
        });
});

suite('activationContract · THE REJECTION VOCABULARY (the fail-closed law, typed)', () => {
        test('ACTIVATION_JOURNEY_REJECTION_REASONS is the frozen eighteen-station walk order', () => {
                assert.deepStrictEqual([...ACTIVATION_JOURNEY_REJECTION_REASONS], [
                        'disposed',
                        'unknown-journey',
                        'malformed-record',
                        'malformed-catalog',
                        'premature-leg',
                        'stale-leg',
                        'incomplete-composition',
                        'unsafe-proposal',
                        'approval-missing',
                        'dangling-ref-at-proposal',
                        'catalog-binding-refused',
                        'unapproved-capability',
                        'malformed-decision',
                        'onboarding-refused',
                        'roles-refused',
                        'record-refused',
                        'harness-refused',
                        'version-mismatch',
                ]);
        });

        test('every row-core law is named in the frozen list (THE FAIL-CLOSED LAW, THE CATALOG-BINDING LAW, THE APPROVAL-BEFORE-ACTIVATION LAW)', () => {
                for (const reason of ACTIVATION_JOURNEY_REJECTION_REASONS) {
                        assert.ok(isActivationJourneyRejectionReason(reason), `the reason '${reason}' must be a member`);
                }
                for (const core of ['dangling-ref-at-proposal', 'catalog-binding-refused', 'unapproved-capability', 'incomplete-composition', 'unsafe-proposal', 'approval-missing'] as const) {
                        assert.ok((ACTIVATION_JOURNEY_REJECTION_REASONS as readonly string[]).includes(core), `the core law '${core}' is a frozen member`);
                }
                assert.ok(!isActivationJourneyRejectionReason('not-a-reason'));
        });

        test('ACTIVATION_PARSE_REJECTION_REASONS is the frozen five-reason parse shape', () => {
                assert.deepStrictEqual([...ACTIVATION_PARSE_REJECTION_REASONS], [
                        'malformed-json',
                        'torn-envelope',
                        'unknown-contract-version',
                        'unknown-key',
                        'invalid-record',
                ]);
                assert.ok(!isActivationParseRejectionReason('not-a-parse-reason'));
        });
});

suite('activationContract · validateJourneyRecordContent (THE CONTENT LAW + THE IMPORT LAW)', () => {
        test('green content walks with the canonical fixed-key-order copy', () => {
                const outcome = validateJourneyRecordContent(greenRecordContent());
                assert.ok(outcome.ok);
                assert.deepStrictEqual(Object.keys(outcome.value), [...JOURNEY_RECORD_CONTENT_SCHEMA_KEYS]);
                assert.equal(outcome.value.terms.length, 2);
                assert.equal(outcome.value.tasks[0].termRefs[0], 'fixture.discovery');
        });

        test('a non-object content is the typed malformed-record refusal', () => {
                const rejection = rejectionOf(validateJourneyRecordContent('nope'));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE FAIL-CLOSED LAW');
        });

        test('an unknown key is the strict-schema refusal (the six-family alphabet is closed)', () => {
                const content = clone(greenRecordContent());
                (content as Record<string, unknown>).tools = 'fixture-tools';
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE STRICT-SCHEMA LAW');
                assert.deepStrictEqual(rejection.items, ['tools']);
        });

        test('a missing family key is the typed missing-key refusal (an empty family is an EMPTY array, never an absent key)', () => {
                const content = clone(greenRecordContent());
                delete (content as Record<string, unknown>).packs;
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'malformed-record');
                assert.deepStrictEqual(rejection.items, ['packs']);
        });

        test('a wrong carrier type is the typed malformed-record refusal', () => {
                const content = clone(greenRecordContent());
                (content as Record<string, unknown>).terms = 'nope';
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'malformed-record');
                assert.deepStrictEqual(rejection.items, ['terms']);
        });

        test('a malformed term entry surfaces the REAL DH-04 validator verbatim (the complete typed rejection table)', () => {
                const content = clone(greenRecordContent());
                (content.terms as Record<string, unknown>[])[1] = { term: ' padded ', definition: '' };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(terms\[1\]\)/);
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0, 'the OWNING family table is carried complete');
        });

        test('a malformed task entry surfaces the REAL DH-05 validator verbatim', () => {
                const content = clone(greenRecordContent());
                (content.tasks as Record<string, unknown>[])[0] = { taskKey: 'survey', summary: '', termRefs: 'nope' };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(tasks\[0\]\)/);
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test('a malformed body entry surfaces the REAL DH-06 validator verbatim', () => {
                const content = clone(greenRecordContent());
                (content.bodies as Record<string, unknown>[])[0] = { bodyKey: ' x ', summary: '', roleRefs: 'nope', model: 1 };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(bodies\[0\]\)/);
        });

        test('a malformed pack entry surfaces the REAL DH-07 validator verbatim', () => {
                const content = clone(greenRecordContent());
                (content.packs as Record<string, unknown>[])[0] = { packKey: 'core', summary: 'The core pack.', bodyRefs: 'nope' };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(packs\[0\]\)/);
        });

        test('a malformed profile entry surfaces the REAL DH-08 validator verbatim (the authority-binding law)', () => {
                const content = clone(greenRecordContent());
                (content.profiles as Record<string, unknown>[])[0] = {
                        profileKey: 'core',
                        summary: 'The core policy profile.',
                        permissionRefs: ['not-a-real-permission'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'local-real',
                        kpiDimensions: ['success', 'cost'],
                };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(profiles\[0\]\)/);
        });

        test('a malformed benchmark entry surfaces the REAL DH-09 validator verbatim (the scenario-binding law)', () => {
                const content = clone(greenRecordContent());
                (content.benchmarks as Record<string, unknown>[])[0] = {
                        benchmarkKey: 'regression-suite-health',
                        summary: 'The regression suite health benchmark.',
                        hypothesis: 'The hypothesis sentence.',
                        scenarioRefs: ['scenario-se-fabricated-ghost'],
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The expected outcome sentence.',
                        limitations: 'The limitations sentence.',
                        evidenceLevel: 'simulated',
                };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.equal(rejection.reason, 'record-refused');
                assert.match(rejection.law, /THE VERBATIM-CARRY LAW \(benchmarks\[0\]\)/);
        });

        test('the first failing family is the verdict (the frozen family order: terms before tasks)', () => {
                const content = clone(greenRecordContent());
                (content.terms as Record<string, unknown>[])[0] = { term: 7, definition: 'the definition' };
                (content.tasks as Record<string, unknown>[])[0] = { taskKey: 7, summary: 'Survey.', termRefs: [] };
                const rejection = rejectionOf(validateJourneyRecordContent(content));
                assert.match(rejection.law, /terms\[0\]/);
        });
});

suite('activationContract · validateActivationJourneyRecord (THE EVIDENCE-NOT-AUTHORITY LAW\'s honest shape)', () => {
        test('a green begin-stage record walks with the canonical copy', () => {
                const outcome = validateActivationJourneyRecord(greenJourneyRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'selection');
                assert.equal(outcome.record.revision, 1);
                assert.deepEqual([...outcome.record.history[0] && Object.keys(outcome.record.history[0])], [...ACTIVATION_NOTE_SCHEMA_KEYS]);
        });

        test('a green walked record (industry/company/workTypes/rolesSession) walks', () => {
                const outcome = validateActivationJourneyRecord(walkedJourneyRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.record.stage, 'composed');
                assert.equal(outcome.record.rolesSession?.roles.length, 2);
                assert.equal(outcome.record.industry, 'software');
        });

        test('a non-object record is the typed malformed-record refusal', () => {
                const rejection = rejectionOf(validateActivationJourneyRecord(7));
                assert.equal(rejection.reason, 'malformed-record');
        });

        test('a wrong structural field is the typed malformed-record refusal (stage / revision / createdAtIso / carriers)', () => {
                for (const [field, value] of [['stage', 'hatched'], ['revision', 0], ['revision', 1.5], ['createdAtIso', ''], ['workTypes', 'nope'], ['rolesSession', 'nope'], ['recordLinks', 'nope'], ['companyProfile', 'nope'], ['history', 'nope'], ['onboardingSessionId', 'not-an-id']] as const) {
                        const record = clone(greenJourneyRecord());
                        (record as Record<string, unknown>)[field] = value;
                        const rejection = rejectionOf(validateActivationJourneyRecord(record));
                        assert.equal(rejection.reason, 'malformed-record', `the field '${field}' must refuse malformed`);
                        assert.ok((rejection.items ?? []).includes(field as string));
                }
        });

        test('an unknown key is the strict-schema refusal (the evidence alphabet is frozen)', () => {
                const record = clone(greenJourneyRecord());
                (record as Record<string, unknown>).escalationBroker = 'never';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE STRICT-SCHEMA LAW');
                assert.deepStrictEqual(rejection.items, ['escalationBroker']);
        });

        test('a missing key is the typed refusal', () => {
                const record = clone(greenJourneyRecord());
                delete (record as Record<string, unknown>).approval;
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.deepStrictEqual(rejection.items, ['approval']);
        });

        test('a malformed journey id fails closed as unknown-journey (the DH-01 NOT_FOUND discipline)', () => {
                const record = clone(greenJourneyRecord());
                record.journeyId = 'flauz:jrn:zzzzzzzzzzzzzzzz';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'unknown-journey');
        });

        test('a foreign contract version is the typed version-mismatch refusal', () => {
                const record = clone(greenJourneyRecord());
                record.contractVersion = '0.9.0';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'version-mismatch');
                assert.equal(rejection.law, 'THE SINGLE-VERSION LAW');
        });

        test('a non-member industry is the typed malformed-record refusal (the frozen DH-01 list, imported)', () => {
                const record = clone(greenJourneyRecord());
                record.industry = 'aerospace';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /HARNESS_INDUSTRIES/);
        });

        test('a malformed company profile surfaces the REAL DH-02 validator verbatim', () => {
                const record = clone(walkedJourneyRecord());
                record.companyProfile = { displayName: 'fixture litigation harness', sizeBand: 'giant' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test('a malformed work-type selection surfaces the REAL DH-02 validator verbatim', () => {
                const record = clone(walkedJourneyRecord());
                record.workTypes = ['analysis', 'teleportation'];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.ok(Array.isArray(rejection.familyRejections));
        });

        test('a malformed roles session surfaces the REAL DH-03 validator verbatim', () => {
                const record = clone(walkedJourneyRecord());
                (record.rolesSession as Record<string, unknown>).roles = [{ roleKey: 7, summary: 'Runs the domain analysis.' }];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test("a non-composed roles session refuses (the journey records ONLY composed sessions - THE MULTI-ROLE LAW's evidence)", () => {
                const record = clone(walkedJourneyRecord());
                (record.rolesSession as Record<string, unknown>).stage = 'composing';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /ONLY composed role sessions/);
        });

        test('a zero-role session refuses (the REAL DH-03 floor: one user may hold MULTIPLE roles, never zero)', () => {
                const record = clone(walkedJourneyRecord());
                (record.rolesSession as Record<string, unknown>).roles = [];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE MULTI-ROLE LAW');
        });

        test(`a session above MAX_ROLES (${MAX_ROLES}) refuses (the REAL DH-03 composition bound, imported by reference)`, () => {
                const record = clone(walkedJourneyRecord());
                const roles: Record<string, unknown>[] = [];
                for (let i = 1; i <= MAX_ROLES + 1; i += 1) {
                        roles.push({ roleKey: `fixture.role-${String(i).padStart(2, '0')}`, summary: `the fixture role ${i} summary` });
                }
                (record.rolesSession as Record<string, unknown>).roles = roles;
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                // the REAL DH-03 session walk refuses the over-bound session first - the
                // complete typed rejection table is surfaced verbatim (THE IMPORT LAW).
                assert.ok(Array.isArray(rejection.familyRejections) && rejection.familyRejections.length > 0);
        });

        test("a roles-session industry that disagrees with the journey's industry refuses (the agreement law)", () => {
                const record = clone(walkedJourneyRecord());
                record.industry = 'legal';
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /agreement law/);
        });

        test('a malformed composed-links key set refuses (the six-family link schema is closed)', () => {
                const record = clone(walkedJourneyRecord());
                record.recordLinks = { ontologyId: 'flauz:ont:0123456789abcdef' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE STRICT-SCHEMA LAW');
        });

        test('a composed link of the wrong family id form refuses (the OWNING family predicate, imported)', () => {
                const record = clone(walkedJourneyRecord());
                record.recordLinks = {
                        ontologyId: 'flauz:ont:0123456789abcdef',
                        templateId: 'flauz:tpl:0123456789abcdef',
                        bodyId: 'flauz:bod:0123456789abcdef',
                        packsId: 'flauz:pak:0123456789abcdeff',
                        profilesId: 'flauz:prf:0123456789abcdef',
                        benchmarksId: 'flauz:ben:0123456789abcdef',
                };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.deepStrictEqual(rejection.items, ['packsId']);
        });

        test('a malformed binding/current harness id refuses (the REAL DH-01 alphabet, imported)', () => {
                for (const field of ['bindingHarnessId', 'harnessId'] as const) {
                        const record = clone(walkedJourneyRecord());
                        record[field] = 'flauz:jrn:0123456789abcdef';
                        const rejection = rejectionOf(validateActivationJourneyRecord(record));
                        assert.equal(rejection.reason, 'malformed-record', `the field '${field}' must refuse a foreign id form`);
                }
        });

        test('a malformed validation column refuses (the REAL DH-01 predicate, imported)', () => {
                const record = clone(walkedJourneyRecord());
                record.validation = { ok: true, mode: 'shape' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /isHarnessValidationOutcome/);
        });

        test("a refusal-shaped validation column refuses (the journey records ONLY the boundary's green FULL outcome)", () => {
                const record = clone(walkedJourneyRecord());
                record.validation = {
                        ok: false,
                        mode: 'full',
                        rejections: [{ reason: 'dangling-ref', law: 'THE NO-DANGLING-REF LAW', family: 'capabilityRefs', items: ['flauz:pak:0123456789abcdef'], detail: 'the refusal detail' }],
                };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE TWO-PHASE LAW');
        });

        test('a shape-mode green outcome refuses (only the FULL walk is the proposal boundary evidence)', () => {
                const record = clone(walkedJourneyRecord());
                record.validation = {
                        ok: true,
                        mode: 'shape',
                        descriptor: {
                                harnessId: 'flauz:hrn:0123456789abcdef',
                                contractVersion: '1.0.0',
                                industry: 'software',
                                workTypes: ['analysis'],
                                displayName: 'Fixture Harness',
                                roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
                                capabilityRefs: [],
                                workflowRefs: [],
                                policyRefs: [],
                                evidenceRefs: [],
                        },
                };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.equal(rejection.law, 'THE TWO-PHASE LAW');
        });

        test('a malformed approval mirror refuses (the { approvedBy, note? } evidence shape)', () => {
                const record = clone(walkedJourneyRecord());
                record.approval = { approver: 'fixture-approver' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /approvedBy/);
        });

        test('a malformed activation mirror refuses (the { activatedBy } evidence shape)', () => {
                const record = clone(walkedJourneyRecord());
                record.activation = { approvedBy: 'fixture-approver' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /activatedBy/);
        });

        test('an empty history refuses (the begin note is required)', () => {
                const record = clone(greenJourneyRecord());
                record.history = [];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.equal(rejection.reason, 'malformed-record');
                assert.match(rejection.message, /begin note/);
        });

        test('a non-begin first note refuses (the begin note is the walk entry)', () => {
                const record = clone(greenJourneyRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', leg: 'industry-selection', fromStage: 'selection', toStage: 'selection', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail: 'industry' }];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /first note must be the begin note/);
        });

        test('a begin note with a non-null leg refuses', () => {
                const record = clone(greenJourneyRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', leg: 'industry-selection', fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began' }];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /begin note/);
        });

        test('a leg out of the frozen order refuses (the journey legs never walk back)', () => {
                const record = clone(walkedJourneyRecord());
                (record.history as Record<string, unknown>[])[4] = { at: '2026-01-01T00:00:04.000Z', leg: 'industry-selection', fromStage: 'selection', toStage: 'selection', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail: 'industry again' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /frozen leg order/);
        });

        test('an op carrying a foreign leg refuses (the frozen op<->leg table)', () => {
                const record = clone(walkedJourneyRecord());
                (record.history as Record<string, unknown>[])[1] = { at: '2026-01-01T00:00:01.000Z', leg: 'company-composition', fromStage: 'selection', toStage: 'selection', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail: 'industry' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /op's own legs/);
        });

        test('a broken stage chain refuses (fromStage != the walk\'s current stage)', () => {
                const record = clone(walkedJourneyRecord());
                (record.history as Record<string, unknown>[])[2] = { at: '2026-01-01T00:00:02.000Z', leg: 'company-composition', fromStage: 'composed', toStage: 'selection', op: 'compose-company', law: 'THE FORWARD-ONLY LAW', detail: 'company' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /stage chain/);
        });

        test('a note walking a leg to the wrong stage refuses (the frozen leg<->stage table)', () => {
                const record = clone(walkedJourneyRecord());
                (record.history as Record<string, unknown>[])[4] = { at: '2026-01-01T00:00:04.000Z', leg: 'role-composition', fromStage: 'selection', toStage: 'selection', op: 'compose-roles', law: 'THE MULTI-ROLE LAW', detail: 'roles' };
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /leg<->stage table/);
        });

        test('a note outside the frozen seven-key schema refuses', () => {
                const record = clone(greenJourneyRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began', sessionId: 'flauz:onb:0123456789abcdef' }];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /seven-key note schema/);
        });

        test('a note with an unknown op refuses', () => {
                const record = clone(greenJourneyRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'selection', op: 'inspect-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began' }];
                const rejection = rejectionOf(validateActivationJourneyRecord(record));
                assert.match(rejection.message, /unknown op/);
        });
});

suite('activationContract · validateJourneyDecisionMirror (the EVIDENCE mirrors)', () => {
        test('the approved mirror walks green with the canonical { approvedBy, note? } copy', () => {
                const outcome = validateJourneyDecisionMirror({ approvedBy: 'fixture-approver', note: 'the fixture approval note' }, 'approved');
                assert.ok(outcome.ok);
                assert.deepStrictEqual({ ...outcome.value }, { approvedBy: 'fixture-approver', note: 'the fixture approval note' });
        });

        test('the approved mirror walks green without the optional note', () => {
                const outcome = validateJourneyDecisionMirror({ approvedBy: 'fixture-approver' }, 'approved');
                assert.ok(outcome.ok);
                assert.deepStrictEqual({ ...outcome.value }, { approvedBy: 'fixture-approver' });
        });

        test('the active mirror walks green with the canonical { activatedBy } copy', () => {
                const outcome = validateJourneyDecisionMirror({ activatedBy: 'fixture-activator' }, 'active');
                assert.ok(outcome.ok);
                assert.deepStrictEqual({ ...outcome.value }, { activatedBy: 'fixture-activator' });
        });

        test('an unknown key refuses (the mirrors are the real kit decision shapes, never widened)', () => {
                const outcome = validateJourneyDecisionMirror({ approvedBy: 'fixture-approver', escalated: true }, 'approved');
                assert.ok(!outcome.ok);
                assert.match(outcome.message, /unknown key 'escalated'/);
                const activeOutcome = validateJourneyDecisionMirror({ activatedBy: 'fixture-activator', note: 'nope' }, 'active');
                assert.ok(!activeOutcome.ok);
                assert.match(activeOutcome.message, /unknown key 'note'/);
        });

        test('a missing required key refuses', () => {
                const outcome = validateJourneyDecisionMirror({}, 'approved');
                assert.ok(!outcome.ok);
                assert.match(outcome.message, /requires the 'approvedBy' key/);
                const activeOutcome = validateJourneyDecisionMirror({}, 'active');
                assert.ok(!activeOutcome.ok);
                assert.match(activeOutcome.message, /requires the 'activatedBy' key/);
        });

        test('a non-string or empty value refuses; a non-object refuses', () => {
                assert.ok(!validateJourneyDecisionMirror({ approvedBy: '' }, 'approved').ok);
                assert.ok(!validateJourneyDecisionMirror({ approvedBy: 7 }, 'approved').ok);
                assert.ok(!validateJourneyDecisionMirror('nope', 'approved').ok);
                assert.ok(!validateJourneyDecisionMirror({ activatedBy: '' }, 'active').ok);
        });
});

suite('activationContract · THE CANONICAL SERIALIZATION', () => {
        test('the record schema keys are the frozen seventeen-key canonical order', () => {
                assert.deepStrictEqual([...ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS], [
                        'journeyId',
                        'contractVersion',
                        'stage',
                        'industry',
                        'companyProfile',
                        'workTypes',
                        'rolesSession',
                        'recordLinks',
                        'bindingHarnessId',
                        'harnessId',
                        'validation',
                        'approval',
                        'activation',
                        'onboardingSessionId',
                        'createdAtIso',
                        'revision',
                        'history',
                ]);
        });

        test('the note schema keys are the frozen seven-key order and the content keys the frozen six-family order', () => {
                assert.deepStrictEqual([...ACTIVATION_NOTE_SCHEMA_KEYS], ['at', 'leg', 'fromStage', 'toStage', 'op', 'law', 'detail']);
                assert.deepStrictEqual([...JOURNEY_RECORD_CONTENT_SCHEMA_KEYS], ['terms', 'tasks', 'bodies', 'packs', 'profiles', 'benchmarks']);
                assert.deepStrictEqual([...COMPOSED_RECORD_LINKS_SCHEMA_KEYS], ['ontologyId', 'templateId', 'bodyId', 'packsId', 'profilesId', 'benchmarksId']);
        });

        test('the canonical bytes carry the fixed key order at every level (the byte pin)', () => {
                const bytes = serializeActivationJourney(walkedJourneyRecord() as unknown as ActivationJourneyRecord);
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...ACTIVATION_JOURNEY_RECORD_SCHEMA_KEYS]);
                const session = parsed.rolesSession as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(session), ['sessionId', 'industry', 'stage', 'roles', 'history']);
                assert.deepStrictEqual(Object.keys((session.roles as Record<string, unknown>[])[0]), ['roleKey', 'summary']);
                assert.deepStrictEqual(Object.keys((parsed.history as Record<string, unknown>[])[0]), [...ACTIVATION_NOTE_SCHEMA_KEYS]);
                assert.deepStrictEqual(Object.keys(parsed.companyProfile as Record<string, unknown>), ['displayName', 'sizeBand']);
        });

        test('an invalid record never gets canonical bytes (the TypeError - no dishonest evidence)', () => {
                assert.throws(() => serializeActivationJourney(7), TypeError);
                const record = clone(greenJourneyRecord());
                (record as Record<string, unknown>).stage = 'hatched';
                assert.throws(() => serializeActivationJourney(record), TypeError);
        });

        test('the round-trip: serialize -> parse -> serialize is byte-identical', () => {
                const first = serializeActivationJourney(walkedJourneyRecord() as unknown as ActivationJourneyRecord);
                const parsed = parseActivationJourney(first);
                assert.ok(parsed.ok);
                const second = serializeActivationJourney(parsed.record);
                assert.equal(second, first);
        });
});

suite('activationContract · THE FAIL-CLOSED PARSE', () => {
        test('malformed-json is the typed refusal', () => {
                const outcome = parseActivationJourney('{"journeyId":');
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'malformed-json');
        });

        test('a non-string byte carrier is the torn-envelope refusal', () => {
                const outcome = parseActivationJourney(7);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('a missing record key is the torn-envelope refusal (never a silent partial parse)', () => {
                const record = clone(greenJourneyRecord());
                delete (record as Record<string, unknown>).revision;
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
                assert.match(outcome.rejection.message, /'revision' key is missing/);
        });

        test('a wrong structural value is the torn-envelope refusal', () => {
                const record = clone(greenJourneyRecord());
                record.history = 'nope';
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('a foreign contract version is the unknown-contract-version refusal', () => {
                const record = clone(greenJourneyRecord());
                record.contractVersion = '2.0.0';
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-contract-version');
        });

        test('an unknown record-level key is the unknown-key refusal', () => {
                const record = clone(greenJourneyRecord());
                (record as Record<string, unknown>).secondJournal = true;
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-key');
                assert.match(outcome.rejection.message, /'secondJournal'/);
        });

        test('an unknown composed-links key is the unknown-key refusal', () => {
                const record = clone(walkedJourneyRecord());
                record.recordLinks = {
                        ontologyId: 'flauz:ont:0123456789abcdef',
                        templateId: 'flauz:tpl:0123456789abcdef',
                        bodyId: 'flauz:bod:0123456789abcdef',
                        packsId: 'flauz:pak:0123456789abcdef',
                        profilesId: 'flauz:prf:0123456789abcdef',
                        benchmarksId: 'flauz:ben:0123456789abcdef',
                        extraId: 'flauz:xxx:0123456789abcdef',
                };
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-key');
                assert.match(outcome.rejection.message, /composed links/);
        });

        test('an unknown roles-session key is the unknown-key refusal (the REAL DH-03 five-key schema)', () => {
                const record = clone(walkedJourneyRecord());
                (record.rolesSession as Record<string, unknown>).escalation = 'never';
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-key');
                assert.match(outcome.rejection.message, /roles session/);
        });

        test('an unknown approval/activation mirror key is the unknown-key refusal', () => {
                const record = clone(walkedJourneyRecord());
                record.approval = { approvedBy: 'fixture-approver', broker: 'never' };
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-key');
                assert.match(outcome.rejection.message, /approval mirror/);
                const activationRecord = clone(walkedJourneyRecord());
                activationRecord.activation = { activatedBy: 'fixture-activator', note: 'nope' };
                const activationOutcome = parseActivationJourney(JSON.stringify(activationRecord));
                assert.ok(!activationOutcome.ok);
                assert.equal(activationOutcome.rejection.reason, 'unknown-key');
                assert.match(activationOutcome.rejection.message, /activation mirror/);
        });

        test('an unknown note key is the unknown-key refusal', () => {
                const record = clone(greenJourneyRecord());
                (record.history as Record<string, unknown>[])[0] = { at: '2026-01-01T00:00:00.000Z', leg: null, fromStage: null, toStage: 'selection', op: 'begin-journey', law: 'THE FORWARD-ONLY LAW', detail: 'began', forged: true };
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'unknown-key');
                assert.match(outcome.rejection.message, /note 1/);
        });

        test('a deep-walk refusal surfaces as invalid-record', () => {
                const record = clone(greenJourneyRecord());
                record.industry = 'aerospace';
                const outcome = parseActivationJourney(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'invalid-record');
                assert.match(outcome.rejection.message, /deep journey walk refuses/);
        });

        test('a green record parses to the canonical copy (the byte round-trip pin)', () => {
                const outcome = parseActivationJourney(serializeActivationJourney(walkedJourneyRecord() as unknown as ActivationJourneyRecord));
                assert.ok(outcome.ok);
                assert.equal(outcome.record.journeyId, 'flauz:jrn:0123456789abcdef');
                assert.equal(outcome.record.rolesSession?.roles.length, 2);
        });
});

suite('activationContract · determinism greps (THE DETERMINISM LAW)', () => {
        test('Date.now / Math.random / new Date( / process.env appear only on law-comment lines', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = CONTRACT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
