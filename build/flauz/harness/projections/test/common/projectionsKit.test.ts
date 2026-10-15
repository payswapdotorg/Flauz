/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-010 projections kit battery: the fail-closed factory and THE
 * ZERO-SEAM LAW (the empty options record; every injected seam key is
 * the TypeError naming the law), the version re-export chain (this
 * family's version plus the NINE landed family versions, all
 * referentially pinned against the real modules), the delegation
 * surface (projectNavigation with the COMPLETE rejection table and
 * the first-rejection reason, the serialization laws, the frozen
 * section list), THE RECORD-UNCHANGED LAW and the determinism law
 * through the kit, THE DISPOSE LAW (the typed DISPOSED refusal and
 * the factory-misuse TypeError class on the pure delegates), and THE
 * CROSS-KIT CROWN: the REAL DH-01 kit (mint + the full forward
 * lifecycle chain) + the REAL DH-02 onboarding walk (the same fixed
 * rng seam mints the session's proposed harness as the anchor) + the
 * REAL DH-03..DH-09 composed records -> projectNavigation -> the
 * COMPLETE navigation model -> the canonical serialization ->
 * the fail-closed parse round-trip.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_LIFECYCLE_STATES as REAL_HARNESS_LIFECYCLE_STATES,
	HARNESS_LIFECYCLE_FORWARD_TRANSITIONS as REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS,
} from '../../../contract/common/domainHarnessContract.js';
import { createOnboardingKit } from '../../../onboarding/common/onboardingKit.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { createRolesKit } from '../../../roles/common/rolesKit.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { createOntologyKit } from '../../../ontology/common/ontologyKit.js';
import { ONTOLOGY_CONTRACTS_VERSION as REAL_ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { createTemplatesKit } from '../../../templates/common/templatesKit.js';
import { TEMPLATES_CONTRACTS_VERSION as REAL_TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { createBodiesKit } from '../../../bodies/common/bodiesKit.js';
import { BODIES_CONTRACTS_VERSION as REAL_BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import { createPacksKit } from '../../../packs/common/packsKit.js';
import { PACKS_CONTRACTS_VERSION as REAL_PACKS_CONTRACTS_VERSION } from '../../../packs/common/packsContract.js';
import { createProfilesKit } from '../../../profiles/common/profilesKit.js';
import { PROFILES_CONTRACTS_VERSION as REAL_PROFILES_CONTRACTS_VERSION } from '../../../profiles/common/profilesContract.js';
import { createBenchmarksKit } from '../../../benchmarks/common/benchmarksKit.js';
import { BENCHMARKS_CONTRACTS_VERSION as REAL_BENCHMARKS_CONTRACTS_VERSION } from '../../../benchmarks/common/benchmarksContract.js';
import { TASK_WORLDS as REAL_TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';

import {
	DOMAIN_NAVIGATION_SECTIONS,
	PROJECTIONS_CONTRACTS_VERSION,
	PROJECTIONS_KIT_EXTRA_REFUSAL_REASONS,
	PROJECTIONS_KIT_REFUSAL_REASONS,
	createProjectionsKit,
	isProjectionsKitRefusalReason,
} from '../../common/projectionsKit.js';
import type { KitProjectionOutcome, ProjectionsKit, ProjectionsKitRefusal } from '../../common/projectionsKit.js';
import type { DomainNavigationModel } from '../../common/projectionsContract.js';
import { PROJECTIONS_REJECTION_REASONS as CONTRACT_PROJECTIONS_REJECTION_REASONS, serializeNavigationModel as CONTRACT_serializeNavigationModel } from '../../common/projectionsContract.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/projectionsKit.ts', import.meta.url)), 'utf8');

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

// --- the green fixtures (the contract battery's shapes, reused by the delegation pins) ---

const NOW = '2026-01-01T00:00:00.000Z';
const HARNESS_ID = 'flauz:hrn:0123456789abcdef';
const REAL_SCENARIO_IDS: string[] = REAL_TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

function fixtureDescriptor(): Record<string, unknown> {
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
	};
}

