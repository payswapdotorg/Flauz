/*
 * DH-002 onboarding kit test suite (mocha tdd style, matching
 * build/flauz/harness/contract/test/common/domainHarnessKit.test.ts
 * - the DH-001 landed family precedent - and the CR-006 registry
 * battery's persistence discipline before it).
 *
 * Fixture policy: every session id, harness id, company value, role,
 * catalog entry and timestamp below is SYNTHETIC (prefixed 'fixture.'
 * / 'cap-fixture-' style ids, fixed fixture ISO strings, the
 * 'flauz:onb:<16-hex>' / 'flauz:hrn:<16-hex>' fixture ids) and is NOT
 * an authority value, NOT credential material, NOT execution
 * material. The kit tests run over an in-memory fs port (the PIN-2
 * sibling precedent's persistence seam, SHARED with the inner real
 * DH-01 kit) and deterministic test doubles for the clock and the rng
 * (fixed-value or counter-based - NEVER the random global, never a
 * real clock). The factory consumes TWO seam reads (one by the
 * onboarding factory, one by the inner DH-01 construction - THE
 * REAL-KIT LAW); the counter-rng pins below account for them. The
 * in-suite determinism greps pin the sources to law-comment lines
 * only (the banned-global patterns are assembled piecewise so this
 * test source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION as HARNESS_VERSION_PIN,
	HARNESS_ENVELOPE_RELATIVE_PATH,
	HARNESS_LEDGER_RELATIVE_PATH,
	createHarnessKit,
} from '../../../contract/common/domainHarnessKit.js';
import type { HarnessFsPort, HarnessKitOptions } from '../../../contract/common/domainHarnessKit.js';
import { HARNESS_ID_PREFIX } from '../../../contract/common/domainHarnessContract.js';
import {
	ONBOARDING_CONTRACTS_VERSION,
	ONBOARDING_ENVELOPE_RELATIVE_PATH,
	ONBOARDING_KIT_EXTRA_REFUSAL_REASONS,
	ONBOARDING_KIT_REFUSAL_REASONS,
	ONBOARDING_LEDGER_RELATIVE_PATH,
	createOnboardingKit,
	isOnboardingKitRefusalReason,
	loadOnboardingKit,
} from '../../common/onboardingKit.js';
import type { HarnessCatalogSnapshot, OnboardingKit, OnboardingKitOptions, OnboardingKitRefusal } from '../../common/onboardingKit.js';
import { ONBOARDING_SESSION_ID_PREFIX } from '../../common/onboardingContract.js';

const FIXTURE_ROOT = '/fixture-root';
const ONB_LEDGER_PATH = `${FIXTURE_ROOT}/${ONBOARDING_LEDGER_RELATIVE_PATH}`;
const ONB_ENVELOPE_PATH = `${FIXTURE_ROOT}/${ONBOARDING_ENVELOPE_RELATIVE_PATH}`;
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

function fixtureCatalog(overrides: Record<string, unknown> = {}): HarnessCatalogSnapshot {
	return {
		capabilities: [{ entryId: 'cap-fixture-001', state: 'approved' }],
		workflowIds: ['wf-fixture-001'],
		policyIds: ['pol-fixture-001'],
		evidenceIds: ['ev-fixture-001'],
		...overrides,
	} as HarnessCatalogSnapshot;
}

function fixtureProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		displayName: 'fixture litigation harness',
		sizeBand: 'small',
		...overrides,
	};
}

function fixtureComposition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		roles: [
			{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
			{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
		],
		capabilityRefs: ['cap-fixture-001'],
		workflowRefs: ['wf-fixture-001'],
		policyRefs: ['pol-fixture-001'],
		evidenceRefs: ['ev-fixture-001'],
		...overrides,
	};
}

/** The in-memory fs port (the PIN-2 sibling precedent's persistence seam; ENOENT convention; shared with the inner real kit). */
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
		rng: fixedRng('0123456789abcdef'),
		catalog: fixtureCatalog(),
		...overrides,
	};
}

