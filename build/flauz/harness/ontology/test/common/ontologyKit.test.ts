/*
 * DH-004 domain-ontology kit test suite (mocha tdd style, matching
 * build/flauz/harness/roles/test/common/rolesKit.test.ts - the landed
 * DH-003 family precedent - and the DH-001/DH-002 kit batteries
 * before it).
 *
 * Fixture policy: every record id, harness id, industry, term, catalog
 * entry and timestamp below is SYNTHETIC (fixed fixture ISO strings,
 * the 'flauz:ont:<16-hex>' / 'flauz:hrn:<16-hex>' fixture ids,
 * 'fixture.'-prefixed terms, 'cap/wf/pol/ev-fixture-' catalog ids) and
 * is NOT an authority value, NOT credential material, NOT execution
 * material. The kit tests run over an in-memory fs port (the PIN-2
 * sibling precedent's persistence seam, SHARED with the REAL DH-01
 * harness kit in the cross-kit pins) and deterministic test doubles
 * for the clock and the rng (fixed or counter-based - NEVER the
 * random global, never a real clock). The ontology factory consumes
 * exactly ONE clock read and ONE rng read (there is no inner kit -
 * the counter-rng pins below account for them). The in-suite
 * determinism greps pin the shipped modules to law-comment lines only
 * (the banned-global patterns are assembled piecewise so this test
 * source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	HARNESS_ENVELOPE_RELATIVE_PATH,
	HARNESS_LEDGER_RELATIVE_PATH,
	createHarnessKit,
} from '../../../contract/common/domainHarnessKit.js';
import type { HarnessFsPort, HarnessKitOptions } from '../../../contract/common/domainHarnessKit.js';
import { HARNESS_ID_PREFIX } from '../../../contract/common/domainHarnessContract.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	ONBOARDING_CONTRACTS_VERSION,
	ROLES_CONTRACTS_VERSION,
	ONTOLOGY_CONTRACTS_VERSION,
	ONTOLOGY_ENVELOPE_RELATIVE_PATH,
	ONTOLOGY_ENVELOPE_SCHEMA_KEYS,
	ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS,
	ONTOLOGY_KIT_REFUSAL_REASONS,
	ONTOLOGY_LEDGER_LINE_SCHEMA_KEYS,
	ONTOLOGY_LEDGER_RELATIVE_PATH,
	createOntologyKit,
	isOntologyKitRefusalReason,
	loadOntologyKit,
} from '../../common/ontologyKit.js';
import type { OntologyKit, OntologyKitOptions, OntologyKitRefusal } from '../../common/ontologyKit.js';
import { ONTOLOGY_ID_PREFIX, ONTOLOGY_REJECTION_REASONS } from '../../common/ontologyContract.js';
import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION } from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_VERSION } from '../../../roles/common/rolesContract.js';
import type { HarnessCatalogSnapshot } from '../../../contract/common/domainHarnessContract.js';

const FIXTURE_ROOT = '/fixture-root';
const FIXTURE_HEX = '0123456789abcdef';
const FIXTURE_HARNESS_ID = `${HARNESS_ID_PREFIX}${FIXTURE_HEX}`;
const ONT_LEDGER_PATH = `${FIXTURE_ROOT}/${ONTOLOGY_LEDGER_RELATIVE_PATH}`;
const ONT_ENVELOPE_PATH = `${FIXTURE_ROOT}/${ONTOLOGY_ENVELOPE_RELATIVE_PATH}`;
const HRN_LEDGER_PATH = `${FIXTURE_ROOT}/${HARNESS_LEDGER_RELATIVE_PATH}`;
const HRN_ENVELOPE_PATH = `${FIXTURE_ROOT}/${HARNESS_ENVELOPE_RELATIVE_PATH}`;

function fixedClock(): () => string {
	return () => '2026-10-13T00:00:00.000Z';
}

/** The advancing fixture clock (deterministic ISO strings, never a real clock). */
function advancingClock(): { clock: () => string; reads: string[] } {
	const reads: string[] = [];
	const clock = (): string => {
		const read = `2026-10-13T00:00:${String(reads.length + 1).padStart(2, '0')}.000Z`;
		reads.push(read);
		return read;
	};
	return { clock, reads };
}

function fixedRng(hex: string): () => string {
	return () => hex;
}

function counterRng(): () => string {
	let n = 0;
	return () => {
		n += 1;
		return n.toString(16).padStart(16, '0');
	};
}

function fixtureCatalog(): HarnessCatalogSnapshot {
	return {
		capabilities: [{ entryId: 'cap-fixture-001', state: 'approved' }],
		workflowIds: ['wf-fixture-001'],
		policyIds: ['pol-fixture-001'],
		evidenceIds: ['ev-fixture-001'],
	};
}

function fixtureTerm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { term: 'fixture.discovery', definition: 'the fixture discovery term', ...overrides };
}

function fixtureSecondTerm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { term: 'fixture.affidavit', definition: 'the fixture affidavit term', ...overrides };
}

/** The in-memory fs port (the PIN-2 sibling precedent's persistence seam; ENOENT convention; shared with the real DH-01 kit in the cross-kit pins). */
function makeMemoryFs(existing?: Map<string, string>): { files: Map<string, string>; port: HarnessFsPort } {
	const files = existing ?? new Map<string, string>();
	const enoent = (path: string): Error => {
		const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
		(err as NodeJS.ErrnoException).code = 'ENOENT';
		return err;
	};
	const port: HarnessFsPort = {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				throw enoent(path);
			}
			return text;
		},
		async writeFile(path: string, text: string): Promise<void> {
			files.set(path, text);
		},
		async appendFile(path: string, text: string): Promise<void> {
			files.set(path, (files.get(path) ?? '') + text);
		},
		async mkdir(): Promise<void> {},
	};
	return { files, port };
}