function fixtureHarness(state: string): Record<string, unknown> {
	const descriptor = fixtureDescriptor();
	return {
		harnessId: HARNESS_ID,
		contractVersion: REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
		state,
		descriptor,
		mintedAtIso: NOW,
		revision: 4,
		history: [{ at: NOW, fromState: null, toState: 'draft', law: 'THE FORWARD-ONLY LIFECYCLE LAW', decision: null, detail: 'fixture mint detail' }],
		lastValidation: { ok: true, mode: 'shape', descriptor },
	};
}

function note(op: string, from: string | null, to: string): Record<string, unknown> {
	return { at: NOW, fromStage: from, toStage: to, op, law: 'THE FORWARD-ONLY LAW', detail: 'fixture note' };
}

function fixtureSession(): Record<string, unknown> {
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
	};
}

function fixtureRoles(): Record<string, unknown> {
	return {
		sessionId: 'flauz:rol:0123456789abcdef',
		industry: 'software',
		stage: 'composed',
		roles: [
			{ roleKey: 'analyst', summary: 'Runs the domain analysis.' },
			{ roleKey: 'reviewer', summary: 'Reviews the domain work.' },
		],
		history: [note('begin-session', null, 'composing'), note('finalize-composition', 'composing', 'composed')],
	};
}

function fixtureOntology(): Record<string, unknown> {
	return {
		ontologyId: 'flauz:ont:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		terms: [{ term: 'signal', definition: 'The incoming work signal.' }],
		history: [note('begin-ontology', null, 'composing'), note('finalize-ontology', 'composing', 'composed')],
	};
}

function fixtureTemplates(): Record<string, unknown> {
	return {
		templateId: 'flauz:tpl:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] }],
		history: [note('begin-template', null, 'composing'), note('finalize-template', 'composing', 'composed')],
	};
}

function fixtureBodies(): Record<string, unknown> {
	return {
		bodyId: 'flauz:bod:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work against the roles.', roleRefs: ['analyst'] }],
		history: [note('begin-defaults', null, 'composing'), note('finalize-defaults', 'composing', 'composed')],
	};
}

function fixturePacks(): Record<string, unknown> {
	return {
		id: 'flauz:pak:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		packs: [{ packKey: 'core', summary: 'The core capability pack.', bodyRefs: ['triage'] }],
		history: [note('begin-packs', null, 'composing'), note('finalize-packs', 'composing', 'composed')],
	};
}

function fixtureProfiles(): Record<string, unknown> {
	return {
		profilesId: 'flauz:prf:0123456789abcdef',
		harnessId: HARNESS_ID,
		stage: 'composed',
		profiles: [{
			profileKey: 'core',
			summary: 'The core policy profile.',
			permissionRefs: ['read-files'],
			approvalTiers: ['high'],
			evidenceFloor: 'local-real',
			kpiDimensions: ['success'],
		}],
		history: [note('begin-profiles', null, 'composing'), note('finalize-profiles', 'composing', 'composed')],
	};
}

function fixtureBenchmarks(): Record<string, unknown> {
	return {
		id: 'flauz:ben:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		benchmarks: [{
			benchmarkKey: 'regression-suite-health',
			summary: 'The regression suite health benchmark.',
			hypothesis: 'A composed organization completes the seeded scenarios with a higher success rate than the baseline.',
			scenarioRefs: [REAL_SCENARIO_IDS[0]],
			kpiDimensions: ['success'],
			expectedOutcome: 'The candidate clears every acceptance criterion on the seeded instances.',
			limitations: 'Fixture worlds over a synthetic repository.',
			evidenceLevel: 'fixture',
		}],
		history: [note('begin-benchmarks', null, 'composing'), note('finalize-benchmarks', 'composing', 'composed')],
	};
}

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