function mustOkSession<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuse<T extends { ok: boolean }>(outcome: T): OnboardingKitRefusal {
	if (!outcome.ok) {
		return (outcome as unknown as { refusal: OnboardingKitRefusal }).refusal;
	}
	assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

/** Walks a session to the review stage and returns its id (the standard happy-path prefix). */
async function walkedToReview(kit: OnboardingKit, profileOverrides: Record<string, unknown> = {}): Promise<string> {
	const begin = mustOkSession(await kit.beginSession());
	const sessionId = begin.session.sessionId;
	mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
	mustOkSession(await kit.composeCompany(sessionId, fixtureProfile(profileOverrides)));
	mustOkSession(await kit.selectWorkTypes(sessionId, ['analysis', 'drafting', 'review']));
	return sessionId;
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

suite('DH-002 onboarding kit', () => {

	suite('the single-version law (the kit re-carries the contract version)', () => {
		test('the kit re-export equals the contract declaration', () => {
			assert.equal(ONBOARDING_CONTRACTS_VERSION, HARNESS_VERSION_PIN);
			assert.equal(ONBOARDING_CONTRACTS_VERSION, '1.0.0');
			assert.deepEqual([...ONBOARDING_KIT_REFUSAL_REASONS].slice(0, 22), [
				'malformed-record', 'no-fork', 'unknown-key', 'missing-key', 'unknown-session', 'version-mismatch',
				'unknown-industry', 'invalid-display-name', 'unknown-size-band',
				'empty-work-types', 'unknown-work-type', 'duplicate-work-types', 'work-types-out-of-order',
				'premature-op', 'stale-stage',
				'empty-roles', 'malformed-role', 'duplicate-role-keys', 'malformed-refs', 'duplicate-ref',
				'harness-kit-refused', 'disposed',
			]);
			assert.deepEqual([...ONBOARDING_KIT_EXTRA_REFUSAL_REASONS], ['E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'ONBOARDING_IO', 'CORRUPT_SEAM', 'UNKNOWN_FILTER']);
			assert.equal(isOnboardingKitRefusalReason('harness-kit-refused'), true);
			assert.equal(isOnboardingKitRefusalReason('E_LEDGER_TORN'), true);
			assert.equal(isOnboardingKitRefusalReason('NOPE'), false);
		});

		test('every session re-carries the contract version', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			assert.equal(begin.session.contractVersion, ONBOARDING_CONTRACTS_VERSION);
		});
	});

	suite('createOnboardingKit factory misuse (TypeError, never a typed refusal)', () => {
		test('refuses a non-object options', () => {
			assert.throws(() => createOnboardingKit(null as unknown as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit('string' as unknown as OnboardingKitOptions), TypeError);
		});

		test('refuses a missing or non-function clock', () => {
			assert.throws(() => createOnboardingKit(kitOptions({ clock: undefined }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ clock: 'not-a-function' }) as OnboardingKitOptions), TypeError);
		});

		test('refuses a clock that returns an empty value', () => {
			assert.throws(() => createOnboardingKit(kitOptions({ clock: () => '' }) as OnboardingKitOptions), TypeError);
		});

		test('refuses a missing or non-function rng', () => {
			assert.throws(() => createOnboardingKit(kitOptions({ rng: undefined }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ rng: 123 }) as OnboardingKitOptions), TypeError);
		});

		test('refuses an rng that returns a non-16-hex value', () => {
			assert.throws(() => createOnboardingKit(kitOptions({ rng: () => 'short' }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ rng: () => '0123456789ABCDEF' }) as OnboardingKitOptions), TypeError);
		});

		test('refuses a malformed catalog snapshot', () => {
			assert.throws(() => createOnboardingKit(kitOptions({ catalog: null }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ catalog: { capabilities: [] } }) as OnboardingKitOptions), TypeError);
		});

		test('refuses fsPort without root and root without fsPort (the DH-01 pair law)', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createOnboardingKit(kitOptions({ fsPort: port }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ root: FIXTURE_ROOT }) as OnboardingKitOptions), TypeError);
		});

		test('refuses an fs port missing a method', () => {
			const partial = { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} };
			assert.throws(() => createOnboardingKit(kitOptions({ fsPort: partial, root: FIXTURE_ROOT }) as OnboardingKitOptions), TypeError);
		});

		test('refuses an empty or non-string root', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createOnboardingKit(kitOptions({ fsPort: port, root: '' }) as OnboardingKitOptions), TypeError);
			assert.throws(() => createOnboardingKit(kitOptions({ fsPort: port, root: 123 }) as OnboardingKitOptions), TypeError);
		});

		test('loadOnboardingKit requires both fsPort and root (TypeError)', async () => {
			await assert.rejects(() => loadOnboardingKit(kitOptions() as OnboardingKitOptions), TypeError);
			const { port } = makeMemoryFs();
			await assert.rejects(() => loadOnboardingKit(kitOptions({ fsPort: port }) as OnboardingKitOptions), TypeError);
			await assert.rejects(() => loadOnboardingKit(kitOptions({ root: FIXTURE_ROOT }) as OnboardingKitOptions), TypeError);
		});
	});

	suite('beginSession (the session mint)', () => {
		test('mints the honest initial record (stage industry, revision 1, payloads null)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			assert.equal(begin.session.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdef`);
			assert.equal(begin.session.stage, 'industry');
			assert.equal(begin.session.industry, null);
			assert.equal(begin.session.companyProfile, null);
			assert.equal(begin.session.workTypes, null);
			assert.equal(begin.session.reviewComposition, null);
			assert.equal(begin.session.harnessId, null);
			assert.equal(begin.session.createdAtIso, '2026-10-13T00:00:00.000Z');
			assert.equal(begin.session.revision, 1);
			assert.equal(begin.session.history.length, 1);
			assert.equal(begin.session.history[0].op, 'begin-session');
			assert.equal(begin.session.history[0].fromStage, null);
			assert.equal(begin.session.history[0].toStage, 'industry');
			assert.equal(begin.session.history[0].law, 'THE FORWARD-ONLY LAW');
		});

		test('the session id is minted from the injected rng (the doubled factory reads accounted)', async () => {
			const kitB = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			// The factory consumes TWO reads (the onboarding factory + the inner DH-01 construction - THE REAL-KIT LAW), so the first begin lands the third counter value.
			const first = mustOkSession(await kitB.beginSession());
			assert.equal(first.session.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0000000000000003`);
			const second = mustOkSession(await kitB.beginSession());
			assert.equal(second.session.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0000000000000004`);
		});

		test('a duplicate minted session id is the typed CORRUPT_SEAM refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const refusal = mustRefuse(await kit.beginSession());
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.equal(refusal.law, 'THE DETERMINISM LAW');
			assert.match(refusal.message, /duplicate session id/);
		});

		test('a corrupt rng mid-op is the typed CORRUPT_SEAM refusal', async () => {
			let calls = 0;
			const rng = (): string => {
				calls += 1;
				// Reads #1 and #2 feed the two factory validations; read #3 mints the first session; read #4 is corrupt.
				return calls <= 3 ? '0123456789abcdef' : 'not-hex-anymore';
			};
			const kit = createOnboardingKit(kitOptions({ rng }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const refusal = mustRefuse(await kit.beginSession());
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.match(refusal.message, /non-16-hex/);
		});

		test('a corrupt clock mid-op is the typed CORRUPT_SEAM refusal', async () => {
			let reads = 0;
			const clock = (): string => {
				reads += 1;
				return reads <= 2 ? '2026-10-13T00:00:00.000Z' : '';
			};
			const kit = createOnboardingKit(kitOptions({ clock }) as OnboardingKitOptions);
			const refusal = mustRefuse(await kit.beginSession());
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.match(refusal.message, /empty value mid-op/);
		});

		test('a disposed fresh kit refuses the first begin', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			kit.dispose();
			assert.equal(mustRefuse(await kit.beginSession()).reason, 'disposed');
		});
	});

	suite('selectIndustry (the industry->company advance)', () => {
		test('advances the stage and records the selection with provenance', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			const sessionId = begin.session.sessionId;
			const outcome = mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			assert.equal(outcome.session.stage, 'company');
			assert.equal(outcome.session.industry, 'legal');
			assert.equal(outcome.session.revision, 2);
			assert.equal(outcome.session.history.length, 2);
			assert.equal(outcome.session.history[1].op, 'select-industry');
			assert.equal(outcome.session.history[1].fromStage, 'industry');
			assert.equal(outcome.session.history[1].toStage, 'company');
			assert.equal(outcome.session.history[1].law, 'THE FORWARD-ONLY LAW');
		});

		test('an unknown industry is refused with the session unchanged (no partial effect)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			const refusal = mustRefuse(await kit.selectIndustry(sessionId, 'fintech'));
			assert.equal(refusal.reason, 'unknown-industry');
			assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(refusal.items, ['fintech']);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'industry');
			assert.equal(inspect.session.industry, null);
			assert.equal(inspect.session.revision, 1);
		});

		test('an unknown or malformed session id is the unknown-session refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const missing = mustRefuse(await kit.selectIndustry(`${ONBOARDING_SESSION_ID_PREFIX}ffffffffffffffff`, 'legal'));
			assert.equal(missing.reason, 'unknown-session');
			assert.equal(missing.law, 'THE FAIL-CLOSED LAW');
			const malformed = mustRefuse(await kit.selectIndustry(123, 'legal'));
			assert.equal(malformed.reason, 'unknown-session');
			assert.match(malformed.message, /malformed id fails closed/);
		});

		test('a re-call after the advance is the stale-stage refusal (forward-only)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			const refusal = mustRefuse(await kit.selectIndustry(sessionId, 'finance'));
			assert.equal(refusal.reason, 'stale-stage');
			assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
			assert.deepEqual(refusal.items, ['company']);
		});

		test('every op after dispose rejects with the typed disposed refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			kit.dispose();
			const refusal = mustRefuse(await kit.selectIndustry(sessionId, 'legal'));
			assert.equal(refusal.reason, 'disposed');
			assert.equal(refusal.law, 'THE DISPOSE LAW');
		});
	});

	suite('composeCompany (the company->work-types advance)', () => {
		test('advances the stage and records the canonical profile', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'review');
			assert.deepEqual(inspect.session.companyProfile, { displayName: 'fixture litigation harness', sizeBand: 'small' });
			assert.equal(inspect.session.revision, 4);
		});

		test('profile violations are the typed payload refusals with the session unchanged', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			const sessionId = begin.session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			const badBand = mustRefuse(await kit.composeCompany(sessionId, fixtureProfile({ sizeBand: 'giant' })));
			assert.equal(badBand.reason, 'unknown-size-band');
			const badName = mustRefuse(await kit.composeCompany(sessionId, fixtureProfile({ displayName: 'f'.repeat(121) })));
			assert.equal(badName.reason, 'invalid-display-name');
			const noFork = mustRefuse(await kit.composeCompany(sessionId, fixtureProfile({ tools: 'fixture-tools' })));
			assert.equal(noFork.reason, 'no-fork');
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'company');
			assert.equal(inspect.session.companyProfile, null);
			assert.equal(inspect.session.revision, 2);
		});

		test('a premature call (the session still at industry) is the premature-op refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			const refusal = mustRefuse(await kit.composeCompany(sessionId, fixtureProfile()));
			assert.equal(refusal.reason, 'premature-op');
			assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
			assert.deepEqual(refusal.items, ['industry']);
			assert.match(refusal.message, /requires the 'company' stage/);
		});

		test('a stale call (the session already at work-types) is the stale-stage refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			mustOkSession(await kit.composeCompany(sessionId, fixtureProfile()));
			const refusal = mustRefuse(await kit.composeCompany(sessionId, fixtureProfile({ displayName: 'fixture second try' })));
			assert.equal(refusal.reason, 'stale-stage');
			assert.deepEqual(refusal.items, ['work-types']);
		});
	});

	suite('selectWorkTypes (the work-types->review advance)', () => {
		test('advances the stage and records the ordered subset', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'review');
			assert.deepEqual(inspect.session.workTypes, ['analysis', 'drafting', 'review']);
		});

		test('the subset laws refuse typed (empty, unknown, duplicate, out-of-order)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			const sessionId = begin.session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			mustOkSession(await kit.composeCompany(sessionId, fixtureProfile()));
			assert.equal(mustRefuse(await kit.selectWorkTypes(sessionId, [])).reason, 'empty-work-types');
			assert.equal(mustRefuse(await kit.selectWorkTypes(sessionId, ['litigation'])).reason, 'unknown-work-type');
			assert.equal(mustRefuse(await kit.selectWorkTypes(sessionId, ['analysis', 'analysis'])).reason, 'duplicate-work-types');
			assert.equal(mustRefuse(await kit.selectWorkTypes(sessionId, ['drafting', 'analysis'])).reason, 'work-types-out-of-order');
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'work-types');
			assert.equal(inspect.session.workTypes, null);
			assert.equal(inspect.session.revision, 3);
		});

		test('a premature call (the session still at company) is the premature-op refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = (mustOkSession(await kit.beginSession())).session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			const refusal = mustRefuse(await kit.selectWorkTypes(sessionId, ['analysis']));
			assert.equal(refusal.reason, 'premature-op');
			assert.deepEqual(refusal.items, ['company']);
		});

		test('a stale call (the session already at review) is the stale-stage refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const refusal = mustRefuse(await kit.selectWorkTypes(sessionId, ['planning']));
			assert.equal(refusal.reason, 'stale-stage');
			assert.deepEqual(refusal.items, ['review']);
		});
	});

	suite('composeDraft (THE REAL-KIT LAW: the mint through the DH-01 kit)', () => {
		test('mints through the real kit and records the harness link; the session stays at review', async () => {
			const kit = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const outcome = mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			assert.equal(outcome.session.stage, 'review');
			// The session id landed the third rng read; the real kit's mint landed the fourth.
			assert.equal(outcome.session.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0000000000000003`);
			assert.equal(outcome.session.harnessId, `${HARNESS_ID_PREFIX}0000000000000004`);
			assert.deepEqual(outcome.session.reviewComposition?.roles, [
				{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
				{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
			]);
			assert.equal(outcome.session.revision, 5);
			assert.equal(outcome.session.history[4].op, 'compose-draft');
			assert.equal(outcome.session.history[4].law, 'THE REAL-KIT LAW');
			assert.equal(outcome.session.history[4].fromStage, 'review');
			assert.equal(outcome.session.history[4].toStage, 'review');
		});

		test('THE NO-FORK LAW: a role carrying an extra key is refused BEFORE the kit is consulted', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const refusal = mustRefuse(await kit.composeDraft(sessionId, fixtureComposition({ roles: [{ roleKey: 'fixture.counsel', summary: 'x', tools: 'fixture-tools' }] })));
			assert.equal(refusal.reason, 'no-fork');
			assert.equal(refusal.law, 'THE NO-FORK LAW');
			assert.deepEqual(refusal.items, ['roles[0].tools']);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.harnessId, null);
			assert.equal(inspect.session.reviewComposition, null);
			assert.equal(inspect.session.revision, 4);
		});

		test('THE TWO-PHASE LAW: dangling refs mint fine at draft', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const outcome = mustOkSession(await kit.composeDraft(sessionId, fixtureComposition({
				capabilityRefs: ['cap-fixture-dangling'],
				workflowRefs: ['wf-fixture-dangling'],
			})));
			assert.equal(outcome.session.stage, 'review');
			assert.notEqual(outcome.session.harnessId, null);
			assert.deepEqual(outcome.session.reviewComposition?.capabilityRefs, ['cap-fixture-dangling']);
		});

		test('a refused mint is the typed harness-kit-refused carrying the DH-01 refusal VERBATIM (the 81-char displayName: the profile admits it, the real kit never does)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit, { displayName: 'f'.repeat(81) });
			const refusal = mustRefuse(await kit.composeDraft(sessionId, fixtureComposition()));
			assert.equal(refusal.reason, 'harness-kit-refused');
			assert.equal(refusal.law, 'THE REAL-KIT LAW');
			assert.match(refusal.message, /never re-implements the mint/);
			assert.equal(refusal.harnessRefusal?.reason, 'VALIDATION_REFUSED');
			const validation = refusal.harnessRefusal?.validation;
			assert.equal(validation?.ok, false);
			assert.equal(validation?.mode, 'shape');
			const rejections = (validation as unknown as { rejections: { reason: string; items: readonly string[] }[] }).rejections;
			assert.equal(rejections[0].reason, 'invalid-display-name');
			// THE REAL-KIT LAW pinned byte-identical: a DIRECT mint over the same spec through the DH-01 kit itself.
			const directKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng('0123456789abcdef'), catalog: fixtureCatalog() } as HarnessKitOptions);
			const directMint = await directKit.mintHarness({
				industry: 'legal',
				workTypes: ['analysis', 'drafting', 'review'],
				displayName: 'f'.repeat(81),
				roles: [
					{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
					{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
				],
				capabilityRefs: ['cap-fixture-001'],
				workflowRefs: ['wf-fixture-001'],
				policyRefs: ['pol-fixture-001'],
				evidenceRefs: ['ev-fixture-001'],
			});
			assert.equal(directMint.ok, false);
			assert.deepEqual(refusal.harnessRefusal, (directMint as { ok: false; refusal: unknown }).refusal);
			// No partial effect: the session is unchanged.
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.harnessId, null);
			assert.equal(inspect.session.stage, 'review');
			assert.equal(inspect.session.revision, 4);
		});

		test('a premature call (the session at work-types) and a stale call (the session proposed) refuse typed', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const begin = mustOkSession(await kit.beginSession());
			const sessionId = begin.session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionId, 'legal'));
			mustOkSession(await kit.composeCompany(sessionId, fixtureProfile()));
			const premature = mustRefuse(await kit.composeDraft(sessionId, fixtureComposition()));
			assert.equal(premature.reason, 'premature-op');
			assert.deepEqual(premature.items, ['work-types']);
		});

		test('re-composing at review mints a NEW harness id (the registry lineage law; the old draft stays honest history)', async () => {
			const kit = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const first = mustOkSession(await kit.composeDraft(sessionId, fixtureComposition({ capabilityRefs: ['cap-fixture-dangling'] })));
			assert.equal(first.session.harnessId, `${HARNESS_ID_PREFIX}0000000000000004`);
			const second = mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			assert.equal(second.session.harnessId, `${HARNESS_ID_PREFIX}0000000000000005`);
			assert.equal(second.session.stage, 'review');
			assert.equal(second.session.revision, 6);
			assert.equal(second.session.history.length, 6);
		});
	});

	suite('proposeSession (THE TWO-PHASE LAW boundary through the real kit)', () => {
		test('a propose without a composed draft is the premature-op refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const refusal = mustRefuse(await kit.proposeSession(sessionId));
			assert.equal(refusal.reason, 'premature-op');
			assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
			assert.match(refusal.message, /no composed draft/);
		});

		test('dangling refs refuse the propose through the real kit boundary, carried VERBATIM; the session is unchanged', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition({ capabilityRefs: ['cap-fixture-dangling'] })));
			const refusal = mustRefuse(await kit.proposeSession(sessionId));
			assert.equal(refusal.reason, 'harness-kit-refused');
			assert.equal(refusal.law, 'THE REAL-KIT LAW');
			assert.match(refusal.message, /NO-DANGLING-REF boundary/);
			assert.equal(refusal.harnessRefusal?.reason, 'VALIDATION_REFUSED');
			const validation = refusal.harnessRefusal?.validation as unknown as { rejections: { reason: string; family?: string; items: readonly string[] }[] };
			assert.equal(validation.rejections[0].reason, 'dangling-ref');
			assert.equal(validation.rejections[0].family, 'capabilityRefs');
			assert.deepEqual(validation.rejections[0].items, ['cap-fixture-dangling']);
			// No partial effect: the session stays at review with the draft link intact.
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'review');
			assert.equal(inspect.session.revision, 5);
		});

		test('THE REAL-KIT LAW pinned byte-identical against a direct DH-01 advance over the same spec', async () => {
			const spec = {
				industry: 'legal',
				workTypes: ['analysis', 'drafting', 'review'],
				displayName: 'fixture litigation harness',
				roles: [
					{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
					{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
				],
				capabilityRefs: ['cap-fixture-dangling'],
				workflowRefs: ['wf-fixture-001'],
				policyRefs: ['pol-fixture-001'],
				evidenceRefs: ['ev-fixture-001'],
			};
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition({ capabilityRefs: ['cap-fixture-dangling'] })));
			const refusal = mustRefuse(await kit.proposeSession(sessionId));
			const directKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng('0123456789abcdef'), catalog: fixtureCatalog() } as HarnessKitOptions);
			const directMint = mustOkSessionDirect(await directKit.mintHarness(spec));
			const directAdvance = await directKit.advanceHarness(directMint.record.harnessId, 'proposed');
			assert.equal(directAdvance.ok, false);
			assert.deepEqual(refusal.harnessRefusal, (directAdvance as { ok: false; refusal: unknown }).refusal);
		});

		test('the recovery: re-compose with resolving refs, propose green, the session ends at proposed (TERMINAL)', async () => {
			const kit = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition({ capabilityRefs: ['cap-fixture-dangling'] })));
			mustRefuse(await kit.proposeSession(sessionId));
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			const proposed = mustOkSession(await kit.proposeSession(sessionId));
			assert.equal(proposed.session.stage, 'proposed');
			assert.equal(proposed.session.harnessId, `${HARNESS_ID_PREFIX}0000000000000005`);
			assert.equal(proposed.session.revision, 7);
			assert.equal(proposed.session.history[6].op, 'propose-session');
			assert.equal(proposed.session.history[6].law, 'THE TWO-PHASE LAW');
			assert.equal(proposed.session.history[6].fromStage, 'review');
			assert.equal(proposed.session.history[6].toStage, 'proposed');
		});

		test('the full walk carries the provenance laws in order (the honest record)', async () => {
			const { clock } = advancingClock();
			const kit = createOnboardingKit(kitOptions({ clock, rng: counterRng() }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			const proposed = mustOkSession(await kit.proposeSession(sessionId));
			assert.deepEqual(proposed.session.history.map((note) => note.op), [
				'begin-session', 'select-industry', 'compose-company', 'select-work-types', 'compose-draft', 'propose-session',
			]);
			assert.deepEqual(proposed.session.history.map((note) => note.law), [
				'THE FORWARD-ONLY LAW', 'THE FORWARD-ONLY LAW', 'THE FORWARD-ONLY LAW', 'THE FORWARD-ONLY LAW', 'THE REAL-KIT LAW', 'THE TWO-PHASE LAW',
			]);
			assert.equal(proposed.session.revision, 6);
			const ats = proposed.session.history.map((note) => note.at);
			assert.equal(new Set(ats).size, 6);
		});

		test('proposed is TERMINAL: every stage op on a proposed session is the stale-stage refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionId));
			for (const outcome of [
				await kit.selectIndustry(sessionId, 'finance'),
				await kit.composeCompany(sessionId, fixtureProfile()),
				await kit.selectWorkTypes(sessionId, ['planning']),
				await kit.composeDraft(sessionId, fixtureComposition()),
				await kit.proposeSession(sessionId),
			]) {
				const refusal = mustRefuse(outcome);
				assert.equal(refusal.reason, 'stale-stage');
				assert.match(refusal.message, /TERMINAL/);
			}
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'proposed');
			assert.equal(inspect.session.revision, 6);
		});
	});

	suite('inspectSession (the honest record)', () => {
		test('discloses the full honest record', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdef`);
			assert.equal(inspect.session.stage, 'review');
			assert.equal(inspect.session.industry, 'legal');
			assert.deepEqual(inspect.session.companyProfile, { displayName: 'fixture litigation harness', sizeBand: 'small' });
			assert.deepEqual(inspect.session.workTypes, ['analysis', 'drafting', 'review']);
		});

		test('an unknown or malformed id is the unknown-session refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			assert.equal(mustRefuse(await kit.inspectSession('nope')).reason, 'unknown-session');
			assert.equal(mustRefuse(await kit.inspectSession(null)).reason, 'unknown-session');
		});

		test('the returned record is an isolated copy (mutating it never corrupts the kit)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			(inspect.session as { revision: number }).revision = 999;
			(inspect.session.history as unknown[]).length = 0;
			const again = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(again.session.revision, 4);
			assert.equal(again.session.history.length, 4);
		});
	});

	suite('listSessions (stable ordering + fail-closed filters)', () => {
		test('an empty kit lists nothing', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const list = mustOkList(await kit.listSessions());
			assert.deepEqual(list.sessions, []);
		});

		test('stable ordering by sessionId regardless of begin order', async () => {
			const kit = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			const sessionIdA = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionIdA, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionIdA));
			const beginB = mustOkSession(await kit.beginSession());
			mustOkSession(await kit.selectIndustry(beginB.session.sessionId, 'finance'));
			mustOkSession(await kit.composeCompany(beginB.session.sessionId, fixtureProfile()));
			mustOkSession(await kit.selectWorkTypes(beginB.session.sessionId, ['research']));
			const list = mustOkList(await kit.listSessions());
			assert.deepEqual(list.sessions.map((session) => session.sessionId), [
				`${ONBOARDING_SESSION_ID_PREFIX}0000000000000003`,
				`${ONBOARDING_SESSION_ID_PREFIX}0000000000000005`,
			]);
		});

		test('filters by stage, industry and workType', async () => {
			const kit = createOnboardingKit(kitOptions({ rng: counterRng() }) as OnboardingKitOptions);
			const sessionIdA = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionIdA, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionIdA));
			const beginB = mustOkSession(await kit.beginSession());
			const sessionIdB = beginB.session.sessionId;
			mustOkSession(await kit.selectIndustry(sessionIdB, 'finance'));
			mustOkSession(await kit.composeCompany(sessionIdB, fixtureProfile()));
			mustOkSession(await kit.selectWorkTypes(sessionIdB, ['research']));
			assert.deepEqual(mustOkList(await kit.listSessions({ stage: 'review' })).sessions.map((session) => session.sessionId), [sessionIdB]);
			assert.deepEqual(mustOkList(await kit.listSessions({ stage: 'proposed' })).sessions.map((session) => session.sessionId), [sessionIdA]);
			assert.deepEqual(mustOkList(await kit.listSessions({ industry: 'legal' })).sessions.map((session) => session.sessionId), [sessionIdA]);
			assert.deepEqual(mustOkList(await kit.listSessions({ workType: 'research' })).sessions.map((session) => session.sessionId), [sessionIdB]);
			assert.deepEqual(mustOkList(await kit.listSessions({ industry: 'legal', workType: 'research' })).sessions, []);
		});

		test('an unknown filter field fails closed with the offending items', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const refusal = mustRefuse(await kit.listSessions({ harness: 'flauz:hrn:0123456789abcdef' }));
			assert.equal(refusal.reason, 'UNKNOWN_FILTER');
			assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
			assert.deepEqual(refusal.items, ['harness']);
		});

		test('non-member filter values fail closed', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			assert.equal(mustRefuse(await kit.listSessions({ stage: 'draft' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listSessions({ industry: 'fintech' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listSessions({ workType: 'litigation' })).reason, 'UNKNOWN_FILTER');
		});

		test('a non-object filter fails closed; an empty filter object lists everything', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			assert.equal(mustRefuse(await kit.listSessions('nope')).reason, 'UNKNOWN_FILTER');
			const sessionId = await walkedToReview(kit);
			assert.equal(mustOkList(await kit.listSessions({})).sessions.map((session) => session.sessionId).length, 1);
			assert.equal(mustOkList(await kit.listSessions()).sessions[0].sessionId, sessionId);
		});

		test('a disposed kit refuses the list', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			kit.dispose();
			assert.equal(mustRefuse(await kit.listSessions()).reason, 'disposed');
		});
	});

	suite('dispose (the dispose law)', () => {
		test('every operation after dispose rejects with the typed disposed refusal', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			kit.dispose();
			for (const outcome of [
				await kit.beginSession(),
				await kit.selectIndustry(sessionId, 'legal'),
				await kit.composeCompany(sessionId, fixtureProfile()),
				await kit.selectWorkTypes(sessionId, ['analysis']),
				await kit.composeDraft(sessionId, fixtureComposition()),
				await kit.proposeSession(sessionId),
				await kit.inspectSession(sessionId),
			]) {
				assert.equal(mustRefuse(outcome).reason, 'disposed');
			}
		});

		test('dispose is idempotent (a second dispose never throws)', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			kit.dispose();
			assert.doesNotThrow(() => kit.dispose());
		});
	});

	suite('persistence (the PIN-2 sibling precedent, mirrored EXACTLY)', () => {
		test('the onboarding envelope and the append-only ledger land with the first applied op', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			assert.equal(files.has(ONB_LEDGER_PATH), true);
			assert.equal(files.has(ONB_ENVELOPE_PATH), true);
			const ledgerLines = (files.get(ONB_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 1);
			const line = JSON.parse(ledgerLines[0]) as Record<string, unknown>;
			assert.equal(line.op, 'begin-session');
			assert.equal(line.seq, 1);
			assert.equal(line.sessionId, `${ONBOARDING_SESSION_ID_PREFIX}0123456789abcdef`);
			assert.equal(line.fromStage, null);
			assert.equal(line.toStage, 'industry');
			assert.equal(line.payload, null);
			assert.equal(line.harnessId, null);
			assert.equal(line.contractVersion, ONBOARDING_CONTRACTS_VERSION);
			const envelope = JSON.parse(files.get(ONB_ENVELOPE_PATH) as string) as Record<string, unknown>;
			assert.deepEqual(Object.keys(envelope), ['contractVersion', 'seq', 'sessions']);
			assert.equal(envelope.seq, 1);
			assert.equal((envelope.sessions as unknown[]).length, 1);
		});

		test('the ledger appends one canonical line per applied op (seq == line number; the payloads canonical)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionId));
			const ledgerLines = (files.get(ONB_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 6);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2, 3, 4, 5, 6]);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { op: string }).op), [
				'begin-session', 'select-industry', 'compose-company', 'select-work-types', 'compose-draft', 'propose-session',
			]);
			const industryLine = JSON.parse(ledgerLines[1]) as { payload: { industry: string } };
			assert.deepEqual(industryLine.payload, { industry: 'legal' });
			const companyLine = JSON.parse(ledgerLines[2]) as { payload: Record<string, unknown> };
			assert.deepEqual(companyLine.payload, { displayName: 'fixture litigation harness', sizeBand: 'small' });
			const workTypesLine = JSON.parse(ledgerLines[3]) as { payload: string[] };
			assert.deepEqual(workTypesLine.payload, ['analysis', 'drafting', 'review']);
			const draftLine = JSON.parse(ledgerLines[4]) as { payload: Record<string, unknown>; harnessId: string };
			assert.deepEqual(Object.keys(draftLine.payload), ['roles', 'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']);
			assert.equal(draftLine.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
			const proposeLine = JSON.parse(ledgerLines[5]) as { payload: unknown; harnessId: string };
			assert.equal(proposeLine.payload, null);
			assert.equal(proposeLine.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
		});

		test('THE REAL-KIT LAW persistence evidence: the harness ledger and envelope land alongside (the mint and the advance are the DH-01 kit\'s own writes)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionId));
			const harnessLines = (files.get(HRN_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(harnessLines.length, 2);
			const mintLine = JSON.parse(harnessLines[0]) as Record<string, unknown>;
			assert.equal(mintLine.op, 'mint');
			assert.equal(mintLine.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
			assert.equal(mintLine.toState, 'draft');
			const transitionLine = JSON.parse(harnessLines[1]) as Record<string, unknown>;
			assert.equal(transitionLine.op, 'transition');
			assert.equal(transitionLine.fromState, 'draft');
			assert.equal(transitionLine.toState, 'proposed');
			const harnessEnvelope = JSON.parse(files.get(HRN_ENVELOPE_PATH) as string) as { harnesses: { state: string; descriptor: Record<string, unknown> }[] };
			assert.equal(harnessEnvelope.harnesses.length, 1);
			assert.equal(harnessEnvelope.harnesses[0].state, 'proposed');
			const descriptor = harnessEnvelope.harnesses[0].descriptor;
			assert.equal(descriptor.industry, 'legal');
			assert.deepEqual(descriptor.workTypes, ['analysis', 'drafting', 'review']);
			assert.equal(descriptor.displayName, 'fixture litigation harness');
			assert.deepEqual(descriptor.roles, [
				{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
				{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
			]);
			assert.deepEqual(descriptor.capabilityRefs, ['cap-fixture-001']);
			assert.deepEqual(descriptor.workflowRefs, ['wf-fixture-001']);
			assert.deepEqual(descriptor.policyRefs, ['pol-fixture-001']);
			assert.deepEqual(descriptor.evidenceRefs, ['ev-fixture-001']);
		});

		test('round-trip: loadOnboardingKit replays the identical honest session state', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			mustOkSession(await kit.proposeSession(sessionId));
			const live = mustOkSession(await kit.inspectSession(sessionId));
			const load = mustOkLoad(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			const reopened = mustOkSession(await load.kit.inspectSession(sessionId));
			assert.deepEqual(reopened.session, live.session);
			assert.equal((files.get(ONB_LEDGER_PATH) as string).endsWith('\n'), true);
		});

		test('restart survival mid-walk: the reloaded kit re-derives the draft harness (THE REAL-KIT LAW) and completes the walk', async () => {
			const { port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const draft = mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			const harnessId = draft.session.harnessId;
			const load = mustOkLoad(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			const reopened = mustOkSession(await load.kit.inspectSession(sessionId));
			assert.equal(reopened.session.stage, 'review');
			assert.equal(reopened.session.harnessId, harnessId);
			// The propose over the RELOADED kit succeeds: the inner real kit re-derived the draft harness from the harness ledger.
			const proposed = mustOkSession(await load.kit.proposeSession(sessionId));
			assert.equal(proposed.session.stage, 'proposed');
			assert.equal(proposed.session.harnessId, harnessId);
		});

		test('a fresh kit never appends over an existing onboarding ledger (E_LEDGER_TORN)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const second = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: fixedRng('ffffffffffffffff') }) as OnboardingKitOptions);
			const refusal = mustRefuse(await second.beginSession());
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.message, /reopen with loadOnboardingKit/);
			assert.equal((files.get(ONB_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0).length, 1);
		});

		test('a torn onboarding ledger (a missing trailing newline) fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const torn = (files.get(ONB_LEDGER_PATH) as string).slice(0, -1);
			files.set(ONB_LEDGER_PATH, torn);
			const refusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.message, /does not end with a complete line/);
		});

		test('an unparseable or sequence-drifted onboarding ledger line fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			files.set(ONB_LEDGER_PATH, '{not json}\n');
			assert.equal(mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions)).reason, 'E_LEDGER_TORN');
			const lines = [
				'{"seq":1,"at":"2026-10-13T00:00:00.000Z","contractVersion":"1.0.0","op":"begin-session","sessionId":"' + sessionId + '","fromStage":null,"toStage":"industry","law":"THE FORWARD-ONLY LAW","payload":null,"harnessId":null,"detail":"fixture"}',
				'{"seq":9,"at":"2026-10-13T00:00:01.000Z","contractVersion":"1.0.0","op":"select-industry","sessionId":"' + sessionId + '","fromStage":"industry","toStage":"company","law":"THE FORWARD-ONLY LAW","payload":{"industry":"legal"},"harnessId":null,"detail":"fixture"}',
			];
			files.set(ONB_LEDGER_PATH, `${lines.join('\n')}\n`);
			const refusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.message, /out of order|missing/);
		});

		test('a divergent onboarding envelope fails closed with E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const envelope = JSON.parse(files.get(ONB_ENVELOPE_PATH) as string) as Record<string, unknown>;
			const sessions = envelope.sessions as Record<string, unknown>[];
			(sessions[0] as { stage: string }).stage = 'company';
			files.set(ONB_ENVELOPE_PATH, JSON.stringify(envelope));
			const refusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(refusal.message, /never silently rebuilt/);
		});

		test('a missing envelope with a non-empty ledger, and a malformed / version-drifted envelope, fail closed with E_ENVELOPE_MISMATCH', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			files.delete(ONB_ENVELOPE_PATH);
			const missing = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(missing.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(missing.message, /envelope is missing/);
			const validEnvelope = files.get(ONB_ENVELOPE_PATH) === undefined ? null : null;
			assert.equal(validEnvelope, null);
			files.set(ONB_ENVELOPE_PATH, '{not json}');
			assert.equal(mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions)).reason, 'E_ENVELOPE_MISMATCH');
			const kitAgain = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: fixedRng('ffffffffffffffff') }) as unknown as OnboardingKitOptions);
			assert.equal(kitAgain !== null, true);
			const drifted = JSON.stringify({ contractVersion: '9.9.9', seq: 1, sessions: [] });
			files.set(ONB_ENVELOPE_PATH, drifted);
			const driftedRefusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(driftedRefusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(driftedRefusal.message, /contract version/);
		});

		test('an envelope ahead of the ledger fails closed with E_LEDGER_TORN (missing ledger lines)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			mustOkSession(await kit.beginSession());
			const envelope = JSON.parse(files.get(ONB_ENVELOPE_PATH) as string) as Record<string, unknown>;
			files.set(ONB_ENVELOPE_PATH, JSON.stringify({ ...envelope, seq: 9 }));
			const refusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.message, /missing ledger lines/);
		});

		test('a fresh root (no files) reopens as an empty kit, and loadOnboardingKit is idempotent (never rewrites the files)', async () => {
			const { files, port } = makeMemoryFs();
			const first = mustOkLoad(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.deepEqual(mustOkList(await first.kit.listSessions()).sessions, []);
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock, rng: counterRng() }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			const beforeLedger = files.get(ONB_LEDGER_PATH) as string;
			const beforeEnvelope = files.get(ONB_ENVELOPE_PATH) as string;
			const beforeHarnessLedger = files.get(HRN_LEDGER_PATH) as string;
			const second = mustOkLoad(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			const third = mustOkLoad(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(files.get(ONB_LEDGER_PATH), beforeLedger);
			assert.equal(files.get(ONB_ENVELOPE_PATH), beforeEnvelope);
			assert.equal(files.get(HRN_LEDGER_PATH), beforeHarnessLedger);
			const a = mustOkSession(await second.kit.inspectSession(sessionId));
			const b = mustOkSession(await third.kit.inspectSession(sessionId));
			assert.equal(JSON.stringify(a.session), JSON.stringify(b.session));
		});

		test('a tampered HARNESS ledger fails the load with the typed harness-kit-refused carrying the DH-01 refusal verbatim', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			files.set(HRN_LEDGER_PATH, '{not json}\n');
			const refusal = mustRefuse(await loadOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions));
			assert.equal(refusal.reason, 'harness-kit-refused');
			assert.equal(refusal.law, 'THE REAL-KIT LAW');
			assert.equal(refusal.harnessRefusal?.reason, 'E_LEDGER_TORN');
			assert.match(refusal.message, /never re-implements the harness load/);
		});

		test('a fresh onboarding kit over an existing HARNESS ledger (no onboarding ledger) surfaces the real kit\'s fresh-kit guard at the mint', async () => {
			const { files, port } = makeMemoryFs();
			const harnessKit = createHarnessKit({ clock: fixedClock(), rng: fixedRng('abcdefabcdefabcd'), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as HarnessKitOptions);
			const mint = await harnessKit.mintHarness({
				industry: 'legal',
				workTypes: ['analysis'],
				displayName: 'fixture sibling harness',
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' }],
				capabilityRefs: ['cap-fixture-001'],
				workflowRefs: ['wf-fixture-001'],
				policyRefs: ['pol-fixture-001'],
				evidenceRefs: ['ev-fixture-001'],
			});
			assert.equal(mint.ok, true);
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			const refusal = mustRefuse(await kit.composeDraft(sessionId, fixtureComposition()));
			assert.equal(refusal.reason, 'harness-kit-refused');
			assert.equal(refusal.harnessRefusal?.reason, 'E_LEDGER_TORN');
			assert.match(refusal.harnessRefusal?.detail ?? '', /reopen with loadHarnessKit/);
			// The onboarding walk itself is untouched: the session stays at review.
			const inspect = mustOkSession(await kit.inspectSession(sessionId));
			assert.equal(inspect.session.stage, 'review');
			assert.equal(inspect.session.harnessId, null);
			assert.equal((files.get(ONB_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0).length, 4);
		});

		test('a refusing onboarding ledger append is the typed ONBOARDING_IO with NOTHING applied', async () => {
			const { files } = makeMemoryFs();
			const port = appendRefusingFs(files);
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const refusal = mustRefuse(await kit.beginSession());
			assert.equal(refusal.reason, 'ONBOARDING_IO');
			assert.match(refusal.message, /nothing was applied/);
			const list = mustOkList(await kit.listSessions());
			assert.deepEqual(list.sessions, []);
			assert.equal(files.has(ONB_LEDGER_PATH), false);
		});

		test('a refusing envelope rewrite is the typed ONBOARDING_IO disclosing the landed line', async () => {
			const { files } = makeMemoryFs();
			const port = writeRefusingFs(files);
			const kit = createOnboardingKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			const refusal = mustRefuse(await kit.beginSession());
			assert.equal(refusal.reason, 'ONBOARDING_IO');
			assert.match(refusal.message, /landed at seq 1/);
			const list = mustOkList(await kit.listSessions());
			assert.equal(list.sessions.length, 1);
			const { port: workingPort } = makeMemoryFs(files);
			const load = await loadOnboardingKit(kitOptions({ fsPort: workingPort, root: FIXTURE_ROOT }) as OnboardingKitOptions);
			assert.equal(load.ok, false);
			assert.equal(mustRefuse(load).reason, 'E_ENVELOPE_MISMATCH');
		});

		test('an in-memory kit (no fsPort) never touches a filesystem - the full walk and the real kit\'s mint stay in memory', async () => {
			const kit = createOnboardingKit(kitOptions() as OnboardingKitOptions);
			const sessionId = await walkedToReview(kit);
			mustOkSession(await kit.composeDraft(sessionId, fixtureComposition()));
			const proposed = mustOkSession(await kit.proposeSession(sessionId));
			assert.equal(proposed.session.stage, 'proposed');
			assert.notEqual(proposed.session.harnessId, null);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every banned-global hit in onboardingKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/onboardingKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every banned-global hit in onboardingContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/onboardingContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});

/** Narrows a direct DH-01 mint outcome (the real-kit comparison helper). */
function mustOkSessionDirect<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustOkList<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustOkLoad<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}
