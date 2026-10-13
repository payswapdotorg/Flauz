/*
 * DH-003 role-composition contract test suite (mocha tdd style,
 * matching build/flauz/harness/contract/test/common/*.test.ts and
 * build/flauz/harness/onboarding/test/common/*.test.ts - the landed
 * DH-001/DH-002 family precedents).
 *
 * Fixture policy: every session id, industry, role and timestamp
 * below is SYNTHETIC (fixed fixture ISO strings, the
 * 'flauz:rol:<16-hex>' fixture ids, 'fixture.'-prefixed roleKeys) and
 * is NOT an authority value, NOT credential material, NOT execution
 * material. The frozen-vocabulary cross-pins import the REAL DH-01
 * contract module and the REAL DH-02 onboarding contract module and
 * pin referential identity and verbatim equality - THE IMPORT LAW as
 * a test. The in-suite determinism greps pin the shipped module to
 * law-comment lines only (the banned-global patterns are assembled
 * piecewise so this test source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION,
	HARNESS_INDUSTRIES as REAL_INDUSTRIES,
	HARNESS_REF_FAMILIES as REAL_REF_FAMILIES,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_VERSION, validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_INDUSTRIES,
	HARNESS_REF_FAMILIES,
	MAX_ROLES,
	ONBOARDING_CONTRACTS_VERSION,
	ROLE_COMPOSITION_FORWARD_TRANSITIONS,
	ROLE_COMPOSITION_ID_PREFIX,
	ROLE_COMPOSITION_NOTE_SCHEMA_KEYS,
	ROLE_COMPOSITION_OP_NAMES,
	ROLE_COMPOSITION_SESSION_SCHEMA_KEYS,
	ROLE_COMPOSITION_STAGES,
	ROLE_KEY_MAX_LENGTH,
	ROLE_SUMMARY_MAX_LENGTH,
	ROLES_CONTRACTS_VERSION,
	ROLES_PARSE_REJECTION_REASONS,
	ROLES_REJECTION_REASONS,
	canTransitionRoleCompositionStage,
	isRoleCompositionParseRejectionReason,
	isRoleCompositionRejectionReason,
	isRoleCompositionSession,
	isRoleCompositionSessionId,
	isRoleCompositionStage,
	parseRoleCompositionSession,
	serializeRoleCompositionSession,
	validateReviewCompositionEmit,
	validateRoleCompositionSession,
	validateRoleEntry,
	validateRoleSummary,
} from '../../common/rolesContract.js';
import type {
	RoleCompositionParseRejection,
	RoleCompositionRejection,
	RoleCompositionSession,
	RoleCompositionStageVerdict,
	RoleCompositionValidationOutcome,
} from '../../common/rolesContract.js';

const FIXTURE_HEX = '0123456789abcdef';
const FIXTURE_SESSION_ID = `${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`;

function fixtureNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		at: '2026-10-13T00:00:00.000Z',
		fromStage: null,
		toStage: 'composing',
		op: 'begin-session',
		law: 'THE FORWARD-ONLY LAW',
		detail: 'fixture begin note',
		...overrides,
	};
}

function fixtureRole(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { roleKey: 'fixture.counsel', summary: 'the fixture counsel role', ...overrides };
}

function fixtureSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sessionId: FIXTURE_SESSION_ID,
		industry: 'legal',
		stage: 'composing',
		roles: [fixtureRole()],
		history: [fixtureNote()],
		...overrides,
	};
}

function valueOf<T>(outcome: RoleCompositionValidationOutcome<T>): T {
	if (outcome.ok) {
		return outcome.value;
	}
	assert.fail(`expected ok, received rejections: ${JSON.stringify(outcome.rejections)}`);
}

function rejectionsOf<T>(outcome: RoleCompositionValidationOutcome<T>): readonly RoleCompositionRejection[] {
	if (!outcome.ok) {
		return outcome.rejections;
	}
	assert.fail(`expected a refusal, received ok: ${JSON.stringify(outcome.value)}`);
}

function refusedVerdict(from: unknown, to: unknown): Extract<RoleCompositionStageVerdict, { ok: false }> {
	const verdict = canTransitionRoleCompositionStage(from, to);
	if (!verdict.ok) {
		return verdict;
	}
	assert.fail(`expected an ILLEGAL_TRANSITION verdict, received ok: ${JSON.stringify(verdict)}`);
}

function parseRefusal(bytes: unknown): RoleCompositionParseRejection {
	const outcome = parseRoleCompositionSession(bytes);
	if (!outcome.ok) {
		return outcome.rejection;
	}
	assert.fail(`expected a parse refusal, received ok: ${JSON.stringify(outcome.session)}`);
}

function parsedSession(bytes: string): RoleCompositionSession {
	const outcome = parseRoleCompositionSession(bytes);
	if (outcome.ok) {
		return outcome.session;
	}
	assert.fail(`expected a parsed session, received refusal: ${JSON.stringify(outcome.rejection)}`);
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

suite('DH-003 role-composition contract', () => {

	suite('the single-version law (the re-export chain)', () => {
		test('ROLES_CONTRACTS_VERSION is 1.0.0, declared ONCE here', () => {
			assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
		});

		test('DOMAIN_HARNESS_CONTRACTS_VERSION is re-carried from the REAL DH-01 module', () => {
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
		});

		test('ONBOARDING_CONTRACTS_VERSION is re-carried from the REAL DH-02 module', () => {
			assert.equal(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_VERSION);
			assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
		});

		test('ROLES_REJECTION_REASONS pinned verbatim: the WO fifteen-station prefix plus the four appended stations', () => {
			assert.deepEqual([...ROLES_REJECTION_REASONS], [
				'malformed-record', 'unknown-key', 'missing-key', 'unknown-industry',
				'malformed-role', 'no-fork', 'invalid-role-key', 'invalid-summary',
				'duplicate-role-key', 'max-roles-exceeded', 'empty-roles',
				'unknown-session', 'version-mismatch', 'unknown-stage', 'malformed-history',
				'premature-op', 'stale-stage', 'unknown-role', 'duplicate-ref',
			]);
		});
	});

	suite('the frozen vocabularies (THE IMPORT LAW)', () => {
		test('HARNESS_INDUSTRIES is the REAL DH-01 binding (referential identity) and pinned verbatim (16 members)', () => {
			assert.equal(HARNESS_INDUSTRIES, REAL_INDUSTRIES);
			assert.deepEqual([...HARNESS_INDUSTRIES], [...REAL_INDUSTRIES]);
			assert.deepEqual([...REAL_INDUSTRIES], [
				'software', 'legal', 'finance', 'healthcare', 'education', 'marketing', 'science', 'media',
				'construction', 'logistics', 'retail', 'manufacturing', 'energy', 'agriculture', 'government', 'hospitality',
			]);
		});

		test('HARNESS_REF_FAMILIES is the REAL DH-01 binding (referential identity) and pinned verbatim (the four names)', () => {
			assert.equal(HARNESS_REF_FAMILIES, REAL_REF_FAMILIES);
			assert.deepEqual([...HARNESS_REF_FAMILIES], [...REAL_REF_FAMILIES]);
			assert.deepEqual([...HARNESS_REF_FAMILIES], ['capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']);
		});

		test('the family\'s own frozen constants pinned (stages, whitelist, prefix, bounds, schema keys, op names)', () => {
			assert.deepEqual([...ROLE_COMPOSITION_STAGES], ['composing', 'composed']);
			assert.deepEqual([...ROLE_COMPOSITION_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
			assert.equal(ROLE_COMPOSITION_ID_PREFIX, 'flauz:rol:');
			assert.equal(ROLE_KEY_MAX_LENGTH, 64);
			assert.equal(ROLE_SUMMARY_MAX_LENGTH, 200);
			assert.equal(MAX_ROLES, 32);
			assert.deepEqual([...ROLE_COMPOSITION_SESSION_SCHEMA_KEYS], ['sessionId', 'industry', 'stage', 'roles', 'history']);
			assert.deepEqual([...ROLE_COMPOSITION_NOTE_SCHEMA_KEYS], ['at', 'fromStage', 'toStage', 'op', 'law', 'detail']);
			assert.deepEqual([...ROLE_COMPOSITION_OP_NAMES], ['begin-session', 'add-role', 'replace-role-summary', 'remove-role', 'finalize-composition']);
		});
	});

	suite('the stage machine (forward-only; composed is TERMINAL)', () => {
		test('composing->composed is the only whitelisted row (row 1)', () => {
			const verdict = canTransitionRoleCompositionStage('composing', 'composed');
			assert.deepEqual(verdict, { ok: true, from: 'composing', to: 'composed', row: 1 });
		});

		test('composed->anything is TERMINAL (no reopen; a changed composition is a NEW session)', () => {
			const self = refusedVerdict('composed', 'composed');
			assert.equal(self.reason, 'ILLEGAL_TRANSITION');
			assert.equal(self.whitelistRow, null);
			assert.equal(self.expectedTo, null);
			assert.match(self.detail, /TERMINAL/);
			const back = refusedVerdict('composed', 'composing');
			assert.equal(back.whitelistRow, null);
			assert.equal(back.expectedTo, null);
			assert.match(back.detail, /TERMINAL/);
		});

		test('composing->composing (the self-loop) is refused naming the whitelisted successor', () => {
			const verdict = refusedVerdict('composing', 'composing');
			assert.equal(verdict.whitelistRow, 1);
			assert.equal(verdict.expectedTo, 'composed');
			assert.match(verdict.detail, /whitelisted forward transition/);
		});

		test('unknown stages and non-strings are refused (the frozen stage vocabulary)', () => {
			const unknownFrom = refusedVerdict('draft', 'composed');
			assert.match(unknownFrom.detail, /frozen ROLE_COMPOSITION_STAGES list/);
			const unknownTo = refusedVerdict('composing', 'finalized');
			assert.match(unknownTo.detail, /frozen ROLE_COMPOSITION_STAGES list/);
			const nonString = refusedVerdict(null, 'composed');
			assert.match(nonString.detail, /frozen ROLE_COMPOSITION_STAGES list/);
		});
	});

	suite('the id alphabet', () => {
		test('the green flauz:rol:<16-hex> form', () => {
			assert.equal(isRoleCompositionSessionId(FIXTURE_SESSION_ID), true);
			assert.equal(isRoleCompositionSessionId(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`), true);
		});

		test('the refusal forms (wrong prefix, wrong length, uppercase, non-string)', () => {
			assert.equal(isRoleCompositionSessionId('flauz:hrn:0123456789abcdef'), false);
			assert.equal(isRoleCompositionSessionId('flauz:onb:0123456789abcdef'), false);
			assert.equal(isRoleCompositionSessionId(`${ROLE_COMPOSITION_ID_PREFIX}0123456789abcde`), false);
			assert.equal(isRoleCompositionSessionId(`${ROLE_COMPOSITION_ID_PREFIX}0123456789ABCDEF`), false);
			assert.equal(isRoleCompositionSessionId(`${ROLE_COMPOSITION_ID_PREFIX}0123456789abcdeff`), false);
			assert.equal(isRoleCompositionSessionId(''), false);
			assert.equal(isRoleCompositionSessionId(123), false);
			assert.equal(isRoleCompositionSessionId(null), false);
		});
	});

	suite('validateRoleEntry (the single-role station walk)', () => {
		test('the green path returns the canonical { roleKey, summary } copy', () => {
			const value = valueOf(validateRoleEntry(fixtureRole()));
			assert.deepEqual(value, { roleKey: 'fixture.counsel', summary: 'the fixture counsel role' });
			assert.deepEqual(Object.keys(value), ['roleKey', 'summary']);
		});

		test('a non-record entry is the malformed-role rejection', () => {
			for (const bad of ['not-a-role', 123, null]) {
				const rejections = rejectionsOf(validateRoleEntry(bad));
				assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-role']);
			}
		});

		test('non-string carriers are malformed-role naming the carrier', () => {
			const key = rejectionsOf(validateRoleEntry({ roleKey: 123, summary: 'x' }));
			assert.deepEqual(key.map((rejection) => rejection.reason), ['malformed-role']);
			assert.deepEqual(key[0].items, ['roleKey']);
			const summary = rejectionsOf(validateRoleEntry({ roleKey: 'fixture.counsel', summary: 123 }));
			assert.deepEqual(summary[0].items, ['summary']);
		});

		test('an extra key is the no-fork rejection (THE NO-FORK LAW\'s role station)', () => {
			const rejections = rejectionsOf(validateRoleEntry(fixtureRole({ tools: 'fixture-tools' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork']);
			assert.equal(rejections[0].law, 'THE NO-FORK LAW');
			assert.deepEqual(rejections[0].items, ['tools']);
		});

		test('a DH-01 forbidden-family key is the same no-fork station', () => {
			const rejections = rejectionsOf(validateRoleEntry(fixtureRole({ command: 'fixture-command' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork']);
			assert.deepEqual(rejections[0].items, ['command']);
		});

		test('the roleKey bounds: empty and over-length (65 chars) are invalid-role-key', () => {
			const empty = rejectionsOf(validateRoleEntry(fixtureRole({ roleKey: '' })));
			assert.deepEqual(empty.map((rejection) => rejection.reason), ['invalid-role-key']);
			assert.deepEqual(empty[0].items, ['empty']);
			const overLength = rejectionsOf(validateRoleEntry(fixtureRole({ roleKey: 'f'.repeat(65) })));
			assert.deepEqual(overLength[0].items, ['65 chars']);
		});

		test('the roleKey whitespace padding is invalid-role-key', () => {
			const padded = rejectionsOf(validateRoleEntry(fixtureRole({ roleKey: ' fixture.counsel' })));
			assert.deepEqual(padded.map((rejection) => rejection.reason), ['invalid-role-key']);
			assert.deepEqual(padded[0].items, ['leading/trailing whitespace']);
			const trailing = rejectionsOf(validateRoleEntry(fixtureRole({ roleKey: 'fixture.counsel ' })));
			assert.deepEqual(trailing[0].items, ['leading/trailing whitespace']);
		});

		test('the roleKey control characters are invalid-role-key (U+XXXX items)', () => {
			const rejections = rejectionsOf(validateRoleEntry(fixtureRole({ roleKey: 'fixture\u0007counsel' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-role-key']);
			assert.deepEqual(rejections[0].items, ['U+0007']);
		});

		test('the summary bounds: empty and over-length (201 chars) are invalid-summary', () => {
			const empty = rejectionsOf(validateRoleEntry(fixtureRole({ summary: '' })));
			assert.deepEqual(empty.map((rejection) => rejection.reason), ['invalid-summary']);
			assert.deepEqual(empty[0].items, ['empty']);
			const overLength = rejectionsOf(validateRoleEntry(fixtureRole({ summary: 'f'.repeat(201) })));
			assert.deepEqual(overLength[0].items, ['201 chars']);
		});

		test('the summary control characters are invalid-summary', () => {
			const rejections = rejectionsOf(validateRoleEntry(fixtureRole({ summary: 'the fixture\u009Fcounsel role' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-summary']);
			assert.deepEqual(rejections[0].items, ['U+009F']);
		});

		test('multi-offense reports the COMPLETE table in the frozen walk order', () => {
			const rejections = rejectionsOf(validateRoleEntry({ roleKey: ' padded ', summary: '', tools: 'fixture-tools' }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork', 'invalid-role-key', 'invalid-summary']);
			assert.deepEqual(rejections[0].items, ['tools']);
			assert.deepEqual(rejections[1].items, ['leading/trailing whitespace']);
			assert.deepEqual(rejections[2].items, ['empty']);
		});
	});

	suite('validateRoleSummary (the summary station walk)', () => {
		test('the green path carries the summary string', () => {
			assert.equal(valueOf(validateRoleSummary('the fixture counsel role')), 'the fixture counsel role');
		});

		test('a non-string summary is malformed-record naming the carrier', () => {
			const rejections = rejectionsOf(validateRoleSummary(123));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['summary']);
		});

		test('the bounds violations (empty, over-length) are invalid-summary', () => {
			assert.deepEqual(rejectionsOf(validateRoleSummary('')).map((rejection) => rejection.reason), ['invalid-summary']);
			assert.deepEqual(rejectionsOf(validateRoleSummary('f'.repeat(201)))[0].items, ['201 chars']);
			assert.equal(valueOf(validateRoleSummary('f'.repeat(200))).length, 200);
		});

		test('the summary control characters are invalid-summary', () => {
			const rejections = rejectionsOf(validateRoleSummary('the fixture\u0007counsel role'));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-summary']);
			assert.deepEqual(rejections[0].items, ['U+0007']);
		});
	});

	suite('validateRoleCompositionSession (the deep five-key walk)', () => {
		test('the green minimal session returns the canonical copy', () => {
			const value = valueOf(validateRoleCompositionSession(fixtureSession()));
			assert.deepEqual(value, {
				sessionId: FIXTURE_SESSION_ID,
				industry: 'legal',
				stage: 'composing',
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }],
				history: [{ at: '2026-10-13T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail: 'fixture begin note' }],
			});
		});

		test('a non-record is malformed-record', () => {
			for (const bad of ['not-a-session', 123, null, undefined]) {
				const rejections = rejectionsOf(validateRoleCompositionSession(bad));
				assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			}
		});

		test('an unknown key is unknown-key', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ bogus: 1 })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key']);
			assert.deepEqual(rejections[0].items, ['bogus']);
		});

		test('a missing key is missing-key', () => {
			const candidate = fixtureSession() as Record<string, unknown>;
			delete candidate.stage;
			const rejections = rejectionsOf(validateRoleCompositionSession(candidate));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['missing-key']);
			assert.deepEqual(rejections[0].items, ['stage']);
		});

		test('a contractVersion key is unknown-key (THE FIVE-KEY MODEL: no version field)', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession({ ...fixtureSession(), contractVersion: '1.0.0' }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key']);
			assert.deepEqual(rejections[0].items, ['contractVersion']);
		});

		test('a non-member industry is unknown-industry (the REAL imported list)', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ industry: 'fintech' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-industry']);
			assert.equal(rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(rejections[0].items, ['fintech']);
		});

		test('non-array carriers (roles / history) are malformed-record', () => {
			const roles = rejectionsOf(validateRoleCompositionSession(fixtureSession({ roles: 'nope' })));
			assert.deepEqual(roles.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(roles[0].items, ['roles']);
			const history = rejectionsOf(validateRoleCompositionSession(fixtureSession({ history: 'nope' })));
			assert.deepEqual(history[0].items, ['history']);
		});

		test('a non-record role entry is malformed-role (the roles[i] item)', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ roles: ['not-a-role'] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-role']);
			assert.deepEqual(rejections[0].items, ['roles[0]']);
		});

		test('role-entry law violations surface with the roles[i]: item prefix', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ roles: [fixtureRole({ roleKey: ' padded ' })] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-role-key']);
			assert.deepEqual(rejections[0].items, ['roles[0]:leading/trailing whitespace']);
		});

		test('duplicate roleKeys are duplicate-role-key', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ roles: [fixtureRole(), fixtureRole()] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['duplicate-role-key']);
			assert.deepEqual(rejections[0].items, ['fixture.counsel']);
		});

		test('the MAX_ROLES bound: 32 roles green, 33 roles max-roles-exceeded', () => {
			const roles32 = Array.from({ length: 32 }, (_, i) => ({ roleKey: `fixture.role-${String(i + 1).padStart(2, '0')}`, summary: 'the fixture summary' }));
			assert.equal(validateRoleCompositionSession(fixtureSession({ roles: roles32 })).ok, true);
			const roles33 = [...roles32, { roleKey: 'fixture.role-33', summary: 'the fixture summary' }];
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ roles: roles33 })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['max-roles-exceeded']);
			assert.deepEqual(rejections[0].items, ['33 roles']);
		});

		test('a malformed sessionId is unknown-session', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ sessionId: 'flauz:hrn:0123456789abcdef' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-session']);
		});

		test('a non-member stage is unknown-stage', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ stage: 'draft' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-stage']);
		});

		test('a malformed history note is malformed-history', () => {
			const rejections = rejectionsOf(validateRoleCompositionSession(fixtureSession({ history: [fixtureNote({ op: 'bogus-op' })] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-history']);
			assert.deepEqual(rejections[0].items, ['history[0]']);
		});

		test('empty roles are LEGAL in the session shape (the floor fires at finalize / emit)', () => {
			assert.equal(validateRoleCompositionSession(fixtureSession({ roles: [] })).ok, true);
		});

		test('multi-offense reports the COMPLETE table in the frozen walk order', () => {
			const candidate = { industry: 'fintech', stage: 'draft', contractVersion: '1.0.0', roles: [], history: [] };
			const rejections = rejectionsOf(validateRoleCompositionSession(candidate));
			// station-fix (R67): the absent sessionId is the missing-key station only — the DH-01
			// absent-key discipline: an absent key NEVER produces a structural/field rejection.
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key', 'missing-key', 'unknown-industry', 'unknown-stage']);
		});
	});

	suite('validateReviewCompositionEmit (the emit-input walk)', () => {
		test('the green path with the empty refs record: the four families default EMPTY', () => {
			const value = valueOf(validateReviewCompositionEmit([fixtureRole()], {}));
			assert.deepEqual(value.roles, [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }]);
			assert.deepEqual(value.capabilityRefs, []);
			assert.deepEqual(value.workflowRefs, []);
			assert.deepEqual(value.policyRefs, []);
			assert.deepEqual(value.evidenceRefs, []);
		});

		test('caller families are carried verbatim', () => {
			const value = valueOf(validateReviewCompositionEmit([fixtureRole()], {
				capabilityRefs: ['cap-fixture-001', 'cap-fixture-002'],
				workflowRefs: [],
				policyRefs: ['pol-fixture-001'],
				evidenceRefs: [],
			}));
			assert.deepEqual(value.capabilityRefs, ['cap-fixture-001', 'cap-fixture-002']);
			assert.deepEqual(value.workflowRefs, []);
			assert.deepEqual(value.policyRefs, ['pol-fixture-001']);
			assert.deepEqual(value.evidenceRefs, []);
		});

		test('a non-array roles carrier is malformed-record', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit('nope', {}));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['roles']);
		});

		test('a non-record refs carrier is malformed-record', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([fixtureRole()], 'nope'));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['refs']);
		});

		test('an unknown refs key is unknown-key', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([fixtureRole()], { bogus: [] }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key']);
			assert.deepEqual(rejections[0].items, ['bogus']);
		});

		test('a non-array family carrier is malformed-record naming the family', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([fixtureRole()], { workflowRefs: 'nope' }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['workflowRefs']);
		});

		test('a non-string family member is malformed-record (the family[i] item)', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([fixtureRole()], { evidenceRefs: ['ev-fixture-001', 123] }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['evidenceRefs[1]']);
		});

		test('duplicate refs are duplicate-ref (the family-prefixed items)', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([fixtureRole()], { workflowRefs: ['wf-1', 'wf-1'], evidenceRefs: ['ev-1', 'ev-1', 'ev-1'] }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['duplicate-ref', 'duplicate-ref']);
			assert.deepEqual(rejections[0].items, ['workflowRefs:wf-1']);
			assert.deepEqual(rejections[1].items, ['evidenceRefs:ev-1']);
		});

		test('empty roles are the empty-roles floor (THE DH-01 FLOOR)', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit([], {}));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['empty-roles']);
			assert.deepEqual(rejections[0].items, ['roles']);
		});

		test('the MAX_ROLES bound at the emit', () => {
			const roles33 = Array.from({ length: 33 }, (_, i) => ({ roleKey: `fixture.role-${String(i + 1).padStart(2, '0')}`, summary: 'the fixture summary' }));
			const rejections = rejectionsOf(validateReviewCompositionEmit(roles33, {}));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['max-roles-exceeded']);
			assert.deepEqual(rejections[0].items, ['33 roles']);
		});

		test('a malformed role entry surfaces with the roles[i] item', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit(['not-a-role'], {}));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-role']);
			assert.deepEqual(rejections[0].items, ['roles[0]']);
		});

		test('multi-offense reports the COMPLETE table in the frozen walk order', () => {
			const rejections = rejectionsOf(validateReviewCompositionEmit('nope', { bogus: 1, workflowRefs: ['wf-1', 'wf-1'] }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record', 'unknown-key', 'duplicate-ref']);
		});

		test('every green emit value passes the REAL validateOnboardingReviewComposition (THE IMPORT LAW cross-check)', () => {
			for (const [roles, refs] of [
				[[fixtureRole()], {}],
				[[fixtureRole(), fixtureRole({ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' })], { capabilityRefs: ['cap-fixture-001'], evidenceRefs: [] }],
			] as [unknown, unknown][]) {
				const value = valueOf(validateReviewCompositionEmit(roles, refs));
				const review = validateOnboardingReviewComposition(value);
				assert.equal(review.ok, true, `the REAL DH-02 validator must pass every emitted composition (refs: ${JSON.stringify(refs)})`);
			}
		});
	});

	suite('the canonical serialization and the fail-closed parse', () => {
		test('the canonical byte pin (the exact fixed-key-order JSON)', () => {
			const bytes = serializeRoleCompositionSession(fixtureSession());
			assert.equal(bytes, '{"sessionId":"flauz:rol:0123456789abcdef","industry":"legal","stage":"composing","roles":[{"roleKey":"fixture.counsel","summary":"the fixture counsel role"}],"history":[{"at":"2026-10-13T00:00:00.000Z","fromStage":null,"toStage":"composing","op":"begin-session","law":"THE FORWARD-ONLY LAW","detail":"fixture begin note"}]}');
		});

		test('double-serialize byte-equality and the round-trip deepEqual', () => {
			const bytes = serializeRoleCompositionSession(fixtureSession());
			assert.equal(serializeRoleCompositionSession(JSON.parse(bytes)), bytes);
			assert.deepEqual(parsedSession(bytes), valueOf(validateRoleCompositionSession(fixtureSession())));
		});

		test('non-string bytes are torn-envelope', () => {
			const rejection = parseRefusal(123);
			assert.equal(rejection.reason, 'torn-envelope');
			assert.match(rejection.detail, /bytes must be a string/);
		});

		test('malformed JSON is malformed-json', () => {
			const rejection = parseRefusal('{not json');
			assert.equal(rejection.reason, 'malformed-json');
			assert.match(rejection.detail, /not valid JSON/);
		});

		test('a missing key is torn-envelope (never a silent partial parse)', () => {
			const rejection = parseRefusal('{"sessionId":"flauz:rol:0123456789abcdef","industry":"legal","stage":"composing","roles":[]}');
			assert.equal(rejection.reason, 'torn-envelope');
			assert.match(rejection.detail, /'history' key is missing/);
		});

		test('unknown keys at the record / role / note level are unknown-key', () => {
			const recordLevel = parseRefusal('{"sessionId":"flauz:rol:0123456789abcdef","industry":"legal","stage":"composing","roles":[],"history":[],"bogus":1}');
			assert.equal(recordLevel.reason, 'unknown-key');
			const roleLevel = parseRefusal('{"sessionId":"flauz:rol:0123456789abcdef","industry":"legal","stage":"composing","roles":[{"roleKey":"a","summary":"b","tools":1}],"history":[]}');
			assert.equal(roleLevel.reason, 'unknown-key');
			assert.match(roleLevel.detail, /roles\[0\]/);
			const noteLevel = parseRefusal('{"sessionId":"flauz:rol:0123456789abcdef","industry":"legal","stage":"composing","roles":[],"history":[{"at":"x","fromStage":null,"toStage":"composing","op":"begin-session","law":"l","detail":"d","bogus":1}]}');
			assert.equal(noteLevel.reason, 'unknown-key');
			assert.match(noteLevel.detail, /history\[0\]/);
		});

		test('an invalid record is invalid-record naming the deep walk\'s first rejection', () => {
			const bytes = serializeRoleCompositionSession(fixtureSession()).replace('"industry":"legal"', '"industry":"fintech"');
			const rejection = parseRefusal(bytes);
			assert.equal(rejection.reason, 'invalid-record');
			assert.match(rejection.detail, /unknown-industry/);
		});

		test('ROLES_PARSE_REJECTION_REASONS pinned (5) and the unknown-contract-version slot never fires on session bytes', () => {
			assert.deepEqual([...ROLES_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
			// THE FIVE-KEY MODEL: the session bytes carry no contractVersion field, so a
			// version field is the unknown-key station (the version law's live station is
			// the kit-layer persistence surfaces).
			const withVersion = { ...fixtureSession(), contractVersion: '1.0.0' } as Record<string, unknown>;
			assert.equal(rejectionsOf(validateRoleCompositionSession(withVersion))[0].reason, 'unknown-key');
		});
	});

	suite('the frozen predicates', () => {
		test('the membership predicates over the closed lists', () => {
			assert.equal(isRoleCompositionRejectionReason('empty-roles'), true);
			assert.equal(isRoleCompositionRejectionReason('NOPE'), false);
			assert.equal(isRoleCompositionStage('composed'), true);
			assert.equal(isRoleCompositionStage('draft'), false);
			assert.equal(isRoleCompositionParseRejectionReason('torn-envelope'), true);
			assert.equal(isRoleCompositionParseRejectionReason('NOPE'), false);
			assert.equal(isRoleCompositionSessionId(FIXTURE_SESSION_ID), true);
		});

		test('isRoleCompositionSession is the deep walk\'s guard', () => {
			assert.equal(isRoleCompositionSession(fixtureSession()), true);
			assert.equal(isRoleCompositionSession(fixtureSession({ industry: 'fintech' })), false);
			assert.equal(isRoleCompositionSession('not-a-session'), false);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in rolesContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/rolesContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