function clone(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

function refusalOf(outcome: KitProjectionOutcome): ProjectionsKitRefusal {
	assert.equal(outcome.ok, false, 'expected a refused kit outcome');
	return (outcome as { refusal: ProjectionsKitRefusal }).refusal;
}

function mustProject(kit: ProjectionsKit, inputs: unknown): DomainNavigationModel {
	const outcome = kit.projectNavigation(inputs);
	if (!outcome.ok) {
		assert.fail(`expected a green kit projection, got: ${JSON.stringify(outcome.refusal)}`);
	}
	return outcome.model;
}

/** The deterministic seams: a FIXED rng (every minted id shares the hex - the crown's binding pin) and an advancing clock. */
function makeSeams(): { clock: () => string; rng: () => string } {
	let clockCount = 0;
	return {
		clock: () => {
			clockCount += 1;
			return `2026-01-01T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
		},
		rng: () => '0123456789abcdef',
	};
}

const EMPTY_CATALOG = { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] } as const;

// --- the battery ---

suite('projectionsKit · the version re-export chain (THE SINGLE-VERSION LAW)', () => {
	test('the kit re-carries PROJECTIONS_CONTRACTS_VERSION (declared ONCE in the contract)', () => {
		assert.equal(PROJECTIONS_CONTRACTS_VERSION, '1.0.0');
		const hits = KIT_SOURCE.split('PROJECTIONS_CONTRACTS_VERSION =').length - 1;
		assert.equal(hits, 0, 'the version constant is never re-declared in the kit module');
	});

	test('the kit re-carries the NINE landed family versions by reference (the pin battery)', () => {
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
});

suite('projectionsKit · THE ZERO-SEAM LAW (the fail-closed factory)', () => {
	test('the factory accepts no options and the EMPTY options record', () => {
		const bare = createProjectionsKit();
		const empty = createProjectionsKit({});
		assert.equal(typeof bare.projectNavigation, 'function');
		assert.equal(typeof empty.dispose, 'function');
	});

	test('a non-object options carrier is the TypeError', () => {
		assert.throws(() => createProjectionsKit(null as never), /options, when present, must be a plain object/);
		assert.throws(() => createProjectionsKit(7 as never), /options, when present, must be a plain object/);
		assert.throws(() => createProjectionsKit([] as never), /options, when present, must be a plain object/);
	});

	for (const seam of ['clock', 'rng', 'fsPort', 'root', 'catalog', 'ledgerPath']) {
		test(`an injected '${seam}' seam is the TypeError naming the seam and THE ZERO-SEAM LAW`, () => {
			assert.throws(
				() => createProjectionsKit({ [seam]: 1 } as never),
				/accepts NO seams.*THE ZERO-SEAM LAW/,
			);
			try {
				createProjectionsKit({ [seam]: 1 } as never);
			} catch (error) {
				assert.ok(String(error).includes(seam), `the TypeError names the seam: ${seam}`);
			}
		});
	}

	test('the kit module options interface is the EMPTY record (the source pin)', () => {
		assert.ok(KIT_SOURCE.includes('export interface ProjectionsKitOptions {}'), 'the options interface is declared empty');
	});
});

suite('projectionsKit · the frozen refusal vocabulary', () => {
	test('PROJECTIONS_KIT_EXTRA_REFUSAL_REASONS is the DISPOSED extra alone', () => {
		assert.deepEqual([...PROJECTIONS_KIT_EXTRA_REFUSAL_REASONS], ['DISPOSED']);
	});

	test('PROJECTIONS_KIT_REFUSAL_REASONS is the contract six plus the kit extra, in order', () => {
		assert.deepEqual([...PROJECTIONS_KIT_REFUSAL_REASONS], [...CONTRACT_PROJECTIONS_REJECTION_REASONS, 'DISPOSED']);
		assert.equal(isProjectionsKitRefusalReason('DISPOSED'), true);
		assert.equal(isProjectionsKitRefusalReason('missing-record'), true);
		assert.equal(isProjectionsKitRefusalReason('nope'), false);
	});
});

suite('projectionsKit · the delegation surface (projectNavigation)', () => {
	test('the green delegation: the kit projects the crown input to the complete model', () => {
		const kit = createProjectionsKit();
		const model = mustProject(kit, crownInputs());
		assert.equal(model.harnessId, HARNESS_ID);
		for (const section of model.sections) {
			assert.equal(section.sectionState, 'composed', `the '${section.section}' section is composed`);
		}
	});

	test('the refusal delegation: the COMPLETE contract rejection table rides the kit refusal (never first-only)', () => {
		const kit = createProjectionsKit();
		const refusal = refusalOf(kit.projectNavigation({ ghost: true, packs: 'not-an-array' }));
		assert.equal(refusal.reason, 'unknown-key', 'the kit refusal reason is the FIRST rejection\'s reason');
		assert.ok(refusal.rejections, 'the complete table rides the refusal');
		assert.deepEqual(refusal.rejections.map((rejection) => rejection.reason), ['unknown-key', 'missing-record', 'malformed-record']);
	});

	test('the refusal delegation: the first-rejection reason is an honest label (the walk order\'s first verdict)', () => {
		const kit = createProjectionsKit();
		const missingAnchor = refusalOf(kit.projectNavigation({}));
		assert.equal(missingAnchor.reason, 'missing-record');
		const malformed = refusalOf(kit.projectNavigation(7));
		assert.equal(malformed.reason, 'malformed-inputs');
	});

	test('THE RECORD-UNCHANGED LAW holds through the kit', () => {
		const kit = createProjectionsKit();
		const inputs = crownInputs();
		const before = clone(inputs);
		mustProject(kit, inputs);
		assert.deepEqual(inputs, before);
	});

	test('determinism through the kit: the same inputs produce byte-identical serializations', () => {
		const kit = createProjectionsKit();
		const first = mustProject(kit, crownInputs());
		const second = mustProject(kit, crownInputs());
		assert.deepEqual(first, second);
		assert.equal(kit.serializeNavigationModel(first), kit.serializeNavigationModel(second));
	});
});

suite('projectionsKit · the delegation surface (serialization, parse, sections)', () => {
	test('serializeNavigationModel delegates to the contract canonical bytes', () => {
		const kit = createProjectionsKit();
		const model = mustProject(kit, crownInputs());
		assert.equal(kit.serializeNavigationModel(model), CONTRACT_serializeNavigationModel(model));
		assert.equal(kit.serializeNavigationModel(clone(model)), CONTRACT_serializeNavigationModel(model));
	});

	test('serializeNavigationModel keeps the TypeError on a malformed model (never dishonest bytes)', () => {
		const kit = createProjectionsKit();
		assert.throws(() => kit.serializeNavigationModel({ bogus: true }), TypeError);
	});

	test('parseNavigationModel delegates the fail-closed parse (round-trip + drift classes)', () => {
		const kit = createProjectionsKit();
		const model = mustProject(kit, crownInputs());
		const bytes = kit.serializeNavigationModel(model);
		const outcome = kit.parseNavigationModel(bytes);
		assert.equal(outcome.ok, true);
		const drifted = kit.parseNavigationModel(JSON.stringify(clone(model), null, 2));
		assert.equal((drifted as { rejection: { reason: string } }).rejection.reason, 'non-canonical');
		const malformed = kit.parseNavigationModel('{');
		assert.equal((malformed as { rejection: { reason: string } }).rejection.reason, 'malformed-json');
	});

	test('listSections returns the frozen section list', () => {
		const kit = createProjectionsKit();
		assert.deepEqual([...kit.listSections()], [...DOMAIN_NAVIGATION_SECTIONS]);
	});
});

suite('projectionsKit · THE DISPOSE LAW (the kit holds NO domain state)', () => {
	test('projectNavigation after dispose rejects with the typed DISPOSED refusal', () => {
		const kit = createProjectionsKit();
		kit.dispose();
		const refusal = refusalOf(kit.projectNavigation(crownInputs()));
		assert.equal(refusal.reason, 'DISPOSED');
		assert.equal(refusal.law, 'THE DISPOSE LAW');
		assert.ok(refusal.detail.includes('NO domain state'));
	});

	test('serializeNavigationModel / parseNavigationModel / listSections after dispose throw the TypeError naming the law', () => {
		const kit = createProjectionsKit();
		const model = mustProject(kit, crownInputs());
		const bytes = kit.serializeNavigationModel(model);
		kit.dispose();
		assert.throws(() => kit.serializeNavigationModel(model), /THE DISPOSE LAW/);
		assert.throws(() => kit.parseNavigationModel(bytes), /THE DISPOSE LAW/);
		assert.throws(() => kit.listSections(), /THE DISPOSE LAW/);
	});

	test('dispose is idempotent (the surface closes once, stays closed)', () => {
		const kit = createProjectionsKit();
		kit.dispose();
		kit.dispose();
		assert.equal(refusalOf(kit.projectNavigation(crownInputs())).reason, 'DISPOSED');
	});

	test('a disposed kit never touched a domain record (the record-unchanged law holds on the refusal path)', () => {
		const kit = createProjectionsKit();
		const inputs = crownInputs();
		kit.dispose();
		refusalOf(kit.projectNavigation(inputs));
		assert.deepEqual(inputs, clone(inputs));
	});
});

suite('projectionsKit · THE CROSS-KIT CROWN (the nine real kits -> the complete projection)', () => {
	test('the crown: REAL DH-01 mint + the full forward lifecycle, the REAL DH-02 walk proposing the SAME harness id, the REAL DH-03..DH-09 records -> the complete model -> the canonical round-trip', async () => {
		const seams = makeSeams();
		const harnessKit = createHarnessKit({ clock: seams.clock, rng: seams.rng, catalog: EMPTY_CATALOG });
		const minted = await harnessKit.mintHarness({
			industry: 'software',
			workTypes: ['analysis', 'review'],
			displayName: 'Crown Harness',
			roles: [
				{ roleKey: 'analyst', summary: 'Runs the domain analysis.' },
				{ roleKey: 'reviewer', summary: 'Reviews the domain work.' },
			],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.equal(minted.ok, true);
		const harnessId = (minted as { record: { harnessId: string } }).record.harnessId;
		// THE FULL FORWARD LIFECYCLE: the anchor ends 'active' (the projection's
		// lifecycle section carries the real consumed/available edges).
		const proposed = await harnessKit.advanceHarness(harnessId, 'proposed');
		assert.equal(proposed.ok, true);
		const approved = await harnessKit.advanceHarness(harnessId, 'approved', { approvedBy: 'fixture.approver', note: 'fixture note' });
		assert.equal(approved.ok, true);
		const active = await harnessKit.advanceHarness(harnessId, 'active', { activatedBy: 'fixture.operator' });
		assert.equal(active.ok, true);
		const anchor = (active as { record: unknown }).record;

		// the DH-02 walk: the SAME fixed rng seam mints the session's proposed
		// harness id AS the anchor's id (the onboarding kit forwards its seams to
		// the real inner DH-01 kit - the binding pin).
		const onboardingKit = createOnboardingKit({ clock: seams.clock, rng: seams.rng, catalog: EMPTY_CATALOG });
		const begun = await onboardingKit.beginSession();
		assert.equal(begun.ok, true);
		const sessionId = (begun as { session: { sessionId: string } }).session.sessionId;
		assert.ok((await onboardingKit.selectIndustry(sessionId, 'software')).ok);
		assert.ok((await onboardingKit.composeCompany(sessionId, { displayName: 'Crown Group', sizeBand: 'small' })).ok);
		assert.ok((await onboardingKit.selectWorkTypes(sessionId, ['analysis', 'review'])).ok);
		assert.ok((await onboardingKit.composeDraft(sessionId, {
			roles: [
				{ roleKey: 'analyst', summary: 'Runs the domain analysis.' },
				{ roleKey: 'reviewer', summary: 'Reviews the domain work.' },
			],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		})).ok);
		const proposedSession = await onboardingKit.proposeSession(sessionId);
		assert.equal(proposedSession.ok, true);
		const session = (proposedSession as { session: { harnessId: string | null } }).session;
		assert.equal(session.harnessId, harnessId, 'the proposed harness IS the anchor (the fixed-rng binding pin)');
		const sessionRecord = (proposedSession as { session: unknown }).session;

		// the DH-03 roles session (composed).
		const rolesKit = createRolesKit({ clock: seams.clock, rng: seams.rng });
		const rolesBegun = await rolesKit.beginSession('software');
		assert.equal(rolesBegun.ok, true);
		const rolesSessionId = (rolesBegun as { session: { sessionId: string } }).session.sessionId;
		assert.ok((await rolesKit.addRole(rolesSessionId, { roleKey: 'analyst', summary: 'Runs the domain analysis.' })).ok);
		assert.ok((await rolesKit.addRole(rolesSessionId, { roleKey: 'reviewer', summary: 'Reviews the domain work.' })).ok);
		const rolesFinalized = await rolesKit.finalizeComposition(rolesSessionId);
		assert.equal(rolesFinalized.ok, true);
		const rolesRecord = (rolesFinalized as { session: unknown }).session;

		// the DH-04 ontology (composed).
		const ontologyKit = createOntologyKit({ clock: seams.clock, rng: seams.rng });
		const ontologyBegun = await ontologyKit.beginOntology(harnessId, 'software');
		assert.equal(ontologyBegun.ok, true);
		const ontologyId = (ontologyBegun as { record: { ontologyId: string } }).record.ontologyId;
		assert.ok((await ontologyKit.addTerm(ontologyId, { term: 'signal', definition: 'The incoming work signal.' })).ok);
		const ontologyFinalized = await ontologyKit.finalizeOntology(ontologyId);
		assert.equal(ontologyFinalized.ok, true);

		// the DH-05 templates (composed, finalized over the REAL ontology record).
		const templatesKit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templatesBegun = await templatesKit.beginTemplate(harnessId, 'software');
		assert.equal(templatesBegun.ok, true);
		const templateId = (templatesBegun as { record: { templateId: string } }).record.templateId;
		assert.ok((await templatesKit.addTask(templateId, { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] })).ok);
		const templatesFinalized = await templatesKit.finalizeTemplate(templateId, (ontologyFinalized as { record: unknown }).record);
		assert.equal(templatesFinalized.ok, true);

		// the DH-06 bodies (composed, finalized over the REAL roles record).
		const bodiesKit = createBodiesKit({ clock: seams.clock, rng: seams.rng });
		const bodiesBegun = await bodiesKit.beginDefaults(harnessId, 'software');
		assert.equal(bodiesBegun.ok, true);
		const bodyId = (bodiesBegun as { record: { bodyId: string } }).record.bodyId;
		assert.ok((await bodiesKit.addBody(bodyId, { bodyKey: 'triage', summary: 'Triage the incoming work against the roles.', roleRefs: ['analyst'] })).ok);
		const bodiesFinalized = await bodiesKit.finalizeDefaults(bodyId, rolesRecord);
		assert.equal(bodiesFinalized.ok, true);

		// the DH-07 packs (composed, finalized over the REAL bodies record).
		const packsKit = createPacksKit({ clock: seams.clock, rng: seams.rng });
		const packsBegun = await packsKit.beginPacks(harnessId, 'software');
		assert.equal(packsBegun.ok, true);
		const packsId = (packsBegun as { record: { id: string } }).record.id;
		assert.ok((await packsKit.addPack(packsId, { packKey: 'core', summary: 'The core capability pack.', bodyRefs: ['triage'] })).ok);
		const packsFinalized = await packsKit.finalizePacks(packsId, (bodiesFinalized as { record: unknown }).record);
		assert.equal(packsFinalized.ok, true);

		// the DH-08 profiles (composed, over the REAL catalog permission vocabulary).
		const profilesKit = createProfilesKit({ clock: seams.clock, rng: seams.rng });
		const profilesBegun = await profilesKit.beginProfiles(harnessId);
		assert.equal(profilesBegun.ok, true);
		const profilesId = (profilesBegun as { record: { profilesId: string } }).record.profilesId;
		assert.ok((await profilesKit.addProfile(profilesId, {
			profileKey: 'core',
			summary: 'The core policy profile.',
			permissionRefs: ['read-files', 'network-access'],
			approvalTiers: ['high'],
			evidenceFloor: 'local-real',
			kpiDimensions: ['success', 'cost'],
		})).ok);
		const profilesFinalized = await profilesKit.finalizeProfiles(profilesId);
		assert.equal(profilesFinalized.ok, true);

		// the DH-09 benchmarks (composed, over the REAL task-world scenario registry).
		const benchmarksKit = createBenchmarksKit({ clock: seams.clock, rng: seams.rng });
		const benchmarksBegun = await benchmarksKit.beginBenchmarks(harnessId, 'software');
		assert.equal(benchmarksBegun.ok, true);
		const benchmarksId = (benchmarksBegun as { record: { id: string } }).record.id;
		assert.ok((await benchmarksKit.addBenchmark(benchmarksId, {
			benchmarkKey: 'regression-suite-health',
			summary: 'The regression suite health benchmark.',
			hypothesis: 'A composed organization completes the seeded scenarios with a higher success rate than the baseline.',
			scenarioRefs: [REAL_SCENARIO_IDS[0]],
			kpiDimensions: ['success'],
			expectedOutcome: 'The candidate clears every acceptance criterion on the seeded instances.',
			limitations: 'Fixture worlds over a synthetic repository.',
			evidenceLevel: 'fixture',
		})).ok);
		const benchmarksFinalized = await benchmarksKit.finalizeBenchmarks(benchmarksId);
		assert.equal(benchmarksFinalized.ok, true);

		// THE PROJECTION over the caller-supplied composed records.
		const kit = createProjectionsKit();
		const inputs = {
			harness: anchor,
			onboarding: [sessionRecord],
			roles: [rolesRecord],
			ontology: [(ontologyFinalized as { record: unknown }).record],
			templates: [(templatesFinalized as { record: unknown }).record],
			bodies: [(bodiesFinalized as { record: unknown }).record],
			packs: [(packsFinalized as { record: unknown }).record],
			profiles: [(profilesFinalized as { record: unknown }).record],
			benchmarks: [(benchmarksFinalized as { record: unknown }).record],
		};
		const model = mustProject(kit, inputs);
		assert.equal(model.harnessId, harnessId);
		assert.equal(model.contractVersion, PROJECTIONS_CONTRACTS_VERSION);
		for (const section of model.sections) {
			assert.equal(section.sectionState, 'composed', `the '${section.section}' section is composed from the real records`);
			assert.ok(section.rows.length > 0);
		}
		// the lifecycle section: the REAL active anchor's edges.
		const lifecycle = model.sections.find((section) => section.section === 'lifecycle');
		assert.ok(lifecycle);
		assert.deepEqual(lifecycle.rows.slice(0, 5).map((row) => row.label), [...REAL_HARNESS_LIFECYCLE_STATES]);
		assert.deepEqual(lifecycle.rows.slice(5).map((row) => row.label), REAL_HARNESS_LIFECYCLE_FORWARD_TRANSITIONS.map((t) => `${t.from} -> ${t.to}`));
		assert.ok(lifecycle.rows.slice(5).some((row) => row.detail === 'available (the next legal step)'));
		// the canonical serialization round-trip.
		const bytes = kit.serializeNavigationModel(model);
		const parsed = kit.parseNavigationModel(bytes);
		assert.equal(parsed.ok, true);
		assert.deepEqual((parsed as { model: DomainNavigationModel }).model, model);
	});

	test('the crown negative: a record from ANOTHER harness never projects into this harness navigation', async () => {
		const seams = makeSeams();
		const harnessKit = createHarnessKit({ clock: seams.clock, rng: seams.rng, catalog: EMPTY_CATALOG });
		const minted = await harnessKit.mintHarness({
			industry: 'software',
			workTypes: ['analysis'],
			displayName: 'Anchor Harness',
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.equal(minted.ok, true);
		const anchor = (minted as { record: unknown }).record;
		const foreignKit = createProfilesKit({ clock: seams.clock, rng: () => 'fedcba9876543210' });
		const foreignBegun = await foreignKit.beginProfiles('flauz:hrn:ffffffffffffffff');
		assert.equal(foreignBegun.ok, true);
		const foreignId = (foreignBegun as { record: { profilesId: string } }).record.profilesId;
		assert.ok((await foreignKit.addProfile(foreignId, {
			profileKey: 'core',
			summary: 'A foreign profile.',
			permissionRefs: ['read-files'],
			approvalTiers: ['high'],
			evidenceFloor: 'local-real',
			kpiDimensions: ['success'],
		})).ok);
		const foreignFinalized = await foreignKit.finalizeProfiles(foreignId);
		assert.equal(foreignFinalized.ok, true);

		const kit = createProjectionsKit();
		const refusal = refusalOf(kit.projectNavigation({ harness: anchor, profiles: [(foreignFinalized as { record: unknown }).record] }));
		assert.equal(refusal.reason, 'foreign-record');
		assert.ok(refusal.rejections?.[0].detail.includes('never projects into this harness'));
	});

	test('the crown absent families: the anchor alone projects with the honest not-composed sections (the real mint boundary)', async () => {
		const seams = makeSeams();
		const harnessKit = createHarnessKit({ clock: seams.clock, rng: seams.rng, catalog: EMPTY_CATALOG });
		const minted = await harnessKit.mintHarness({
			industry: 'software',
			workTypes: ['analysis'],
			displayName: 'Bare Harness',
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.equal(minted.ok, true);
		const kit = createProjectionsKit();
		const model = mustProject(kit, { harness: (minted as { record: unknown }).record });
		assert.equal(model.sections.length, 9);
		for (const sectionId of ['workflows', 'capabilities', 'policies', 'evidence', 'kpis', 'benchmarks']) {
			const section = model.sections.find((section) => section.section === sectionId);
			assert.ok(section);
			assert.equal(section.sectionState, 'not-composed');
			assert.deepEqual(section.rows, []);
		}
	});
});

suite('projectionsKit · the determinism greps (THE ZERO-SEAM LAW, in-suite)', () => {
	test('the kit module never calls the banned globals (law-comment lines only)', () => {
		const hits = determinismGrepHits('../../common/projectionsKit.ts');
		for (const hit of hits) {
			const trimmed = hit.trim();
			assert.ok(trimmed.startsWith('*') || trimmed.startsWith('//'), `the hit must be a law-comment line: ${hit}`);
		}
	});

	test('the kit module carries no clock, rng, fs or ledger construction (the zero-seam source pin)', () => {
		for (const seam of ['fsPort', 'appendFile', 'writeFile', 'readFile', 'mkdir', 'ledger', 'envelope']) {
			const hits = KIT_SOURCE.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && line.includes(seam));
			assert.equal(hits.length, 0, `no ${seam} seam in the shipped kit module`);
		}
	});
});
