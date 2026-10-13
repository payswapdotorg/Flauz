/*
 * DH-004 domain-ontology contract test suite (mocha tdd style,
 * matching build/flauz/harness/roles/test/common/rolesContract.test.ts
 * - the landed DH-003 family precedent - and the DH-001/DH-002
 * batteries before it).
 *
 * Fixture policy: every record id, harness id, industry, term and
 * timestamp below is SYNTHETIC (fixed fixture ISO strings, the
 * 'flauz:ont:<16-hex>' / 'flauz:hrn:<16-hex>' fixture ids,
 * 'fixture.'-prefixed terms) and is NOT an authority value, NOT
 * credential material, NOT execution material. The frozen-vocabulary
 * cross-pins import the REAL DH-01 contract module, the REAL DH-02
 * onboarding contract module and the REAL DH-03 roles contract module
 * and pin referential identity and verbatim equality - THE IMPORT LAW
 * as a test. The in-suite determinism greps pin the shipped module to
 * law-comment lines only (the banned-global patterns are assembled
 * piecewise so this test source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION,
	HARNESS_ID_PREFIX as REAL_HARNESS_ID_PREFIX,
	HARNESS_INDUSTRIES as REAL_INDUSTRIES,
	isHarnessId as REAL_IS_HARNESS_ID,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_VERSION } from '../../../roles/common/rolesContract.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	DEFINITION_MAX_LENGTH,
	HARNESS_ID_PREFIX,
	HARNESS_INDUSTRIES,
	MAX_TERMS,
	ONBOARDING_CONTRACTS_VERSION,
	ONTOLOGY_FORWARD_TRANSITIONS,
	ONTOLOGY_ID_PREFIX,
	ONTOLOGY_NOTE_SCHEMA_KEYS,
	ONTOLOGY_OP_NAMES,
	ONTOLOGY_PARSE_REJECTION_REASONS,
	ONTOLOGY_RECORD_SCHEMA_KEYS,
	ONTOLOGY_REJECTION_REASONS,
	ONTOLOGY_STAGES,
	ROLES_CONTRACTS_VERSION,
	TERM_MAX_LENGTH,
	ONTOLOGY_CONTRACTS_VERSION,
	canTransitionOntologyStage,
	isHarnessId,
	isOntologyId,
	isOntologyParseRejectionReason,
	isOntologyRejectionReason,
	isOntologyRecord,
	isOntologyStage,
	parseOntologyRecord,
	serializeOntologyRecord,
	validateOntologyRecord,
	validateTermDefinition,
	validateTermEntry,
} from '../../common/ontologyContract.js';
import type {
	OntologyParseRejection,
	OntologyRejection,
	OntologyStageVerdict,
	OntologyValidationOutcome,
	DomainOntologyRecord,
} from '../../common/ontologyContract.js';

const FIXTURE_HEX = '0123456789abcdef';
const FIXTURE_ONTOLOGY_ID = `${ONTOLOGY_ID_PREFIX}${FIXTURE_HEX}`;
const FIXTURE_HARNESS_ID = `${HARNESS_ID_PREFIX}${FIXTURE_HEX}`;

function fixtureNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		at: '2026-10-13T00:00:00.000Z',
		fromStage: null,
		toStage: 'composing',
		op: 'begin-ontology',
		law: 'THE FORWARD-ONLY LAW',
		detail: 'fixture begin note',
		...overrides,
	};
}

function fixtureTerm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { term: 'fixture.discovery', definition: 'the fixture discovery term', ...overrides };
}

function fixtureSecondTerm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { term: 'fixture.affidavit', definition: 'the fixture affidavit term', ...overrides };
}

function fixtureRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		ontologyId: FIXTURE_ONTOLOGY_ID,
		harnessId: FIXTURE_HARNESS_ID,
		industry: 'legal',
		stage: 'composing',
		terms: [fixtureTerm()],
		history: [fixtureNote()],
		...overrides,
	};
}

function valueOf<T>(outcome: OntologyValidationOutcome<T>): T {
	if (outcome.ok) {
		return outcome.value;
	}
	assert.fail(`expected ok, received rejections: ${JSON.stringify(outcome.rejections)}`);
}

function rejectionsOf<T>(outcome: OntologyValidationOutcome<T>): readonly OntologyRejection[] {
	if (!outcome.ok) {
		return outcome.rejections;
	}
	assert.fail(`expected a refusal, received ok: ${JSON.stringify(outcome.value)}`);
}

function refusedVerdict(from: unknown, to: unknown): Extract<OntologyStageVerdict, { ok: false }> {
	const verdict = canTransitionOntologyStage(from, to);
	if (!verdict.ok) {
		return verdict;
	}
	assert.fail(`expected an ILLEGAL_TRANSITION verdict, received ok: ${JSON.stringify(verdict)}`);
}

function parseRefusal(bytes: unknown): OntologyParseRejection {
	const outcome = parseOntologyRecord(bytes);
	if (!outcome.ok) {
		return outcome.rejection;
	}
	assert.fail(`expected a parse refusal, received ok: ${JSON.stringify(outcome.record)}`);
}

function parsedRecord(bytes: string): DomainOntologyRecord {
	const outcome = parseOntologyRecord(bytes);
	if (outcome.ok) {
		return outcome.record;
	}
	assert.fail(`expected a parsed record, received refusal: ${JSON.stringify(outcome.rejection)}`);
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

suite('DH-004 domain-ontology contract', () => {

	suite('the single-version law (the re-export chain)', () => {
		test('ONTOLOGY_CONTRACTS_VERSION is 1.0.0, declared ONCE here', () => {
			assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
		});

		test('DOMAIN_HARNESS_CONTRACTS_VERSION is re-carried from the REAL DH-01 module', () => {
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
		});

		test('ONBOARDING_CONTRACTS_VERSION is re-carried from the REAL DH-02 module', () => {
			assert.equal(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_VERSION);
			assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
		});

		test('ROLES_CONTRACTS_VERSION is re-carried from the REAL DH-03 module', () => {
			assert.equal(ROLES_CONTRACTS_VERSION, REAL_ROLES_VERSION);
			assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
		});

		test('ONTOLOGY_REJECTION_REASONS pinned verbatim: the WO sixteen-station prefix plus the two appended stations', () => {
			assert.deepEqual([...ONTOLOGY_REJECTION_REASONS], [
				'malformed-record', 'unknown-key', 'missing-key', 'malformed-harness-id',
				'unknown-industry', 'malformed-term', 'no-fork', 'invalid-term',
				'invalid-definition', 'duplicate-term', 'max-terms-exceeded', 'empty-terms',
				'unknown-record', 'version-mismatch', 'unknown-stage', 'malformed-history',
				'stale-stage', 'unknown-term',
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

		test('the harness-id alphabet is the REAL DH-01 binding (referential identity) and the form is pinned', () => {
			assert.equal(isHarnessId, REAL_IS_HARNESS_ID);
			assert.equal(HARNESS_ID_PREFIX, REAL_HARNESS_ID_PREFIX);
			assert.equal(HARNESS_ID_PREFIX, 'flauz:hrn:');
			assert.equal(isHarnessId(FIXTURE_HARNESS_ID), true);
			assert.equal(isHarnessId('flauz:ont:0123456789abcdef'), false);
			assert.equal(isHarnessId('flauz:hrn:0123456789abcde'), false);
			assert.equal(isHarnessId('flauz:hrn:0123456789ABCDEF'), false);
			assert.equal(isHarnessId(123), false);
		});

		test('the family\'s own frozen constants pinned (stages, whitelist, prefix, bounds, schema keys, op names)', () => {
			assert.deepEqual([...ONTOLOGY_STAGES], ['composing', 'composed']);
			assert.deepEqual([...ONTOLOGY_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
			assert.equal(ONTOLOGY_ID_PREFIX, 'flauz:ont:');
			assert.equal(TERM_MAX_LENGTH, 64);
			assert.equal(DEFINITION_MAX_LENGTH, 300);
			assert.equal(MAX_TERMS, 256);
			assert.deepEqual([...ONTOLOGY_RECORD_SCHEMA_KEYS], ['ontologyId', 'harnessId', 'industry', 'stage', 'terms', 'history']);
			assert.deepEqual([...ONTOLOGY_NOTE_SCHEMA_KEYS], ['at', 'fromStage', 'toStage', 'op', 'law', 'detail']);
			assert.deepEqual([...ONTOLOGY_OP_NAMES], ['begin-ontology', 'add-term', 'replace-term-definition', 'remove-term', 'finalize-ontology']);
		});
	});

	suite('the stage machine (forward-only; composed is TERMINAL)', () => {
		test('composing->composed is the only whitelisted row (row 1)', () => {
			const verdict = canTransitionOntologyStage('composing', 'composed');
			assert.deepEqual(verdict, { ok: true, from: 'composing', to: 'composed', row: 1 });
		});

		test('composed->anything is TERMINAL (THE APPEND-ONLY LINEAGE LAW: the DH-012 Lab specialization mints NEW records)', () => {
			const self = refusedVerdict('composed', 'composed');
			assert.equal(self.reason, 'ILLEGAL_TRANSITION');
			assert.equal(self.whitelistRow, null);
			assert.equal(self.expectedTo, null);
			assert.match(self.detail, /TERMINAL/);
			const back = refusedVerdict('composed', 'composing');
			assert.equal(back.whitelistRow, null);
			assert.equal(back.expectedTo, null);
			assert.match(back.detail, /APPEND-ONLY LINEAGE/);
		});

		test('composing->composing (the self-loop) is refused naming the whitelisted successor', () => {
			const verdict = refusedVerdict('composing', 'composing');
			assert.equal(verdict.whitelistRow, 1);
			assert.equal(verdict.expectedTo, 'composed');
			assert.match(verdict.detail, /whitelisted forward transition/);
		});

		test('unknown stages and non-strings are refused (the frozen stage vocabulary)', () => {
			const unknownFrom = refusedVerdict('draft', 'composed');
			assert.match(unknownFrom.detail, /frozen ONTOLOGY_STAGES list/);
			const unknownTo = refusedVerdict('composing', 'finalized');
			assert.match(unknownTo.detail, /frozen ONTOLOGY_STAGES list/);
			const nonString = refusedVerdict(null, 'composed');
			assert.match(nonString.detail, /frozen ONTOLOGY_STAGES list/);
		});
	});

	suite('the id alphabet', () => {
		test('the green flauz:ont:<16-hex> form', () => {
			assert.equal(isOntologyId(FIXTURE_ONTOLOGY_ID), true);
			assert.equal(isOntologyId(`${ONTOLOGY_ID_PREFIX}ffffffffffffffff`), true);
		});

		test('the refusal forms (wrong prefix, wrong length, uppercase, non-string)', () => {
			assert.equal(isOntologyId('flauz:hrn:0123456789abcdef'), false);
			assert.equal(isOntologyId('flauz:onb:0123456789abcdef'), false);
			assert.equal(isOntologyId('flauz:rol:0123456789abcdef'), false);
			assert.equal(isOntologyId(`${ONTOLOGY_ID_PREFIX}0123456789abcde`), false);
			assert.equal(isOntologyId(`${ONTOLOGY_ID_PREFIX}0123456789ABCDEF`), false);
			assert.equal(isOntologyId(`${ONTOLOGY_ID_PREFIX}0123456789abcdeff`), false);
			assert.equal(isOntologyId(''), false);
			assert.equal(isOntologyId(123), false);
			assert.equal(isOntologyId(null), false);
		});
	});

	suite('validateTermEntry (the single-term station walk)', () => {
		test('the green path returns the canonical { term, definition } copy', () => {
			const value = valueOf(validateTermEntry(fixtureTerm()));
			assert.deepEqual(value, { term: 'fixture.discovery', definition: 'the fixture discovery term' });
			assert.deepEqual(Object.keys(value), ['term', 'definition']);
		});

		test('a non-record entry is the malformed-term rejection', () => {
			for (const bad of ['not-a-term', 123, null]) {
				const rejections = rejectionsOf(validateTermEntry(bad));
				assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-term']);
			}
		});

		test('non-string carriers are malformed-term naming the carrier', () => {
			const term = rejectionsOf(validateTermEntry({ term: 123, definition: 'x' }));
			assert.deepEqual(term.map((rejection) => rejection.reason), ['malformed-term']);
			assert.deepEqual(term[0].items, ['term']);
			const definition = rejectionsOf(validateTermEntry({ term: 'fixture.discovery', definition: 123 }));
			assert.deepEqual(definition[0].items, ['definition']);
		});

		test('an extra key is the no-fork rejection (THE NO-FORK LAW\'s term station)', () => {
			const rejections = rejectionsOf(validateTermEntry(fixtureTerm({ tools: 'fixture-tools' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork']);
			assert.equal(rejections[0].law, 'THE NO-FORK LAW');
			assert.deepEqual(rejections[0].items, ['tools']);
		});

		test('a DH-01 forbidden-family key is the same no-fork station', () => {
			const rejections = rejectionsOf(validateTermEntry(fixtureTerm({ command: 'fixture-command' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork']);
			assert.deepEqual(rejections[0].items, ['command']);
		});

		test('the term bounds: empty and over-length (65 chars) are invalid-term', () => {
			const empty = rejectionsOf(validateTermEntry(fixtureTerm({ term: '' })));
			assert.deepEqual(empty.map((rejection) => rejection.reason), ['invalid-term']);
			assert.deepEqual(empty[0].items, ['empty']);
			const overLength = rejectionsOf(validateTermEntry(fixtureTerm({ term: 'f'.repeat(65) })));
			assert.deepEqual(overLength[0].items, ['65 chars']);
		});

		test('the term whitespace padding is invalid-term', () => {
			const padded = rejectionsOf(validateTermEntry(fixtureTerm({ term: ' fixture.discovery' })));
			assert.deepEqual(padded.map((rejection) => rejection.reason), ['invalid-term']);
			assert.deepEqual(padded[0].items, ['leading/trailing whitespace']);
			const trailing = rejectionsOf(validateTermEntry(fixtureTerm({ term: 'fixture.discovery ' })));
			assert.deepEqual(trailing[0].items, ['leading/trailing whitespace']);
		});

		test('the term control characters are invalid-term (U+XXXX items)', () => {
			const rejections = rejectionsOf(validateTermEntry(fixtureTerm({ term: 'fixture\u0007discovery' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-term']);
			assert.deepEqual(rejections[0].items, ['U+0007']);
		});

		test('the definition bounds: empty and over-length (301 chars) are invalid-definition', () => {
			const empty = rejectionsOf(validateTermEntry(fixtureTerm({ definition: '' })));
			assert.deepEqual(empty.map((rejection) => rejection.reason), ['invalid-definition']);
			assert.deepEqual(empty[0].items, ['empty']);
			const overLength = rejectionsOf(validateTermEntry(fixtureTerm({ definition: 'f'.repeat(301) })));
			assert.deepEqual(overLength[0].items, ['301 chars']);
		});

		test('the definition control characters are invalid-definition', () => {
			const rejections = rejectionsOf(validateTermEntry(fixtureTerm({ definition: 'the fixture\u009Fdiscovery term' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-definition']);
			assert.deepEqual(rejections[0].items, ['U+009F']);
		});

		test('multi-offense reports the COMPLETE table in the frozen walk order', () => {
			const rejections = rejectionsOf(validateTermEntry({ term: ' padded ', definition: '', tools: 'fixture-tools' }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['no-fork', 'invalid-term', 'invalid-definition']);
			assert.deepEqual(rejections[0].items, ['tools']);
			assert.deepEqual(rejections[1].items, ['leading/trailing whitespace']);
			assert.deepEqual(rejections[2].items, ['empty']);
		});
	});

	suite('validateTermDefinition (the definition station walk)', () => {
		test('the green path carries the definition string', () => {
			assert.equal(valueOf(validateTermDefinition('the fixture discovery term')), 'the fixture discovery term');
		});

		test('a non-string definition is malformed-record naming the carrier', () => {
			const rejections = rejectionsOf(validateTermDefinition(123));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(rejections[0].items, ['definition']);
		});

		test('the bounds violations (empty, over-length) are invalid-definition', () => {
			assert.deepEqual(rejectionsOf(validateTermDefinition('')).map((rejection) => rejection.reason), ['invalid-definition']);
			assert.deepEqual(rejectionsOf(validateTermDefinition('f'.repeat(301)))[0].items, ['301 chars']);
			assert.equal(valueOf(validateTermDefinition('f'.repeat(300))).length, 300);
		});

		test('the definition control characters are invalid-definition', () => {
			const rejections = rejectionsOf(validateTermDefinition('the fixture\u0007discovery term'));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-definition']);
			assert.deepEqual(rejections[0].items, ['U+0007']);
		});

		test('a padded definition is LEGAL (only the term carries the no-padding law)', () => {
			assert.equal(valueOf(validateTermDefinition(' a padded definition ')), ' a padded definition ');
		});
	});

	suite('validateOntologyRecord (the deep six-key walk)', () => {
		test('the green minimal record returns the canonical copy', () => {
			const value = valueOf(validateOntologyRecord(fixtureRecord()));
			assert.deepEqual(value, {
				ontologyId: FIXTURE_ONTOLOGY_ID,
				harnessId: FIXTURE_HARNESS_ID,
				industry: 'legal',
				stage: 'composing',
				terms: [{ term: 'fixture.discovery', definition: 'the fixture discovery term' }],
				history: [{ at: '2026-10-13T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-ontology', law: 'THE FORWARD-ONLY LAW', detail: 'fixture begin note' }],
			});
		});

		test('a non-record is malformed-record', () => {
			for (const bad of ['not-a-record', 123, null, undefined]) {
				const rejections = rejectionsOf(validateOntologyRecord(bad));
				assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-record']);
			}
		});

		test('an unknown key is unknown-key', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ bogus: 1 })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key']);
			assert.deepEqual(rejections[0].items, ['bogus']);
		});

		test('a missing key is missing-key', () => {
			const candidate = fixtureRecord() as Record<string, unknown>;
			delete candidate.stage;
			const rejections = rejectionsOf(validateOntologyRecord(candidate));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['missing-key']);
			assert.deepEqual(rejections[0].items, ['stage']);
		});

		test('a contractVersion key is unknown-key (THE SIX-KEY MODEL: no version field)', () => {
			const rejections = rejectionsOf(validateOntologyRecord({ ...fixtureRecord(), contractVersion: '1.0.0' }));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key']);
			assert.deepEqual(rejections[0].items, ['contractVersion']);
		});

		test('a malformed harnessId is malformed-harness-id (the REAL DH-01 alphabet import)', () => {
			for (const bad of ['flauz:ont:0123456789abcdef', 'flauz:hrn:0123456789abcde', 'flauz:hrn:0123456789ABCDEF', '', 123, null]) {
				const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ harnessId: bad })));
				assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-harness-id'], `harnessId ${String(bad)} must refuse malformed-harness-id`);
			}
		});

		test('a non-member industry is unknown-industry (the REAL imported list)', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ industry: 'fintech' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-industry']);
			assert.equal(rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(rejections[0].items, ['fintech']);
		});

		test('non-array carriers (terms / history) are malformed-record', () => {
			const terms = rejectionsOf(validateOntologyRecord(fixtureRecord({ terms: 'nope' })));
			assert.deepEqual(terms.map((rejection) => rejection.reason), ['malformed-record']);
			assert.deepEqual(terms[0].items, ['terms']);
			const history = rejectionsOf(validateOntologyRecord(fixtureRecord({ history: 'nope' })));
			assert.deepEqual(history[0].items, ['history']);
		});

		test('a non-record term entry is malformed-term (the terms[i] item)', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ terms: ['not-a-term'] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-term']);
			assert.deepEqual(rejections[0].items, ['terms[0]']);
		});

		test('term-entry law violations surface with the terms[i]: item prefix', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ terms: [fixtureTerm({ term: ' padded ' })] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['invalid-term']);
			assert.deepEqual(rejections[0].items, ['terms[0]:leading/trailing whitespace']);
		});

		test('duplicate terms are duplicate-term', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ terms: [fixtureTerm(), fixtureTerm()] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['duplicate-term']);
			assert.deepEqual(rejections[0].items, ['fixture.discovery']);
		});

		test('the MAX_TERMS bound: 256 terms green, 257 terms max-terms-exceeded', () => {
			const terms256 = Array.from({ length: 256 }, (_, i) => ({ term: `fixture.term-${String(i + 1).padStart(3, '0')}`, definition: 'the fixture definition' }));
			assert.equal(validateOntologyRecord(fixtureRecord({ terms: terms256 })).ok, true);
			const terms257 = [...terms256, { term: 'fixture.term-257', definition: 'the fixture definition' }];
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ terms: terms257 })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['max-terms-exceeded']);
			assert.deepEqual(rejections[0].items, ['257 terms']);
		});

		test('a malformed ontologyId is unknown-record', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ ontologyId: 'flauz:hrn:0123456789abcdef' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-record']);
		});

		test('a non-member stage is unknown-stage', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ stage: 'draft' })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-stage']);
		});

		test('a malformed history note is malformed-history', () => {
			const rejections = rejectionsOf(validateOntologyRecord(fixtureRecord({ history: [fixtureNote({ op: 'bogus-op' })] })));
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['malformed-history']);
			assert.deepEqual(rejections[0].items, ['history[0]']);
		});

		test('empty terms are LEGAL in the record shape (the floor fires at finalize)', () => {
			assert.equal(validateOntologyRecord(fixtureRecord({ terms: [] })).ok, true);
		});

		test('multi-offense reports the COMPLETE table in the frozen walk order', () => {
			const candidate = { harnessId: 'flauz:ont:0123456789abcdef', industry: 'fintech', stage: 'draft', contractVersion: '1.0.0', terms: [], history: [] };
			const rejections = rejectionsOf(validateOntologyRecord(candidate));
			// the absent-key discipline: an absent ontologyId is the missing-key station only -
			// the DH-01 law: an absent key NEVER produces a structural/field rejection.
			assert.deepEqual(rejections.map((rejection) => rejection.reason), ['unknown-key', 'missing-key', 'malformed-harness-id', 'unknown-industry', 'unknown-stage']);
		});
	});

	suite('the canonical serialization and the fail-closed parse', () => {
		test('the canonical byte pin (the exact fixed-key-order JSON)', () => {
			const bytes = serializeOntologyRecord(fixtureRecord());
			assert.equal(bytes, '{"ontologyId":"flauz:ont:0123456789abcdef","harnessId":"flauz:hrn:0123456789abcdef","industry":"legal","stage":"composing","terms":[{"term":"fixture.discovery","definition":"the fixture discovery term"}],"history":[{"at":"2026-10-13T00:00:00.000Z","fromStage":null,"toStage":"composing","op":"begin-ontology","law":"THE FORWARD-ONLY LAW","detail":"fixture begin note"}]}');
		});

		test('double-serialize byte-equality and the round-trip deepEqual', () => {
			const bytes = serializeOntologyRecord(fixtureRecord());
			assert.equal(serializeOntologyRecord(JSON.parse(bytes)), bytes);
			assert.deepEqual(parsedRecord(bytes), valueOf(validateOntologyRecord(fixtureRecord())));
		});

		test('a malformed record never gets canonical bytes (TypeError)', () => {
			assert.throws(() => serializeOntologyRecord(fixtureRecord({ industry: 'fintech' })), TypeError);
			assert.throws(() => serializeOntologyRecord('not-a-record'), TypeError);
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
			const rejection = parseRefusal('{"ontologyId":"flauz:ont:0123456789abcdef","harnessId":"flauz:hrn:0123456789abcdef","industry":"legal","stage":"composing","terms":[]}');
			assert.equal(rejection.reason, 'torn-envelope');
			assert.match(rejection.detail, /'history' key is missing/);
		});

		test('unknown keys at the record / term / note level are unknown-key', () => {
			const recordLevel = parseRefusal('{"ontologyId":"flauz:ont:0123456789abcdef","harnessId":"flauz:hrn:0123456789abcdef","industry":"legal","stage":"composing","terms":[],"history":[],"bogus":1}');
			assert.equal(recordLevel.reason, 'unknown-key');
			const termLevel = parseRefusal('{"ontologyId":"flauz:ont:0123456789abcdef","harnessId":"flauz:hrn:0123456789abcdef","industry":"legal","stage":"composing","terms":[{"term":"a","definition":"b","tools":1}],"history":[]}');
			assert.equal(termLevel.reason, 'unknown-key');
			assert.match(termLevel.detail, /terms\[0\]/);
			const noteLevel = parseRefusal('{"ontologyId":"flauz:ont:0123456789abcdef","harnessId":"flauz:hrn:0123456789abcdef","industry":"legal","stage":"composing","terms":[],"history":[{"at":"x","fromStage":null,"toStage":"composing","op":"begin-ontology","law":"l","detail":"d","bogus":1}]}');
			assert.equal(noteLevel.reason, 'unknown-key');
			assert.match(noteLevel.detail, /history\[0\]/);
		});

		test('an invalid record is invalid-record naming the deep walk\'s first rejection', () => {
			const bytes = serializeOntologyRecord(fixtureRecord()).replace('"industry":"legal"', '"industry":"fintech"');
			const rejection = parseRefusal(bytes);
			assert.equal(rejection.reason, 'invalid-record');
			assert.match(rejection.detail, /unknown-industry/);
		});

		test('ONTOLOGY_PARSE_REJECTION_REASONS pinned (5) and the unknown-contract-version slot never fires on record bytes', () => {
			assert.deepEqual([...ONTOLOGY_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
			// THE SIX-KEY MODEL: the record bytes carry no contractVersion field, so a
			// version field is the unknown-key station (the version law's live station is
			// the kit-layer persistence surfaces).
			const withVersion = { ...fixtureRecord(), contractVersion: '1.0.0' } as Record<string, unknown>;
			assert.equal(rejectionsOf(validateOntologyRecord(withVersion))[0].reason, 'unknown-key');
		});
	});

	suite('the frozen predicates', () => {
		test('the membership predicates over the closed lists', () => {
			assert.equal(isOntologyRejectionReason('empty-terms'), true);
			assert.equal(isOntologyRejectionReason('stale-stage'), true);
			assert.equal(isOntologyRejectionReason('unknown-term'), true);
			assert.equal(isOntologyRejectionReason('NOPE'), false);
			assert.equal(isOntologyStage('composed'), true);
			assert.equal(isOntologyStage('draft'), false);
			assert.equal(isOntologyParseRejectionReason('torn-envelope'), true);
			assert.equal(isOntologyParseRejectionReason('NOPE'), false);
			assert.equal(isOntologyId(FIXTURE_ONTOLOGY_ID), true);
		});

		test('isOntologyRecord is the deep walk\'s guard', () => {
			assert.equal(isOntologyRecord(fixtureRecord()), true);
			assert.equal(isOntologyRecord(fixtureRecord({ industry: 'fintech' })), false);
			assert.equal(isOntologyRecord(fixtureRecord({ harnessId: 'flauz:ont:0123456789abcdef' })), false);
			assert.equal(isOntologyRecord('not-a-record'), false);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in ontologyContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/ontologyContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