/** An fs port whose appendFile refuses (the ledger-append failure seam). */
function appendRefusingFs(files: Map<string, string>): HarnessFsPort {
	return {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
				(err as NodeJS.ErrnoException).code = 'ENOENT';
				throw err;
			}
			return text;
		},
		async writeFile(path: string, text: string): Promise<void> {
			files.set(path, text);
		},
		async appendFile(): Promise<void> {
			throw new Error('fixture port refusal (appendFile)');
		},
		async mkdir(): Promise<void> {},
	};
}

/** An fs port whose writeFile refuses (the envelope-rewrite failure seam). */
function writeRefusingFs(files: Map<string, string>): HarnessFsPort {
	return {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
				(err as NodeJS.ErrnoException).code = 'ENOENT';
				throw err;
			}
			return text;
		},
		async writeFile(): Promise<void> {
			throw new Error('fixture port refusal (writeFile)');
		},
		async appendFile(path: string, text: string): Promise<void> {
			files.set(path, (files.get(path) ?? '') + text);
		},
		async mkdir(): Promise<void> {},
	};
}

function kitOptions(overrides: Record<string, unknown> = {}): unknown {
	return {
		clock: fixedClock(),
		rng: fixedRng(FIXTURE_HEX),
		...overrides,
	};
}

function mustOk<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuse(outcome: { ok: boolean }): OntologyKitRefusal {
	if (!outcome.ok) {
		return (outcome as unknown as { refusal: OntologyKitRefusal }).refusal;
	}
	assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

function mustOkList<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok list outcome, received refusal: ${JSON.stringify(outcome)}`);
}

/** Walks an ontology record to the composed stage (the standard happy-path prefix: two fixture terms, finalized). */
async function composedFixtureRecord(kit: OntologyKit): Promise<string> {
	const begin = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
	const ontologyId = begin.record.ontologyId;
	mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
	mustOk(await kit.addTerm(ontologyId, fixtureSecondTerm()));
	mustOk(await kit.finalizeOntology(ontologyId));
	return ontologyId;
}

function ledgerLineCount(files: Map<string, string>): number {
	const text = files.get(ONT_LEDGER_PATH);
	return text === undefined ? 0 : text.split('\n').filter((line) => line.length > 0).length;
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

suite('DH-004 domain-ontology kit', () => {

	suite('the single-version law (the kit re-carries)', () => {
		test('the kit re-exports equal the contract declarations and the REAL landed modules', () => {
			assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
			assert.equal(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_VERSION);
			assert.equal(ROLES_CONTRACTS_VERSION, REAL_ROLES_VERSION);
		});

		test('ONTOLOGY_KIT_REFUSAL_REASONS is the contract\'s 18 plus the 6 kit extras (pinned)', () => {
			assert.deepEqual([...ONTOLOGY_KIT_REFUSAL_REASONS].slice(0, 18), [...ONTOLOGY_REJECTION_REASONS]);
			assert.deepEqual([...ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS], ['DISPOSED', 'CORRUPT_SEAM', 'E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'ONTOLOGY_IO', 'UNKNOWN_FILTER']);
			assert.equal(ONTOLOGY_KIT_REFUSAL_REASONS.length, 24);
		});

		test('isOntologyKitRefusalReason membership', () => {
			assert.equal(isOntologyKitRefusalReason('empty-terms'), true);
			assert.equal(isOntologyKitRefusalReason('unknown-term'), true);
			assert.equal(isOntologyKitRefusalReason('malformed-harness-id'), true);
			assert.equal(isOntologyKitRefusalReason('E_LEDGER_TORN'), true);
			assert.equal(isOntologyKitRefusalReason('version-mismatch'), true);
			assert.equal(isOntologyKitRefusalReason('NOPE'), false);
		});
	});

	suite('createOntologyKit factory misuse (TypeError, never a typed refusal)', () => {
		test('refuses a non-object options', () => {
			assert.throws(() => createOntologyKit(null as unknown as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit('string' as unknown as OntologyKitOptions), TypeError);
		});

		test('refuses a missing or non-function clock', () => {
			assert.throws(() => createOntologyKit(kitOptions({ clock: undefined }) as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit(kitOptions({ clock: 'not-a-function' }) as OntologyKitOptions), TypeError);
		});

		test('refuses a clock that returns an empty value', () => {
			assert.throws(() => createOntologyKit(kitOptions({ clock: () => '' }) as OntologyKitOptions), TypeError);
		});

		test('refuses a missing or non-function rng', () => {
			assert.throws(() => createOntologyKit(kitOptions({ rng: undefined }) as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit(kitOptions({ rng: 123 }) as OntologyKitOptions), TypeError);
		});

		test('refuses an rng that returns a non-16-hex value', () => {
			assert.throws(() => createOntologyKit(kitOptions({ rng: () => 'short' }) as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit(kitOptions({ rng: () => '0123456789ABCDEF' }) as OntologyKitOptions), TypeError);
		});

		test('refuses fsPort without root and root without fsPort (the DH-01 pair law)', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createOntologyKit(kitOptions({ fsPort: port }) as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit(kitOptions({ root: FIXTURE_ROOT }) as OntologyKitOptions), TypeError);
		});

		test('refuses an fs port missing a method', () => {
			const partial = { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} };
			assert.throws(() => createOntologyKit(kitOptions({ fsPort: partial, root: FIXTURE_ROOT }) as OntologyKitOptions), TypeError);
		});

		test('refuses an empty or non-string root', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createOntologyKit(kitOptions({ fsPort: port, root: '' }) as OntologyKitOptions), TypeError);
			assert.throws(() => createOntologyKit(kitOptions({ fsPort: port, root: 123 }) as OntologyKitOptions), TypeError);
		});

		test('loadOntologyKit requires both fsPort and root (TypeError)', async () => {
			await assert.rejects(() => loadOntologyKit(kitOptions() as OntologyKitOptions), TypeError);
			const { port } = makeMemoryFs();
			await assert.rejects(() => loadOntologyKit(kitOptions({ fsPort: port }) as OntologyKitOptions), TypeError);
			await assert.rejects(() => loadOntologyKit(kitOptions({ root: FIXTURE_ROOT }) as OntologyKitOptions), TypeError);
		});
	});

	suite('the factory seam reads (the exact count: ONE clock read, ONE rng read)', () => {
		test('the factory consumes exactly one rng read (the first beginOntology mints the SECOND counter value)', async () => {
			const kit = createOntologyKit(kitOptions({ rng: counterRng() }) as OntologyKitOptions);
			const first = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(first.record.ontologyId, `${ONTOLOGY_ID_PREFIX}0000000000000002`);
			const second = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'finance'));
			assert.equal(second.record.ontologyId, `${ONTOLOGY_ID_PREFIX}0000000000000003`);
		});

		test('the factory consumes exactly one clock read (the first op lands the SECOND reading)', async () => {
			const { clock, reads } = advancingClock();
			const kit = createOntologyKit(kitOptions({ clock }) as OntologyKitOptions);
			assert.equal(reads.length, 1);
			const begin = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(reads.length, 2);
			assert.equal(begin.record.history[0].at, reads[1]);
		});
	});

	suite('beginOntology (the record mint)', () => {
		test('mints the honest initial record (stage composing, ZERO terms, the bound harnessId, the begin note)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const begin = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(begin.record.ontologyId, `${ONTOLOGY_ID_PREFIX}${FIXTURE_HEX}`);
			assert.equal(begin.record.harnessId, FIXTURE_HARNESS_ID);
			assert.equal(begin.record.industry, 'legal');
			assert.equal(begin.record.stage, 'composing');
			assert.deepEqual(begin.record.terms, []);
			assert.equal(begin.record.history.length, 1);
			assert.equal(begin.record.history[0].op, 'begin-ontology');
			assert.equal(begin.record.history[0].fromStage, null);
			assert.equal(begin.record.history[0].toStage, 'composing');
			assert.equal(begin.record.history[0].law, 'THE FORWARD-ONLY LAW');
		});

		test('harness-id FORM refusals: every malformed class (the REAL DH-01 alphabet import)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			for (const bad of [
				'flauz:ont:0123456789abcdef',
				'flauz:rol:0123456789abcdef',
				'flauz:hrn:0123456789abcde',
				'flauz:hrn:0123456789abcdeff',
				'flauz:hrn:0123456789ABCDEF',
				'hrn:0123456789abcdef',
				'',
				123,
				null,
				undefined,
				{},
			]) {
				const refusal = mustRefuse(await kit.beginOntology(bad, 'legal'));
				assert.equal(refusal.reason, 'malformed-harness-id', `harnessId ${String(bad)} must refuse malformed-harness-id`);
				assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
			}
			const list = mustOkList(await kit.listOntologies());
			assert.deepEqual(list.records, []);
		});

		test('industry membership refusals: every non-member and malformed carrier (the REAL imported list)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			for (const bad of ['fintech', 'space-mining', '', 'LEGAL', 123, null, undefined, {}]) {
				const refusal = mustRefuse(await kit.beginOntology(FIXTURE_HARNESS_ID, bad));
				assert.equal(refusal.reason, 'unknown-industry');
				assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
			}
			const list = mustOkList(await kit.listOntologies());
			assert.deepEqual(list.records, []);
		});

		test('a duplicate minted record id is the typed CORRUPT_SEAM refusal', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const refusal = mustRefuse(await kit.beginOntology(FIXTURE_HARNESS_ID, 'finance'));
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.equal(refusal.law, 'THE DETERMINISM LAW');
			assert.match(refusal.detail, /duplicate record id/);
		});

		test('a corrupt rng mid-op is the typed CORRUPT_SEAM refusal', async () => {
			let calls = 0;
			const rng = (): string => {
				calls += 1;
				return calls === 1 ? FIXTURE_HEX : 'not-hex-anymore';
			};
			const kit = createOntologyKit(kitOptions({ rng }) as OntologyKitOptions);
			const refusal = mustRefuse(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.equal(refusal.law, 'THE DETERMINISM LAW');
			assert.match(refusal.detail, /non-16-hex/);
		});
	});

	suite('addTerm (the terminology grows)', () => {
		test('the green path appends the canonical term and lands the add note', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			const added = mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			assert.deepEqual(added.record.terms, [fixtureTerm()]);
			assert.equal(added.record.stage, 'composing');
			assert.equal(added.record.history.length, 2);
			assert.equal(added.record.history[1].op, 'add-term');
			assert.equal(added.record.history[1].fromStage, 'composing');
			assert.equal(added.record.history[1].toStage, 'composing');
			assert.equal(added.record.history[1].law, 'THE NO-FORK LAW');
		});

		test('payload-walk refusals carry the COMPLETE contract rejection table (never first-only)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			const refusal = mustRefuse(await kit.addTerm(ontologyId, { term: ' padded ', definition: '', tools: 'fixture-tools' }));
			assert.equal(refusal.reason, 'no-fork');
			assert.deepEqual(refusal.items, ['tools']);
			assert.deepEqual((refusal.rejections as unknown as { reason: string }[]).map((rejection) => rejection.reason), ['no-fork', 'invalid-term', 'invalid-definition']);
		});

		test('a non-record and a non-string-carrier term payload refuse (malformed-term)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			assert.equal(mustRefuse(await kit.addTerm(ontologyId, 'not-a-term')).reason, 'malformed-term');
			assert.equal(mustRefuse(await kit.addTerm(ontologyId, { term: 123, definition: 'x' })).reason, 'malformed-term');
		});

		test('a duplicate term is the typed duplicate-term refusal (the record unchanged)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			const before = mustOk(await kit.inspectOntology(ontologyId));
			const refusal = mustRefuse(await kit.addTerm(ontologyId, fixtureTerm()));
			assert.equal(refusal.reason, 'duplicate-term');
			assert.deepEqual(refusal.items, ['fixture.discovery']);
			const after = mustOk(await kit.inspectOntology(ontologyId));
			assert.deepEqual(after.record, before.record);
		});

		test('the MAX_TERMS bound: the 256th term is green, the 257th refuses max-terms-exceeded', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			for (let i = 1; i <= 255; i += 1) {
				mustOk(await kit.addTerm(ontologyId, { term: `fixture.term-${String(i).padStart(3, '0')}`, definition: 'the fixture definition' }));
			}
			const green256 = mustOk(await kit.addTerm(ontologyId, { term: 'fixture.term-256', definition: 'the fixture definition' }));
			assert.equal(green256.record.terms.length, 256);
			const refusal = mustRefuse(await kit.addTerm(ontologyId, { term: 'fixture.term-257', definition: 'the fixture definition' }));
			assert.equal(refusal.reason, 'max-terms-exceeded');
			assert.deepEqual(refusal.items, ['256 terms']);
		});

		test('an unknown record and a malformed id fail closed as unknown-record', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			assert.equal(mustRefuse(await kit.addTerm(`${ONTOLOGY_ID_PREFIX}ffffffffffffffff`, fixtureTerm())).reason, 'unknown-record');
			assert.equal(mustRefuse(await kit.addTerm('not-an-id', fixtureTerm())).reason, 'unknown-record');
			assert.equal(mustRefuse(await kit.addTerm(123, fixtureTerm())).reason, 'unknown-record');
		});

		test('a mutating op on a composed record is the typed stale-stage refusal (THE APPEND-ONLY LINEAGE LAW)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			const before = mustOk(await kit.inspectOntology(ontologyId));
			const refusal = mustRefuse(await kit.addTerm(ontologyId, { term: 'fixture.newcomer', definition: 'the fixture newcomer term' }));
			assert.equal(refusal.reason, 'stale-stage');
			assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
			assert.match(refusal.detail, /APPEND-ONLY LINEAGE/);
			const after = mustOk(await kit.inspectOntology(ontologyId));
			assert.deepEqual(after.record, before.record);
		});
	});

	suite('replaceTermDefinition (the remove+re-add law)', () => {
		test('the green path replaces ONLY the definition (the term is its identity)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await kit.addTerm(ontologyId, fixtureSecondTerm()));
			const replaced = mustOk(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'the revised fixture discovery definition'));
			assert.deepEqual(replaced.record.terms, [
				{ term: 'fixture.discovery', definition: 'the revised fixture discovery definition' },
				fixtureSecondTerm(),
			]);
			assert.equal(replaced.record.history[3].op, 'replace-term-definition');
			assert.equal(replaced.record.history[3].law, 'THE REMOVE+RE-ADD LAW');
		});

		test('an unknown term is the typed unknown-term refusal (a malformed name fails closed as unknown)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			for (const bad of ['fixture.interrogatory', 'not-a-term', '', 123, null]) {
				const refusal = mustRefuse(await kit.replaceTermDefinition(ontologyId, bad, 'a definition'));
				assert.equal(refusal.reason, 'unknown-term', `term ${String(bad)} must refuse unknown-term`);
			}
		});

		test('a definition-law refusal carries the complete walk and leaves the record unchanged', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			const before = mustOk(await kit.inspectOntology(ontologyId));
			const refusal = mustRefuse(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'f'.repeat(301)));
			assert.equal(refusal.reason, 'invalid-definition');
			assert.deepEqual(refusal.items, ['301 chars']);
			const nonString = mustRefuse(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 123));
			assert.equal(nonString.reason, 'malformed-record');
			const after = mustOk(await kit.inspectOntology(ontologyId));
			assert.deepEqual(after.record, before.record);
		});

		test('a replace on a composed record is the typed stale-stage refusal', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			assert.equal(mustRefuse(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'a definition')).reason, 'stale-stage');
		});
	});

	suite('removeTerm (the terminology shrinks)', () => {
		test('the green path removes the term and lands the remove note', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await kit.addTerm(ontologyId, fixtureSecondTerm()));
			const removed = mustOk(await kit.removeTerm(ontologyId, 'fixture.affidavit'));
			assert.deepEqual(removed.record.terms, [fixtureTerm()]);
			assert.equal(removed.record.history[3].op, 'remove-term');
			assert.equal(removed.record.history[3].law, 'THE REMOVE+RE-ADD LAW');
		});

		test('an unknown term is the typed unknown-term refusal', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			assert.equal(mustRefuse(await kit.removeTerm(ontologyId, 'fixture.interrogatory')).reason, 'unknown-term');
			assert.equal(mustRefuse(await kit.removeTerm(ontologyId, 123)).reason, 'unknown-term');
		});

		test('removing the LAST term is LEGAL while composing; the empty-terms floor fires at finalize', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			const emptied = mustOk(await kit.removeTerm(ontologyId, 'fixture.discovery'));
			assert.deepEqual(emptied.record.terms, []);
			const refusal = mustRefuse(await kit.finalizeOntology(ontologyId));
			assert.equal(refusal.reason, 'empty-terms');
			assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
			assert.match(refusal.detail, /fires HERE, never the record shape/);
		});

		test('a remove on a composed record is the typed stale-stage refusal', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			assert.equal(mustRefuse(await kit.removeTerm(ontologyId, 'fixture.discovery')).reason, 'stale-stage');
		});
	});

	suite('finalizeOntology (the freeze)', () => {
		test('the empty-terms floor fires at finalize (never the record shape)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			const refusal = mustRefuse(await kit.finalizeOntology(ontologyId));
			assert.equal(refusal.reason, 'empty-terms');
			assert.deepEqual(refusal.items, ['terms']);
		});

		test('the composing->composed advance lands the finalize note (TERMINAL)', async () => {
			const kit = createOntologyKit(kitOptions({ clock: advancingClock().clock }) as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			const finalized = mustOk(await kit.finalizeOntology(ontologyId));
			assert.equal(finalized.record.stage, 'composed');
			assert.deepEqual(finalized.record.terms, [fixtureTerm()]);
			const note = finalized.record.history[finalized.record.history.length - 1];
			assert.equal(note.op, 'finalize-ontology');
			assert.equal(note.fromStage, 'composing');
			assert.equal(note.toStage, 'composed');
			assert.equal(note.law, 'THE FORWARD-ONLY LAW');
		});

		test('a second finalize is the typed stale-stage refusal (composed is TERMINAL)', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			const refusal = mustRefuse(await kit.finalizeOntology(ontologyId));
			assert.equal(refusal.reason, 'stale-stage');
			assert.deepEqual(refusal.items, ['composed']);
		});

		test('an unknown record fails closed as unknown-record', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			assert.equal(mustRefuse(await kit.finalizeOntology(`${ONTOLOGY_ID_PREFIX}ffffffffffffffff`)).reason, 'unknown-record');
		});
	});

	suite('inspectOntology and listOntologies', () => {
		test('an unknown record and a malformed id fail closed as unknown-record', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			assert.equal(mustRefuse(await kit.inspectOntology(`${ONTOLOGY_ID_PREFIX}ffffffffffffffff`)).reason, 'unknown-record');
			assert.equal(mustRefuse(await kit.inspectOntology('not-an-id')).reason, 'unknown-record');
			assert.equal(mustRefuse(await kit.inspectOntology(null)).reason, 'unknown-record');
		});

		test('the green filters: stage / industry / harnessId', async () => {
			const kit = createOntologyKit(kitOptions({ rng: counterRng(), clock: advancingClock().clock }) as OntologyKitOptions);
			const idA = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(idA, fixtureTerm()));
			mustOk(await kit.finalizeOntology(idA));
			const otherHarnessId = `${HARNESS_ID_PREFIX}ffffffffffffffff`;
			const idB = (mustOk(await kit.beginOntology(otherHarnessId, 'finance'))).record.ontologyId;
			mustOk(await kit.addTerm(idB, fixtureTerm()));
			const composed = mustOkList(await kit.listOntologies({ stage: 'composed' }));
			assert.deepEqual(composed.records.map((record) => record.ontologyId), [idA]);
			const finance = mustOkList(await kit.listOntologies({ industry: 'finance' }));
			assert.deepEqual(finance.records.map((record) => record.ontologyId), [idB]);
			const bound = mustOkList(await kit.listOntologies({ harnessId: FIXTURE_HARNESS_ID }));
			assert.deepEqual(bound.records.map((record) => record.ontologyId), [idA]);
			const both = mustOkList(await kit.listOntologies({ industry: 'legal', stage: 'composed' }));
			assert.deepEqual(both.records.map((record) => record.ontologyId), [idA]);
			const all = mustOkList(await kit.listOntologies());
			assert.deepEqual(all.records.map((record) => record.ontologyId), [idA, idB].sort());
		});

		test('UNKNOWN_FILTER: an unknown field, a non-object filter, and non-member values', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(mustRefuse(await kit.listOntologies('nope')).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listOntologies({ bogus: 1 })).reason, 'UNKNOWN_FILTER');
			assert.deepEqual(mustRefuse(await kit.listOntologies({ bogus: 1 })).items, ['bogus']);
			assert.equal(mustRefuse(await kit.listOntologies({ stage: 'draft' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listOntologies({ industry: 'fintech' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listOntologies({ harnessId: 'flauz:ont:0123456789abcdef' })).reason, 'UNKNOWN_FILTER');
		});
	});

	suite('persistence (the PIN-2 mirror, mirrored EXACTLY)', () => {
		test('the ontology envelope and the append-only ledger land with the first applied op', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(files.has(ONT_LEDGER_PATH), true);
			assert.equal(files.has(ONT_ENVELOPE_PATH), true);
			const ledgerLines = (files.get(ONT_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 1);
			const line = JSON.parse(ledgerLines[0]) as Record<string, unknown>;
			assert.deepEqual(Object.keys(line), [...ONTOLOGY_LEDGER_LINE_SCHEMA_KEYS]);
			assert.equal(line.op, 'begin-ontology');
			assert.equal(line.seq, 1);
			assert.equal(line.ontologyId, `${ONTOLOGY_ID_PREFIX}${FIXTURE_HEX}`);
			assert.equal(line.harnessId, FIXTURE_HARNESS_ID);
			assert.equal(line.fromStage, null);
			assert.equal(line.toStage, 'composing');
			assert.equal(line.payload, 'legal');
			assert.equal(line.contractVersion, ONTOLOGY_CONTRACTS_VERSION);
			const envelope = JSON.parse(files.get(ONT_ENVELOPE_PATH) as string) as Record<string, unknown>;
			assert.deepEqual(Object.keys(envelope), [...ONTOLOGY_ENVELOPE_SCHEMA_KEYS]);
			assert.equal(envelope.contractVersion, ONTOLOGY_CONTRACTS_VERSION);
			assert.equal(envelope.seq, 1);
			assert.equal((envelope.records as unknown[]).length, 1);
		});

		test('the ledger appends one canonical line per applied op (seq == line number; the payload shapes)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await kit.addTerm(ontologyId, fixtureSecondTerm()));
			mustOk(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'the revised fixture discovery definition'));
			mustOk(await kit.removeTerm(ontologyId, 'fixture.affidavit'));
			mustOk(await kit.finalizeOntology(ontologyId));
			const ledgerLines = (files.get(ONT_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 6);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2, 3, 4, 5, 6]);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { op: string }).op), [
				'begin-ontology', 'add-term', 'add-term', 'replace-term-definition', 'remove-term', 'finalize-ontology',
			]);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { law: string }).law), [
				'THE FORWARD-ONLY LAW', 'THE NO-FORK LAW', 'THE NO-FORK LAW', 'THE REMOVE+RE-ADD LAW', 'THE REMOVE+RE-ADD LAW', 'THE FORWARD-ONLY LAW',
			]);
			// the harness link is its own column on EVERY line (the REAL DH-01 id alphabet)
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { harnessId: string }).harnessId), Array.from({ length: 6 }, () => FIXTURE_HARNESS_ID));
			assert.equal((JSON.parse(ledgerLines[0]) as { payload: unknown }).payload, 'legal');
			assert.deepEqual((JSON.parse(ledgerLines[1]) as { payload: unknown }).payload, fixtureTerm());
			assert.deepEqual((JSON.parse(ledgerLines[2]) as { payload: unknown }).payload, fixtureSecondTerm());
			assert.deepEqual((JSON.parse(ledgerLines[3]) as { payload: unknown }).payload, { term: 'fixture.discovery', definition: 'the revised fixture discovery definition' });
			assert.deepEqual((JSON.parse(ledgerLines[4]) as { payload: unknown }).payload, fixtureSecondTerm());
			assert.equal((JSON.parse(ledgerLines[5]) as { payload: unknown }).payload, null);
		});

		test('round-trip: loadOntologyKit replays the identical honest record state', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'the revised fixture discovery definition'));
			mustOk(await kit.finalizeOntology(ontologyId));
			const live = mustOk(await kit.inspectOntology(ontologyId));
			const load = mustOk(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			const reopened = mustOk(await load.kit.inspectOntology(ontologyId));
			assert.deepEqual(reopened.record, live.record);
			assert.equal((files.get(ONT_LEDGER_PATH) as string).endsWith('\n'), true);
		});

		test('restart mid-walk: the reloaded kit continues composing (the seq continues)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OntologyKitOptions);
			const ontologyId = (mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'))).record.ontologyId;
			mustOk(await kit.addTerm(ontologyId, fixtureTerm()));
			const loadOutcome = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(loadOutcome.ok, true);
			const reopened = loadOutcome.ok ? loadOutcome.kit : null;
			assert.notEqual(reopened, null);
			const added = mustOk(await (reopened as OntologyKit).addTerm(ontologyId, fixtureSecondTerm()));
			assert.deepEqual(added.record.terms, [fixtureTerm(), fixtureSecondTerm()]);
			const finalized = mustOk(await (reopened as OntologyKit).finalizeOntology(ontologyId));
			assert.equal(finalized.record.stage, 'composed');
			const ledgerLines = (files.get(ONT_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 4);
			assert.equal((JSON.parse(ledgerLines[3]) as { seq: number }).seq, 4);
		});

		test('the multi-record ledger replays both records (interleaved ops)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: counterRng(), clock: advancingClock().clock }) as OntologyKitOptions);
			const beginA = mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const ontologyIdA = beginA.record.ontologyId;
			const beginB = mustOk(await kit.beginOntology(`${HARNESS_ID_PREFIX}ffffffffffffffff`, 'finance'));
			const ontologyIdB = beginB.record.ontologyId;
			mustOk(await kit.addTerm(ontologyIdA, fixtureTerm()));
			mustOk(await kit.addTerm(ontologyIdB, fixtureSecondTerm()));
			mustOk(await kit.finalizeOntology(ontologyIdA));
			const loadOutcome = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(loadOutcome.ok, true);
			const reopened = loadOutcome.ok ? loadOutcome.kit : null;
			const inspectA = mustOk(await (reopened as OntologyKit).inspectOntology(ontologyIdA));
			const inspectB = mustOk(await (reopened as OntologyKit).inspectOntology(ontologyIdB));
			assert.equal(inspectA.record.stage, 'composed');
			assert.deepEqual(inspectA.record.terms, [fixtureTerm()]);
			assert.equal(inspectB.record.stage, 'composing');
			assert.deepEqual(inspectB.record.terms, [fixtureSecondTerm()]);
			const list = mustOkList(await (reopened as OntologyKit).listOntologies());
			assert.deepEqual(list.records.map((record) => record.ontologyId), [ontologyIdA, ontologyIdB]);
			assert.equal(ledgerLineCount(files), 5);
		});

		test('a fresh kit never appends over an existing ontology ledger (E_LEDGER_TORN)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const second = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: fixedRng('ffffffffffffffff') }) as OntologyKitOptions);
			const refusal = mustRefuse(await second.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /reopen with loadOntologyKit/);
			assert.equal(ledgerLineCount(files), 1);
		});

		test('a torn ontology ledger (a missing trailing newline) fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const torn = (files.get(ONT_LEDGER_PATH) as string).slice(0, -1);
			files.set(ONT_LEDGER_PATH, torn);
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /does not end with a complete line/);
		});

		test('an unparseable or sequence-drifted ontology ledger line fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			files.set(ONT_LEDGER_PATH, '{not json}\n');
			assert.equal(mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions)).reason, 'E_LEDGER_TORN');
			const ontologyId = `${ONTOLOGY_ID_PREFIX}${FIXTURE_HEX}`;
			const lines = [
				'{"seq":1,"at":"2026-10-13T00:00:00.000Z","contractVersion":"1.0.0","op":"begin-ontology","ontologyId":"' + ontologyId + '","harnessId":"' + FIXTURE_HARNESS_ID + '","fromStage":null,"toStage":"composing","law":"THE FORWARD-ONLY LAW","payload":"legal","detail":"fixture"}',
				'{"seq":9,"at":"2026-10-13T00:00:01.000Z","contractVersion":"1.0.0","op":"add-term","ontologyId":"' + ontologyId + '","harnessId":"' + FIXTURE_HARNESS_ID + '","fromStage":"composing","toStage":"composing","law":"THE NO-FORK LAW","payload":{"term":"fixture.discovery","definition":"the fixture discovery term"},"detail":"fixture"}',
			];
			files.set(ONT_LEDGER_PATH, `${lines.join('\n')}\n`);
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /out of order|missing/);
		});

		test('a ledger line with a malformed harness id fails closed with E_LEDGER_TORN (the REAL DH-01 alphabet on every line)', async () => {
			const { files, port } = makeMemoryFs();
			files.set(ONT_LEDGER_PATH, '{"seq":1,"at":"2026-10-13T00:00:00.000Z","contractVersion":"1.0.0","op":"begin-ontology","ontologyId":"' + `${ONTOLOGY_ID_PREFIX}${FIXTURE_HEX}` + '","harnessId":"flauz:ont:0123456789abcdef","fromStage":null,"toStage":"composing","law":"THE FORWARD-ONLY LAW","payload":"legal","detail":"fixture"}\n');
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /malformed harness id/);
		});

		test('a divergent ontology envelope fails closed with E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const envelope = JSON.parse(files.get(ONT_ENVELOPE_PATH) as string) as { records: Record<string, unknown>[] };
			(envelope.records[0] as { stage: string }).stage = 'composed';
			files.set(ONT_ENVELOPE_PATH, JSON.stringify(envelope));
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(refusal.detail, /never silently rebuilt/);
		});

		test('a missing or malformed ontology envelope fails closed with E_ENVELOPE_MISMATCH', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			files.delete(ONT_ENVELOPE_PATH);
			const missing = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(missing.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(missing.detail, /envelope is missing/);
			files.set(ONT_ENVELOPE_PATH, '{not json}');
			assert.equal(mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions)).reason, 'E_ENVELOPE_MISMATCH');
		});

		test('a version-drifted ontology ledger line is the typed version-mismatch (THE SINGLE-VERSION LAW\'s live station)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const lines = (files.get(ONT_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
			parsed.contractVersion = '9.9.9';
			lines[0] = JSON.stringify(parsed);
			files.set(ONT_LEDGER_PATH, `${lines.join('\n')}\n`);
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'version-mismatch');
			assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
			assert.match(refusal.detail, /single-version law/);
		});

		test('a version-drifted ontology envelope is the typed version-mismatch', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const envelope = JSON.parse(files.get(ONT_ENVELOPE_PATH) as string) as Record<string, unknown>;
			files.set(ONT_ENVELOPE_PATH, JSON.stringify({ ...envelope, contractVersion: '9.9.9' }));
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'version-mismatch');
			assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
		});

		test('an envelope ahead of the ledger fails closed with E_LEDGER_TORN (missing ledger lines)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			mustOk(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			const envelope = JSON.parse(files.get(ONT_ENVELOPE_PATH) as string) as Record<string, unknown>;
			files.set(ONT_ENVELOPE_PATH, JSON.stringify({ ...envelope, seq: 9 }));
			const refusal = mustRefuse(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /missing ledger lines/);
		});

		test('a fresh root reopens empty and loadOntologyKit is idempotent (never rewrites the files)', async () => {
			const { files, port } = makeMemoryFs();
			const first = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(first.ok, true);
			assert.deepEqual(mustOkList(await (first.ok ? first.kit : null as unknown as OntologyKit).listOntologies()).records, []);
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			const beforeLedger = files.get(ONT_LEDGER_PATH) as string;
			const beforeEnvelope = files.get(ONT_ENVELOPE_PATH) as string;
			const second = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			const third = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(files.get(ONT_LEDGER_PATH), beforeLedger);
			assert.equal(files.get(ONT_ENVELOPE_PATH), beforeEnvelope);
			const a = mustOk(await (second.ok ? second.kit : null as unknown as OntologyKit).inspectOntology(ontologyId));
			const b = mustOk(await (third.ok ? third.kit : null as unknown as OntologyKit).inspectOntology(ontologyId));
			assert.equal(JSON.stringify(a.record), JSON.stringify(b.record));
		});

		test('a refusing ontology ledger append is the typed ONTOLOGY_IO with NOTHING applied', async () => {
			const { files } = makeMemoryFs();
			const port = appendRefusingFs(files);
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			const refusal = mustRefuse(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(refusal.reason, 'ONTOLOGY_IO');
			assert.match(refusal.detail, /nothing was applied/);
			const list = mustOkList(await kit.listOntologies());
			assert.deepEqual(list.records, []);
			assert.equal(files.has(ONT_LEDGER_PATH), false);
		});

		test('a refusing envelope rewrite is the typed ONTOLOGY_IO disclosing the landed line (a reload fails E_ENVELOPE_MISMATCH)', async () => {
			const { files } = makeMemoryFs();
			const port = writeRefusingFs(files);
			const kit = createOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			const refusal = mustRefuse(await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'));
			assert.equal(refusal.reason, 'ONTOLOGY_IO');
			assert.match(refusal.detail, /landed at seq 1/);
			const list = mustOkList(await kit.listOntologies());
			assert.equal(list.records.length, 1);
			const { port: workingPort } = makeMemoryFs(files);
			const load = await loadOntologyKit(kitOptions({ fsPort: workingPort, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(load.ok, false);
			assert.equal(mustRefuse(load).reason, 'E_ENVELOPE_MISMATCH');
		});

		test('an in-memory kit (no fsPort) never touches a filesystem - the full compose and freeze stay in memory', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			const inspected = mustOk(await kit.inspectOntology(ontologyId));
			assert.deepEqual(inspected.record.terms, [fixtureTerm(), fixtureSecondTerm()]);
			assert.equal(inspected.record.stage, 'composed');
		});
	});

	suite('dispose (the dispose law)', () => {
		test('every operation after dispose rejects with the typed DISPOSED refusal', async () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(kit);
			kit.dispose();
			for (const outcome of [
				await kit.beginOntology(FIXTURE_HARNESS_ID, 'legal'),
				await kit.addTerm(ontologyId, { term: 'fixture.newcomer', definition: 'the fixture newcomer term' }),
				await kit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'a definition'),
				await kit.removeTerm(ontologyId, 'fixture.discovery'),
				await kit.finalizeOntology(ontologyId),
				await kit.inspectOntology(ontologyId),
				await kit.listOntologies(),
			]) {
				assert.equal(mustRefuse(outcome).reason, 'DISPOSED');
			}
		});

		test('dispose is idempotent (a second dispose never throws)', () => {
			const kit = createOntologyKit(kitOptions() as OntologyKitOptions);
			kit.dispose();
			assert.doesNotThrow(() => kit.dispose());
		});
	});

	suite('THE CROSS-KIT INTEGRATION PINS (the wave\'s crown)', () => {
		test('the full journey through the REAL createHarnessKit: mint -> bind -> compose -> finalize; the binding surfaces agree with the minted descriptor', async () => {
			const { files, port } = makeMemoryFs();
			const harnessKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as HarnessKitOptions);
			const minted = mustOk(await harnessKit.mintHarness({
				industry: 'legal',
				workTypes: ['analysis', 'drafting'],
				displayName: 'fixture litigation harness',
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }],
				capabilityRefs: [],
				workflowRefs: [],
				policyRefs: [],
				evidenceRefs: [],
			}));
			const harnessId = minted.record.harnessId;
			const descriptor = minted.record.descriptor;
			assert.equal(harnessId, FIXTURE_HARNESS_ID);
			// the caller's composition law, exercised through the real kits: the ontology
			// binds the minted harness id and carries the SAME industry the descriptor does.
			const ontKit = createOntologyKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as OntologyKitOptions);
			const begin = mustOk(await ontKit.beginOntology(harnessId, descriptor.industry));
			const ontologyId = begin.record.ontologyId;
			assert.equal(begin.record.harnessId, harnessId);
			assert.equal(begin.record.industry, descriptor.industry);
			mustOk(await ontKit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await ontKit.addTerm(ontologyId, fixtureSecondTerm()));
			mustOk(await ontKit.replaceTermDefinition(ontologyId, 'fixture.discovery', 'the revised fixture discovery definition'));
			const finalized = mustOk(await ontKit.finalizeOntology(ontologyId));
			assert.equal(finalized.record.stage, 'composed');
			// the DH-01 envelope's minted descriptor and the ontology envelope's record agree on the binding surfaces
			const harnessEnvelope = JSON.parse(files.get(HRN_ENVELOPE_PATH) as string) as { harnesses: { state: string; descriptor: Record<string, unknown> }[] };
			assert.equal(harnessEnvelope.harnesses[0].descriptor.industry, finalized.record.industry);
			assert.equal(harnessEnvelope.harnesses[0].descriptor.harnessId, finalized.record.harnessId);
			const ontologyEnvelope = JSON.parse(files.get(ONT_ENVELOPE_PATH) as string) as { records: { harnessId: string; industry: string; stage: string }[] };
			assert.equal(ontologyEnvelope.records[0].harnessId, harnessId);
			assert.equal(ontologyEnvelope.records[0].industry, 'legal');
			assert.equal(ontologyEnvelope.records[0].stage, 'composed');
			// the restart replays the bound record byte-identically after the journey
			const load = mustOk(await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions));
			const reopened = mustOk(await load.kit.inspectOntology(ontologyId));
			assert.deepEqual(reopened.record, finalized.record);
		});

		test('THE HONEST BOUNDARY: the layer does NOT enforce the industry AGREEMENT (the caller\'s composition law, never the layer\'s) - disclosed, pinned', async () => {
			const { files, port } = makeMemoryFs();
			const harnessKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as HarnessKitOptions);
			const minted = mustOk(await harnessKit.mintHarness({
				industry: 'legal',
				workTypes: ['analysis'],
				displayName: 'fixture litigation harness',
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }],
				capabilityRefs: [],
				workflowRefs: [],
				policyRefs: [],
				evidenceRefs: [],
			}));
			// a DISAGREEING industry is admitted by the layer: the agreement binding is the
			// caller's composition law (documented in the README's honest-gap section); the
			// layer enforces the FORM of the harness id and the membership of the industry -
			// never the cross-record agreement.
			const ontKit = createOntologyKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as OntologyKitOptions);
			const begin = mustOk(await ontKit.beginOntology(minted.record.harnessId, 'finance'));
			assert.equal(begin.record.industry, 'finance');
			assert.notEqual(begin.record.industry, minted.record.descriptor.industry);
		});

		test('the two families\' ledgers coexist under the shared root (the ontology replay stays green after the journey)', async () => {
			const { files, port } = makeMemoryFs();
			const harnessKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as HarnessKitOptions);
			const minted = mustOk(await harnessKit.mintHarness({
				industry: 'legal',
				workTypes: ['analysis'],
				displayName: 'fixture litigation harness',
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }],
				capabilityRefs: [],
				workflowRefs: [],
				policyRefs: [],
				evidenceRefs: [],
			}));
			const ontKit = createOntologyKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as OntologyKitOptions);
			const ontologyId = await composedFixtureRecord(ontKit);
			assert.equal(files.has(HRN_LEDGER_PATH), true);
			assert.equal(files.has(ONT_LEDGER_PATH), true);
			const loadOutcome = await loadOntologyKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OntologyKitOptions);
			assert.equal(loadOutcome.ok, true);
			const reopened = loadOutcome.ok ? loadOutcome.kit : null;
			const inspect = mustOk(await (reopened as OntologyKit).inspectOntology(ontologyId));
			assert.equal(inspect.record.stage, 'composed');
			assert.deepEqual(inspect.record.terms, [fixtureTerm(), fixtureSecondTerm()]);
			assert.equal(inspect.record.harnessId, minted.record.harnessId);
			const list = mustOkList(await (reopened as OntologyKit).listOntologies());
			assert.equal(list.records.length, 1);
		});

		test('the record\'s harness link resolves against the REAL DH-01 record (the minted id, the descriptor\'s industry)', async () => {
			const { port } = makeMemoryFs();
			const harnessKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as HarnessKitOptions);
			const minted = mustOk(await harnessKit.mintHarness({
				industry: 'healthcare',
				workTypes: ['review'],
				displayName: 'fixture clinical harness',
				roles: [{ roleKey: 'fixture.clinician', summary: 'the fixture clinician role' }],
				capabilityRefs: [],
				workflowRefs: [],
				policyRefs: [],
				evidenceRefs: [],
			}));
			const ontKit = createOntologyKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as OntologyKitOptions);
			const ontologyId = (mustOk(await ontKit.beginOntology(minted.record.harnessId, 'healthcare'))).record.ontologyId;
			mustOk(await ontKit.addTerm(ontologyId, fixtureTerm()));
			mustOk(await ontKit.finalizeOntology(ontologyId));
			// the binding surfaces, cross-checked through the REAL DH-01 kit's own inspect
			const harness = mustOk(await harnessKit.inspectHarness(minted.record.harnessId));
			const ontology = mustOk(await ontKit.inspectOntology(ontologyId));
			assert.equal(ontology.record.harnessId, harness.record.harnessId);
			assert.equal(ontology.record.industry, harness.record.descriptor.industry);
			assert.equal(ontology.record.industry, 'healthcare');
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in ontologyKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/ontologyKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in ontologyContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/ontologyContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
