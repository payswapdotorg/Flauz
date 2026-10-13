/*
 * DH-002 onboarding contract test suite (mocha tdd style, matching
 * build/flauz/harness/contract/test/common/domainHarnessContract.test.ts
 * - the DH-001 landed family precedent - and the W7 production ops
 * family's contract battery before it).
 *
 * Fixture policy: every session id, harness id, company value, role
 * and ref below is SYNTHETIC (prefixed 'fixture.' / 'cap-fixture-'
 * style ids, fixed fixture ISO strings, the 'flauz:onb:<16-hex>' /
 * 'flauz:hrn:<16-hex>' fixture ids) and is NOT an authority value,
 * NOT credential material, NOT execution material. Closed-vocabulary
 * members (the stages, the transitions, the size bands, the schema
 * keys, the rejection reasons, the parse reasons, the op names, the
 * version stamp) are the contract's own values under test. The
 * canonical-byte tests pin determinism and the frozen key orders; the
 * suites never read a clock; the in-suite determinism greps pin the
 * sources to law-comment lines only (the banned-global patterns are
 * assembled piecewise below so this test source itself stays
 * grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ONBOARDING_CONTRACTS_VERSION,
	ONBOARDING_FORWARD_TRANSITIONS,
	ONBOARDING_NOTE_SCHEMA_KEYS,
	ONBOARDING_OP_NAMES,
	ONBOARDING_PARSE_REJECTION_REASONS,
	ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS,
	ONBOARDING_SESSION_ID_PREFIX,
	ONBOARDING_SESSION_SCHEMA_KEYS,
	ONBOARDING_STAGES,
	ONBOARDING_VALIDATION_REJECTION_REASONS,
	COMPANY_PROFILE_SCHEMA_KEYS,
	COMPANY_SIZE_BANDS,
	canTransitionOnboardingStage,
	isOnboardingOpName,
	isOnboardingParseRejectionReason,
	isOnboardingSessionId,
	isOnboardingSessionRecord,
	isOnboardingStage,
	isOnboardingValidationRejectionReason,
	parseOnboardingSession,
	serializeOnboardingSession,
	validateOnboardingCompanyProfile,
	validateOnboardingIndustryPayload,
	validateOnboardingReviewComposition,
	validateOnboardingSessionRecord,
	validateOnboardingWorkTypes,
	FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as ONBOARDING_FORBIDDEN_KEYS,
	HARNESS_INDUSTRIES as ONBOARDING_INDUSTRIES,
	HARNESS_WORK_TYPES as ONBOARDING_WORK_TYPES,
	isHarnessIndustry as ONBOARDING_IS_HARNESS_INDUSTRY,
	isHarnessWorkType as ONBOARDING_IS_HARNESS_WORK_TYPE,
} from '../../common/onboardingContract.js';
import type {
	OnboardingCompanyProfile,
	OnboardingRefusal,
	OnboardingReviewComposition,
	OnboardingSessionRecord,
} from '../../common/onboardingContract.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
	HARNESS_INDUSTRIES,
	HARNESS_WORK_TYPES,
	isHarnessIndustry,
	isHarnessWorkType,
} from '../../../contract/common/domainHarnessContract.js';

const FIXTURE_NOW_ISO = '2026-10-13T00:00:00.000Z';
const FIXTURE_SESSION_ID = `${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdef`;
const FIXTURE_HARNESS_ID = 'flauz:hrn:0123456789abcdef';

/** Loose override maps (the boundary-test discipline: any key typechecks at the call site). */
function fixtureProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		displayName: 'fixture litigation group',
		sizeBand: 'small',
		...overrides,
	};
}

function fixtureRoles(): Record<string, unknown>[] {
	return [
		{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
		{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
	];
}

function fixtureComposition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		roles: fixtureRoles(),
		capabilityRefs: ['cap-fixture-001'],
		workflowRefs: ['wf-fixture-001'],
		policyRefs: ['pol-fixture-001'],
		evidenceRefs: ['ev-fixture-001'],
		...overrides,
	};
}

function fixtureNotes(): Record<string, unknown>[] {
	return [
		{ at: FIXTURE_NOW_ISO, fromStage: null, toStage: 'industry', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail: 'fixture begin detail (the walk enters the industry stage)' },
		{ at: FIXTURE_NOW_ISO, fromStage: 'industry', toStage: 'company', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail: 'fixture select-industry detail' },
		{ at: FIXTURE_NOW_ISO, fromStage: 'company', toStage: 'work-types', op: 'compose-company', law: 'THE FORWARD-ONLY LAW', detail: 'fixture compose-company detail' },
		{ at: FIXTURE_NOW_ISO, fromStage: 'work-types', toStage: 'review', op: 'select-work-types', law: 'THE FORWARD-ONLY LAW', detail: 'fixture select-work-types detail' },
		{ at: FIXTURE_NOW_ISO, fromStage: 'review', toStage: 'review', op: 'compose-draft', law: 'THE REAL-KIT LAW', detail: 'fixture compose-draft detail' },
	];
}

function fixtureSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sessionId: FIXTURE_SESSION_ID,
		contractVersion: ONBOARDING_CONTRACTS_VERSION,
		stage: 'review',
		industry: 'legal',
		companyProfile: fixtureProfile(),
		workTypes: ['analysis', 'drafting', 'review'],
		reviewComposition: fixtureComposition(),
		harnessId: FIXTURE_HARNESS_ID,
		createdAtIso: FIXTURE_NOW_ISO,
		revision: 5,
		history: fixtureNotes(),
		...overrides,
	};
}

function parsedJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Extracts the refusal of a refused payload outcome (narrowed for the assertions). */
function refusalOf(outcome: { ok: boolean }): OnboardingRefusal {
	assert.equal(outcome.ok, false, 'expected a refused outcome');
	return (outcome as unknown as { refusal: OnboardingRefusal }).refusal;
}

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

suite('DH-002 onboarding contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('ONBOARDING_CONTRACTS_VERSION is 1.0.0', () => {
			assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
			assert.equal(typeof ONBOARDING_CONTRACTS_VERSION, 'string');
		});
	});

	suite('the DH-01 vocabularies are re-exported BY REFERENCE (never re-declared)', () => {
		test('HARNESS_INDUSTRIES is the DH-01 binding itself, with the exact sixteen members in the frozen order', () => {
			assert.equal(ONBOARDING_INDUSTRIES === HARNESS_INDUSTRIES, true, 'the re-export must be the same binding');
			assert.deepEqual([...ONBOARDING_INDUSTRIES], [
				'software', 'legal', 'finance', 'healthcare', 'education', 'marketing', 'science', 'media',
				'construction', 'logistics', 'retail', 'manufacturing', 'energy', 'agriculture', 'government', 'hospitality',
			]);
		});
		test('HARNESS_WORK_TYPES is the DH-01 binding itself, with the exact ten members in the frozen order', () => {
			assert.equal(ONBOARDING_WORK_TYPES === HARNESS_WORK_TYPES, true, 'the re-export must be the same binding');
			assert.deepEqual([...ONBOARDING_WORK_TYPES], [
				'analysis', 'drafting', 'review', 'planning', 'research', 'reporting', 'data-processing', 'compliance', 'communication', 'administration',
			]);
		});
		test('the DH-01 predicates are re-exported by reference (the same function bindings)', () => {
			assert.equal(ONBOARDING_IS_HARNESS_INDUSTRY === isHarnessIndustry, true);
			assert.equal(ONBOARDING_IS_HARNESS_WORK_TYPE === isHarnessWorkType, true);
			assert.equal(ONBOARDING_IS_HARNESS_INDUSTRY('legal'), true);
			assert.equal(ONBOARDING_IS_HARNESS_WORK_TYPE('drafting'), true);
		});
		test('FORBIDDEN_HARNESS_DESCRIPTOR_KEYS is the DH-01 binding itself (the no-fork family, never re-declared)', () => {
			assert.equal(ONBOARDING_FORBIDDEN_KEYS === FORBIDDEN_HARNESS_DESCRIPTOR_KEYS, true);
			assert.equal(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS.length, 10);
			assert.equal(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS.includes('fork'), true);
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
		});
	});

	suite('ONBOARDING_STAGES (the frozen stage list)', () => {
		test('the exact five stages, in the frozen walk order', () => {
			assert.deepEqual([...ONBOARDING_STAGES], ['industry', 'company', 'work-types', 'review', 'proposed']);
		});
		test('the stages are unique', () => {
			assert.equal(new Set(ONBOARDING_STAGES).size, ONBOARDING_STAGES.length);
		});
		test('isOnboardingStage admits the members only', () => {
			for (const stage of ONBOARDING_STAGES) {
				assert.equal(isOnboardingStage(stage), true);
			}
			for (const value of ['draft', 'propossed', '', 'INDUSTRY', null, 123, undefined]) {
				assert.equal(isOnboardingStage(value), false);
			}
		});
	});

	suite('ONBOARDING_FORWARD_TRANSITIONS (the frozen whitelist)', () => {
		test('the exact four rows, in the frozen order', () => {
			assert.deepEqual(ONBOARDING_FORWARD_TRANSITIONS.map((row) => [row.from, row.to]), [
				['industry', 'company'],
				['company', 'work-types'],
				['work-types', 'review'],
				['review', 'proposed'],
			]);
		});
		test('the whitelist rows are unique', () => {
			assert.equal(new Set(ONBOARDING_FORWARD_TRANSITIONS.map((row) => `${row.from}->${row.to}`)).size, ONBOARDING_FORWARD_TRANSITIONS.length);
		});
	});

	suite('canTransitionOnboardingStage (the verdict matrix)', () => {
		test('every legal edge is green and names its granting row', () => {
			const verdict = canTransitionOnboardingStage('industry', 'company');
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.equal(verdict.row, 1);
				assert.equal(verdict.from, 'industry');
				assert.equal(verdict.to, 'company');
			}
			assert.deepEqual(canTransitionOnboardingStage('company', 'work-types'), { ok: true, from: 'company', to: 'work-types', row: 2 });
			assert.deepEqual(canTransitionOnboardingStage('work-types', 'review'), { ok: true, from: 'work-types', to: 'review', row: 3 });
			assert.deepEqual(canTransitionOnboardingStage('review', 'proposed'), { ok: true, from: 'review', to: 'proposed', row: 4 });
		});
		test('the full matrix: exactly the four whitelist edges are green, every other edge refused', () => {
			let green = 0;
			for (const from of ONBOARDING_STAGES) {
				for (const to of ONBOARDING_STAGES) {
					if (canTransitionOnboardingStage(from, to).ok) {
						green += 1;
					}
				}
			}
			assert.equal(green, 4);
		});
		test('a skip is refused naming the violated whitelist row', () => {
			const verdict = canTransitionOnboardingStage('industry', 'review');
			assert.equal(verdict.ok, false);
			if (!verdict.ok) {
				assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
				assert.equal(verdict.whitelistRow, 1);
				assert.equal(verdict.expectedTo, 'company');
				assert.match(verdict.detail, /row 1/);
			}
		});
		test('a skip from work-types names row 3', () => {
			const verdict = canTransitionOnboardingStage('work-types', 'industry');
			assert.equal(verdict.ok, false);
			if (!verdict.ok) {
				assert.equal(verdict.whitelistRow, 3);
				assert.equal(verdict.expectedTo, 'review');
			}
		});
		test('a backwards move is refused', () => {
			const verdict = canTransitionOnboardingStage('company', 'industry');
			assert.equal(verdict.ok, false);
			if (!verdict.ok) {
				assert.equal(verdict.whitelistRow, 2);
				assert.equal(verdict.expectedTo, 'work-types');
				assert.match(verdict.detail, /forward-only/);
			}
		});
		test('proposed is TERMINAL - every edge out of proposed is refused with no whitelist row', () => {
			for (const to of ONBOARDING_STAGES) {
				const verdict = canTransitionOnboardingStage('proposed', to);
				assert.equal(verdict.ok, false);
				if (!verdict.ok) {
					assert.equal(verdict.whitelistRow, null);
					assert.equal(verdict.expectedTo, null);
					assert.match(verdict.detail, /TERMINAL/);
				}
			}
		});
		test('self-loops, unknown states and non-strings fail closed', () => {
			assert.equal(canTransitionOnboardingStage('review', 'review').ok, false);
			assert.equal(canTransitionOnboardingStage('draft', 'proposed').ok, false);
			assert.equal(canTransitionOnboardingStage('industry', 'draft').ok, false);
			for (const pair of [[null, 'company'], ['industry', null], [123, 'company'], ['industry', 123]] as unknown[][]) {
				const verdict = canTransitionOnboardingStage(pair[0], pair[1]);
				assert.equal(verdict.ok, false);
				if (!verdict.ok) {
					assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
				}
			}
		});
	});

	suite('COMPANY_SIZE_BANDS (the frozen band list)', () => {
		test('the exact five bands, in the frozen order', () => {
			assert.deepEqual([...COMPANY_SIZE_BANDS], ['solo', 'small', 'medium', 'large', 'enterprise']);
		});
		test('the bands are unique', () => {
			assert.equal(new Set(COMPANY_SIZE_BANDS).size, COMPANY_SIZE_BANDS.length);
		});
		test('the schema keys are the exact two, in the canonical order', () => {
			assert.deepEqual([...COMPANY_PROFILE_SCHEMA_KEYS], ['displayName', 'sizeBand']);
		});
	});

	suite('the frozen schema tables', () => {
		test('ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS is the exact five, in the canonical order', () => {
			assert.deepEqual([...ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS], ['roles', 'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']);
		});
		test('ONBOARDING_SESSION_SCHEMA_KEYS is the exact eleven, in the canonical order', () => {
			assert.deepEqual([...ONBOARDING_SESSION_SCHEMA_KEYS], [
				'sessionId', 'contractVersion', 'stage', 'industry', 'companyProfile', 'workTypes',
				'reviewComposition', 'harnessId', 'createdAtIso', 'revision', 'history',
			]);
		});
		test('ONBOARDING_NOTE_SCHEMA_KEYS is the exact six, in the canonical order', () => {
			assert.deepEqual([...ONBOARDING_NOTE_SCHEMA_KEYS], ['at', 'fromStage', 'toStage', 'op', 'law', 'detail']);
		});
		test('ONBOARDING_OP_NAMES is the exact six, in the frozen order', () => {
			assert.deepEqual([...ONBOARDING_OP_NAMES], [
				'begin-session', 'select-industry', 'compose-company', 'select-work-types', 'compose-draft', 'propose-session',
			]);
			assert.equal(isOnboardingOpName('compose-draft'), true);
			assert.equal(isOnboardingOpName('mint'), false);
		});
	});

	suite('ONBOARDING_VALIDATION_REJECTION_REASONS (the frozen table)', () => {
		test('the exact twenty-two reasons, in the exact walk order', () => {
			assert.deepEqual([...ONBOARDING_VALIDATION_REJECTION_REASONS], [
				'malformed-record', 'no-fork', 'unknown-key', 'missing-key', 'unknown-session', 'version-mismatch',
				'unknown-industry', 'invalid-display-name', 'unknown-size-band',
				'empty-work-types', 'unknown-work-type', 'duplicate-work-types', 'work-types-out-of-order',
				'premature-op', 'stale-stage',
				'empty-roles', 'malformed-role', 'duplicate-role-keys', 'malformed-refs', 'duplicate-ref',
				'harness-kit-refused', 'disposed',
			]);
		});
		test('the reasons are unique', () => {
			assert.equal(new Set(ONBOARDING_VALIDATION_REJECTION_REASONS).size, ONBOARDING_VALIDATION_REJECTION_REASONS.length);
		});
		test('isOnboardingValidationRejectionReason admits the members only', () => {
			for (const reason of ONBOARDING_VALIDATION_REJECTION_REASONS) {
				assert.equal(isOnboardingValidationRejectionReason(reason), true);
			}
			for (const value of ['unknown', 'DISPOSED', '', null, 1]) {
				assert.equal(isOnboardingValidationRejectionReason(value), false);
			}
		});
	});

	suite('ONBOARDING_PARSE_REJECTION_REASONS (the frozen parse table)', () => {
		test('the exact five reasons, in the exact first-failure order', () => {
			assert.deepEqual([...ONBOARDING_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
		});
		test('isOnboardingParseRejectionReason admits the members only', () => {
			for (const reason of ONBOARDING_PARSE_REJECTION_REASONS) {
				assert.equal(isOnboardingParseRejectionReason(reason), true);
			}
			assert.equal(isOnboardingParseRejectionReason('malformed-record'), false);
		});
	});

	suite('isOnboardingSessionId', () => {
		test('admits a well-formed session id', () => {
			assert.equal(isOnboardingSessionId(FIXTURE_SESSION_ID), true);
			assert.equal(isOnboardingSessionId(`${ONBOARDING_SESSION_ID_PREFIX}ffffffffffffffff`), true);
		});
		test('rejects non-strings and wrong prefixes', () => {
			assert.equal(isOnboardingSessionId(123), false);
			assert.equal(isOnboardingSessionId(null), false);
			assert.equal(isOnboardingSessionId('flauz:hrn:0123456789abcdef'), false);
			assert.equal(isOnboardingSessionId('flauz:onb:0123456789abcde'), false);
		});
		test('rejects a non-16-hex suffix (too short, too long, uppercase, non-hex)', () => {
			assert.equal(isOnboardingSessionId(`${ONBOARDING_SESSION_ID_PREFIX}0123456789abcde`), false);
			assert.equal(isOnboardingSessionId(`${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdef0`), false);
			assert.equal(isOnboardingSessionId(`${ONBOARDING_SESSION_ID_PREFIX}0123456789ABCDEF`), false);
			assert.equal(isOnboardingSessionId(`${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdeg`), false);
		});
	});

	suite('validateOnboardingIndustryPayload (the industry walk)', () => {
		test('admits a well-formed payload, and a JSON-parsed copy at the runtime boundary', () => {
			const verdict = validateOnboardingIndustryPayload({ industry: 'legal' });
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.deepEqual(verdict.value, { industry: 'legal' });
			}
			assert.equal(validateOnboardingIndustryPayload(parsedJson({ industry: 'software' })).ok, true);
		});
		test('a non-object payload is the malformed-record refusal', () => {
			for (const payload of [null, 'string', 123, [], undefined]) {
				const refusal = refusalOf(validateOnboardingIndustryPayload(payload));
				assert.equal(refusal.reason, 'malformed-record');
				assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
				assert.deepEqual(refusal.items, ['payload']);
			}
		});
		test('a forbidden key is the no-fork refusal with precedence over unknown-key', () => {
			const refusal = refusalOf(validateOnboardingIndustryPayload({ industry: 'legal', tool: 'fixture-tool' }));
			assert.equal(refusal.reason, 'no-fork');
			assert.equal(refusal.law, 'THE NO-FORK LAW');
			assert.deepEqual(refusal.items, ['tool']);
		});
		test('an unknown key is the unknown-key refusal; an absent industry is the missing-key refusal', () => {
			assert.equal(refusalOf(validateOnboardingIndustryPayload({ industry: 'legal', region: 'fixture-region' })).reason, 'unknown-key');
			assert.deepEqual(refusalOf(validateOnboardingIndustryPayload({ industry: 'legal', region: 'x' })).items, ['region']);
			assert.equal(refusalOf(validateOnboardingIndustryPayload({})).reason, 'missing-key');
			assert.deepEqual(refusalOf(validateOnboardingIndustryPayload({})).items, ['industry']);
		});
		test('a non-member industry is the unknown-industry refusal naming the value', () => {
			const refusal = refusalOf(validateOnboardingIndustryPayload({ industry: 'fintech' }));
			assert.equal(refusal.reason, 'unknown-industry');
			assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(refusal.items, ['fintech']);
			assert.deepEqual(refusalOf(validateOnboardingIndustryPayload({ industry: 123 })).items, ['123']);
			assert.deepEqual(refusalOf(validateOnboardingIndustryPayload({ industry: null })).items, ['<null>']);
		});
	});

	suite('validateOnboardingCompanyProfile (the company walk)', () => {
		test('admits a well-formed profile, every band, and a 120-character displayName', () => {
			for (const band of COMPANY_SIZE_BANDS) {
				assert.equal(validateOnboardingCompanyProfile(fixtureProfile({ sizeBand: band })).ok, true, `band ${band}`);
			}
			assert.equal(validateOnboardingCompanyProfile(fixtureProfile({ displayName: 'f'.repeat(120) })).ok, true);
			assert.equal(validateOnboardingCompanyProfile(parsedJson(fixtureProfile())).ok, true);
		});
		test('a non-object profile is the malformed-record refusal', () => {
			for (const profile of [null, 'string', 123, [], undefined]) {
				assert.equal(refusalOf(validateOnboardingCompanyProfile(profile)).reason, 'malformed-record');
			}
		});
		test('every forbidden key is the no-fork refusal (all ten)', () => {
			for (const key of FORBIDDEN_HARNESS_DESCRIPTOR_KEYS) {
				const refusal = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ [key]: 'fixture-material' })));
				assert.equal(refusal.reason, 'no-fork', `key ${key}`);
				assert.deepEqual(refusal.items, [key]);
			}
		});
		test('the forbidden family takes precedence over unknown-key (never reported as unknown)', () => {
			const refusal = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ code: 'x', vatId: 'y' })));
			assert.equal(refusal.reason, 'no-fork');
			assert.deepEqual(refusal.items, ['code']);
		});
		test('an unknown key is the unknown-key refusal; a missing key is the missing-key refusal', () => {
			assert.equal(refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ vatId: 'fixture-vat' }))).reason, 'unknown-key');
			assert.deepEqual(refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ vatId: 'x' }))).items, ['vatId']);
			assert.equal(refusalOf(validateOnboardingCompanyProfile({ displayName: 'fixture litigation group' })).reason, 'missing-key');
			assert.deepEqual(refusalOf(validateOnboardingCompanyProfile({ displayName: 'x' })).items, ['sizeBand']);
		});
		test('an empty or non-string displayName is the invalid-display-name refusal', () => {
			const empty = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ displayName: '' })));
			assert.equal(empty.reason, 'invalid-display-name');
			assert.deepEqual(empty.items, ['<empty string>']);
			const nonString = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ displayName: 123 })));
			assert.equal(nonString.reason, 'invalid-display-name');
			assert.deepEqual(nonString.items, ['123']);
		});
		test('a 121-character displayName is refused (120 is the bound)', () => {
			const refusal = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ displayName: 'f'.repeat(121) })));
			assert.equal(refusal.reason, 'invalid-display-name');
			assert.deepEqual(refusal.items, ['121 chars']);
			assert.match(refusal.message, /at most 120 characters/);
		});
		test('control characters are refused with their U+XXXX codes (C0, DEL, C1)', () => {
			const refusal = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ displayName: 'bad\u0007and\u007fworse\u0085end' })));
			assert.equal(refusal.reason, 'invalid-display-name');
			assert.deepEqual(refusal.items, ['U+0007', 'U+007F', 'U+0085']);
		});
		test('a non-member sizeBand is the unknown-size-band refusal', () => {
			const refusal = refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ sizeBand: 'giant' })));
			assert.equal(refusal.reason, 'unknown-size-band');
			assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(refusal.items, ['giant']);
			assert.deepEqual(refusalOf(validateOnboardingCompanyProfile(fixtureProfile({ sizeBand: null }))).items, ['<null>']);
		});
	});

	suite('validateOnboardingWorkTypes (the work-type walk)', () => {
		test('admits an ordered subset and the full frozen list', () => {
			const verdict = validateOnboardingWorkTypes(['analysis', 'drafting', 'review']);
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.deepEqual(verdict.value, ['analysis', 'drafting', 'review']);
			}
			assert.equal(validateOnboardingWorkTypes(['planning']).ok, true);
			assert.equal(validateOnboardingWorkTypes([...HARNESS_WORK_TYPES]).ok, true);
			assert.equal(validateOnboardingWorkTypes(parsedJson(['analysis'])).ok, true);
		});
		test('a non-array selection is the malformed-record refusal', () => {
			for (const selection of ['analysis', null, 123, {}, undefined]) {
				const refusal = refusalOf(validateOnboardingWorkTypes(selection));
				assert.equal(refusal.reason, 'malformed-record');
				assert.deepEqual(refusal.items, ['workTypes']);
			}
		});
		test('an empty selection is the empty-work-types refusal', () => {
			const refusal = refusalOf(validateOnboardingWorkTypes([]));
			assert.equal(refusal.reason, 'empty-work-types');
			assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(refusal.items, ['workTypes']);
		});
		test('a non-member work type is the unknown-work-type refusal naming every offender', () => {
			const refusal = refusalOf(validateOnboardingWorkTypes(['analysis', 'litigation', 'drafting', 'counseling']));
			assert.equal(refusal.reason, 'unknown-work-type');
			assert.deepEqual(refusal.items, ['litigation', 'counseling']);
			assert.deepEqual(refusalOf(validateOnboardingWorkTypes([42])).items, ['42']);
		});
		test('duplicate work types are the duplicate-work-types refusal', () => {
			const refusal = refusalOf(validateOnboardingWorkTypes(['analysis', 'drafting', 'analysis']));
			assert.equal(refusal.reason, 'duplicate-work-types');
			assert.deepEqual(refusal.items, ['analysis']);
		});
		test('an out-of-order selection is the work-types-out-of-order refusal naming the inversion pair', () => {
			const refusal = refusalOf(validateOnboardingWorkTypes(['drafting', 'analysis']));
			assert.equal(refusal.reason, 'work-types-out-of-order');
			assert.deepEqual(refusal.items, ['drafting', 'analysis']);
			assert.equal(refusalOf(validateOnboardingWorkTypes(['reporting', 'drafting'])).reason, 'work-types-out-of-order');
		});
	});

	suite('validateOnboardingReviewComposition (the composition walk)', () => {
		test('admits a well-formed composition with empty ref families (a draft composes gradually)', () => {
			const verdict = validateOnboardingReviewComposition(fixtureComposition({ capabilityRefs: [], workflowRefs: [], policyRefs: [], evidenceRefs: [] }));
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.deepEqual(verdict.value.capabilityRefs, []);
				assert.deepEqual(verdict.value.roles, [
					{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
					{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
				]);
			}
			assert.equal(validateOnboardingReviewComposition(parsedJson(fixtureComposition())).ok, true);
		});
		test('a non-object composition is the malformed-record refusal', () => {
			for (const composition of [null, 'string', 123, [], undefined]) {
				const refusal = refusalOf(validateOnboardingReviewComposition(composition));
				assert.equal(refusal.reason, 'malformed-record');
				assert.deepEqual(refusal.items, ['composition']);
			}
		});
		test('wrong-typed carriers are the malformed-record refusal listing every carrier', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ roles: 'nope', policyRefs: 'nope' })));
			assert.equal(refusal.reason, 'malformed-record');
			assert.deepEqual(refusal.items, ['roles', 'policyRefs']);
		});
		test('a forbidden key on the record is the no-fork refusal', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ script: 'fixture-script' })));
			assert.equal(refusal.reason, 'no-fork');
			assert.equal(refusal.law, 'THE NO-FORK LAW');
			assert.deepEqual(refusal.items, ['script']);
		});
		test('an extra key on a role entry is the no-fork refusal (the DH-01 station c)', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ roles: [{ roleKey: 'fixture.counsel', summary: 'x', tools: 'fixture-tools' }] })));
			assert.equal(refusal.reason, 'no-fork');
			assert.deepEqual(refusal.items, ['roles[0].tools']);
			const both = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ patch: 'x', roles: [{ roleKey: 'a', summary: 'b', inline: 'c' }] })));
			assert.deepEqual(both.items, ['patch', 'roles[0].inline']);
		});
		test('an unknown key is the unknown-key refusal; missing keys are the missing-key refusal', () => {
			assert.equal(refusalOf(validateOnboardingReviewComposition(fixtureComposition({ templates: [] }))).reason, 'unknown-key');
			assert.deepEqual(refusalOf(validateOnboardingReviewComposition(fixtureComposition({ templates: [] }))).items, ['templates']);
			const missing = refusalOf(validateOnboardingReviewComposition({ roles: fixtureRoles(), capabilityRefs: [], workflowRefs: [], policyRefs: [] }));
			assert.equal(missing.reason, 'missing-key');
			assert.deepEqual(missing.items, ['evidenceRefs']);
		});
		test('an empty roles array is the empty-roles refusal', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ roles: [] })));
			assert.equal(refusal.reason, 'empty-roles');
			assert.deepEqual(refusal.items, ['roles']);
			assert.match(refusal.message, /DH-003/);
		});
		test('a malformed role entry is the malformed-role refusal listing every offender', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({
				roles: [{ roleKey: 'fixture.counsel', summary: 'ok' }, null, { roleKey: '', summary: 'x' }, { roleKey: 'y', summary: 9 }],
			})));
			assert.equal(refusal.reason, 'malformed-role');
			assert.deepEqual(refusal.items, ['roles[1]', 'roles[2]', 'roles[3]']);
		});
		test('duplicate roleKeys are the duplicate-role-keys refusal', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({
				roles: [
					{ roleKey: 'fixture.counsel', summary: 'one' },
					{ roleKey: 'fixture.paralegal', summary: 'two' },
					{ roleKey: 'fixture.counsel', summary: 'three' },
				],
			})));
			assert.equal(refusal.reason, 'duplicate-role-keys');
			assert.deepEqual(refusal.items, ['fixture.counsel']);
		});
		test('a non-string ref member is the malformed-refs refusal naming family and index', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({ capabilityRefs: ['cap-fixture-001', 42], evidenceRefs: ['ev-fixture-001', null, 'ev-fixture-002'] })));
			assert.equal(refusal.reason, 'malformed-refs');
			assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
			assert.deepEqual(refusal.items, ['capabilityRefs[1]', 'evidenceRefs[1]']);
		});
		test('duplicate refs are the duplicate-ref refusal with family-prefixed items', () => {
			const refusal = refusalOf(validateOnboardingReviewComposition(fixtureComposition({
				capabilityRefs: ['cap-fixture-001', 'cap-fixture-002', 'cap-fixture-001'],
				workflowRefs: ['wf-fixture-001', 'wf-fixture-001'],
			})));
			assert.equal(refusal.reason, 'duplicate-ref');
			assert.deepEqual(refusal.items, ['capabilityRefs:cap-fixture-001', 'workflowRefs:wf-fixture-001']);
		});
		test('the ok value is the canonical fixed-key-order copy', () => {
			const verdict = validateOnboardingReviewComposition(parsedJson(fixtureComposition()));
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.deepEqual(Object.keys(verdict.value), [...ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS]);
				assert.deepEqual(Object.keys(verdict.value.roles[0]), ['roleKey', 'summary']);
			}
		});
	});

	suite('validateOnboardingSessionRecord (the deep session walk)', () => {
		test('admits a well-formed session record and returns the canonical copy', () => {
			const verdict = validateOnboardingSessionRecord(parsedJson(fixtureSession()));
			assert.equal(verdict.ok, true);
			if (verdict.ok) {
				assert.deepEqual(Object.keys(verdict.value), [...ONBOARDING_SESSION_SCHEMA_KEYS]);
				assert.equal(verdict.value.stage, 'review');
				assert.equal(verdict.value.harnessId, FIXTURE_HARNESS_ID);
				assert.equal(verdict.value.revision, 5);
				assert.deepEqual(verdict.value.companyProfile, { displayName: 'fixture litigation group', sizeBand: 'small' });
			}
		});
		test('a non-object record is the malformed-record refusal', () => {
			for (const record of [null, 'string', 123, [], undefined]) {
				assert.equal(refusalOf(validateOnboardingSessionRecord(record)).reason, 'malformed-record');
			}
		});
		test('structural violations are the malformed-record refusal listing every field', () => {
			const refusal = refusalOf(validateOnboardingSessionRecord(fixtureSession({ stage: 'propossed', harnessId: 'nope', revision: 0 })));
			assert.equal(refusal.reason, 'malformed-record');
			assert.deepEqual(refusal.items, ['stage', 'harnessId', 'revision']);
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ createdAtIso: '' }))).items, ['createdAtIso']);
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ history: [fixtureNotes()[0], null] }))).items, ['history[1]']);
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ companyProfile: 'nope' }))).items, ['companyProfile']);
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ workTypes: 'nope' }))).items, ['workTypes']);
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ reviewComposition: 'nope' }))).items, ['reviewComposition']);
		});
		test('a forbidden key on the session record is the no-fork refusal', () => {
			const refusal = refusalOf(validateOnboardingSessionRecord(fixtureSession({ tools: 'fixture-tools' })));
			assert.equal(refusal.reason, 'no-fork');
			assert.deepEqual(refusal.items, ['tools']);
		});
		test('unknown and missing session keys are the unknown-key / missing-key refusals', () => {
			assert.equal(refusalOf(validateOnboardingSessionRecord(fixtureSession({ owner: 'x' }))).reason, 'unknown-key');
			const { revision, ...withoutRevision } = fixtureSession() as Record<string, unknown>;
			assert.equal(refusalOf(validateOnboardingSessionRecord(withoutRevision)).reason, 'missing-key');
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(withoutRevision)).items, ['revision']);
			assert.equal(revision, 5);
		});
		test('a malformed session id is the unknown-session refusal', () => {
			const refusal = refusalOf(validateOnboardingSessionRecord(fixtureSession({ sessionId: 'flauz:hrn:0123456789abcdef' })));
			assert.equal(refusal.reason, 'unknown-session');
			assert.deepEqual(refusal.items, ['flauz:hrn:0123456789abcdef']);
		});
		test('a drifted contract version is the version-mismatch refusal (THE SINGLE-VERSION LAW)', () => {
			const refusal = refusalOf(validateOnboardingSessionRecord(fixtureSession({ contractVersion: '2.0.0' })));
			assert.equal(refusal.reason, 'version-mismatch');
			assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
			assert.deepEqual(refusal.items, ['2.0.0']);
		});
		test('a non-member industry field is the unknown-industry refusal', () => {
			assert.deepEqual(refusalOf(validateOnboardingSessionRecord(fixtureSession({ industry: 'fintech' }))).items, ['fintech']);
		});
		test('the payload walks surface verbatim (the delegated refusals)', () => {
			assert.equal(refusalOf(validateOnboardingSessionRecord(fixtureSession({ companyProfile: fixtureProfile({ sizeBand: 'giant' }) }))).reason, 'unknown-size-band');
			assert.equal(refusalOf(validateOnboardingSessionRecord(fixtureSession({ workTypes: ['drafting', 'analysis'] }))).reason, 'work-types-out-of-order');
			assert.equal(refusalOf(validateOnboardingSessionRecord(fixtureSession({ reviewComposition: fixtureComposition({ roles: [] }) }))).reason, 'empty-roles');
			assert.equal(refusalOf(validateOnboardingSessionRecord(fixtureSession({ reviewComposition: fixtureComposition({ capabilityRefs: ['a', 'a'] }) }))).reason, 'duplicate-ref');
		});
	});

	suite('isOnboardingSessionRecord + serializeOnboardingSession (the canonical bytes)', () => {
		test('the predicate admits the well-formed record and refuses drift', () => {
			assert.equal(isOnboardingSessionRecord(parsedJson(fixtureSession())), true);
			assert.equal(isOnboardingSessionRecord(fixtureSession({ stage: 'nope' })), false);
			assert.equal(isOnboardingSessionRecord(null), false);
		});
		test('the canonical bytes emit the frozen key orders (deep)', () => {
			const bytes = serializeOnboardingSession(parsedJson(fixtureSession()));
			const parsed = JSON.parse(bytes) as Record<string, unknown>;
			assert.deepEqual(Object.keys(parsed), [...ONBOARDING_SESSION_SCHEMA_KEYS]);
			assert.deepEqual(Object.keys(parsed.companyProfile as Record<string, unknown>), [...COMPANY_PROFILE_SCHEMA_KEYS]);
			assert.deepEqual(Object.keys(parsed.reviewComposition as Record<string, unknown>), [...ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS]);
			const roles = (parsed.reviewComposition as Record<string, unknown>).roles as Record<string, unknown>[];
			assert.deepEqual(Object.keys(roles[0]), ['roleKey', 'summary']);
			const history = parsed.history as Record<string, unknown>[];
			assert.deepEqual(Object.keys(history[0]), [...ONBOARDING_NOTE_SCHEMA_KEYS]);
		});
		test('double serialization is byte-identical (determinism)', () => {
			const record = parsedJson(fixtureSession());
			const once = serializeOnboardingSession(record);
			const twice = serializeOnboardingSession(JSON.parse(once) as unknown);
			assert.equal(once, twice);
			const reOrdered = JSON.parse(once) as Record<string, unknown>;
			const scrambled = { history: reOrdered.history, revision: reOrdered.revision, harnessId: reOrdered.harnessId, createdAtIso: reOrdered.createdAtIso, reviewComposition: reOrdered.reviewComposition, workTypes: reOrdered.workTypes, companyProfile: reOrdered.companyProfile, industry: reOrdered.industry, stage: reOrdered.stage, contractVersion: reOrdered.contractVersion, sessionId: reOrdered.sessionId };
			assert.equal(serializeOnboardingSession(scrambled as unknown), once);
		});
		test('a malformed record never gets canonical bytes (TypeError)', () => {
			assert.throws(() => serializeOnboardingSession(fixtureSession({ stage: 'nope' })), TypeError);
			assert.throws(() => serializeOnboardingSession(null), TypeError);
		});
	});

	suite('parseOnboardingSession (the fail-closed parse)', () => {
		test('round-trips the canonical bytes into the identical record', () => {
			const bytes = serializeOnboardingSession(parsedJson(fixtureSession()));
			const outcome = parseOnboardingSession(bytes);
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(serializeOnboardingSession(outcome.record), bytes);
				assert.equal(outcome.record.sessionId, FIXTURE_SESSION_ID);
				assert.deepEqual(outcome.record.history, JSON.parse(bytes).history);
			}
		});
		test('non-string bytes and malformed JSON are refused fail-closed', () => {
			assert.equal(parseOnboardingSession(null).ok, false);
			const notString = parseOnboardingSession(123);
			assert.equal(notString.ok, false);
			if (!notString.ok) {
				assert.equal(notString.rejection.reason, 'torn-envelope');
			}
			const badJson = parseOnboardingSession('{not json');
			assert.equal(badJson.ok, false);
			if (!badJson.ok) {
				assert.equal(badJson.rejection.reason, 'malformed-json');
			}
		});
		test('a torn envelope (non-object, missing key, wrong structural type) fails closed', () => {
			const jsonNull = parseOnboardingSession('null');
			assert.equal(jsonNull.ok, false);
			if (!jsonNull.ok) {
				assert.equal(jsonNull.rejection.reason, 'torn-envelope');
			}
			const valid = JSON.parse(serializeOnboardingSession(parsedJson(fixtureSession()))) as Record<string, unknown>;
			const missing = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
			delete missing.revision;
			const missingOutcome = parseOnboardingSession(JSON.stringify(missing));
			assert.equal(missingOutcome.ok, false);
			if (!missingOutcome.ok) {
				assert.equal(missingOutcome.rejection.reason, 'torn-envelope');
				assert.match(missingOutcome.rejection.message, /'revision' key is missing/);
			}
			const wrongType = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
			wrongType.history = 'nope';
			const wrongTypeOutcome = parseOnboardingSession(JSON.stringify(wrongType));
			assert.equal(wrongTypeOutcome.ok, false);
			if (!wrongTypeOutcome.ok) {
				assert.equal(wrongTypeOutcome.rejection.reason, 'torn-envelope');
			}
		});
		test('a drifted contract version is the unknown-contract-version rejection', () => {
			const valid = JSON.parse(serializeOnboardingSession(parsedJson(fixtureSession()))) as Record<string, unknown>;
			valid.contractVersion = '9.9.9';
			const outcome = parseOnboardingSession(JSON.stringify(valid));
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.rejection.reason, 'unknown-contract-version');
				assert.match(outcome.rejection.message, /single-version law/);
			}
		});
		test('unknown keys fail closed at the record, profile, composition, role and note levels', () => {
			const base = (): Record<string, unknown> => JSON.parse(serializeOnboardingSession(parsedJson(fixtureSession()))) as Record<string, unknown>;
			const cases: Array<{ tamper: (record: Record<string, unknown>) => void; fragment: RegExp }> = [
				{ tamper: (record) => { record.owner = 'x'; }, fragment: /the record carries the unknown key 'owner'/ },
				{ tamper: (record) => { (record.companyProfile as Record<string, unknown>).vatId = 'x'; }, fragment: /company profile carries the unknown key 'vatId'/ },
				{ tamper: (record) => { (record.reviewComposition as Record<string, unknown>).templates = []; }, fragment: /review composition carries the unknown key 'templates'/ },
				{ tamper: (record) => { ((record.reviewComposition as Record<string, unknown>).roles as Record<string, unknown>[])[0].tools = 'x'; }, fragment: /roles\[0\] carries the unknown key 'tools'/ },
				{ tamper: (record) => { (record.history as Record<string, unknown>[])[0].decision = 'x'; }, fragment: /history\[0\] carries the unknown key 'decision'/ },
			];
			for (const testCase of cases) {
				const record = base();
				testCase.tamper(record);
				const outcome = parseOnboardingSession(JSON.stringify(record));
				assert.equal(outcome.ok, false, JSON.stringify(record).slice(0, 80));
				if (!outcome.ok) {
					assert.equal(outcome.rejection.reason, 'unknown-key', testCase.fragment.source);
					assert.match(outcome.rejection.message, testCase.fragment);
				}
			}
		});
		test('invalid content fails closed as invalid-record naming the deep walk refusal', () => {
			const valid = JSON.parse(serializeOnboardingSession(parsedJson(fixtureSession()))) as Record<string, unknown>;
			(valid.companyProfile as Record<string, unknown>).displayName = '';
			const outcome = parseOnboardingSession(JSON.stringify(valid));
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.rejection.reason, 'invalid-record');
				assert.match(outcome.rejection.message, /invalid-display-name/);
			}
			const drifted = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
			(drifted as Record<string, unknown>).sessionId = 'nope';
			const idOutcome = parseOnboardingSession(JSON.stringify(drifted));
			assert.equal(idOutcome.ok, false);
			if (!idOutcome.ok) {
				assert.equal(idOutcome.rejection.reason, 'invalid-record');
			}
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in onboardingContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/onboardingContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
