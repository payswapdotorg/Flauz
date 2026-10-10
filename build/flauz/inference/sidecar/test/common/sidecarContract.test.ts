/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-004 sidecar contract test suite (mocha tdd style, matching
 * build/flauz/inference/semantics/test/common/planSemantics.test.ts).
 *
 * Fixture policy: every sidecar id, provider id and probe value
 * below is SYNTHETIC (prefixed 'fixture.') and is NOT an authority
 * value. Closed-vocabulary members (the one interface profile, the
 * verification states) are the contract's own values under test.
 * Runtime-boundary probes are injected as JSON-parsed values, the
 * shape foreign input arrives in at a real boundary.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	INFERENCE_SIDECAR_VERSION,
	SIDECAR_INTERFACE_PROFILES,
	SIDECAR_REJECTION_REASONS,
	admitSidecar,
	isSidecarRecord,
	serializeSidecarRecord,
} from '../../common/sidecarContract.js';
import type {
	SidecarAdmission,
	SidecarAdmitted,
	SidecarRecord,
} from '../../common/sidecarContract.js';

const FIXTURE_SIDECAR_ID = 'fixture.sidecar.alpha';
const FIXTURE_PROVIDER_ID = 'fixture.provider.alpha';
const FIXTURE_REGISTERED_AT_EPOCH_MS = 1700000000000;
const CANONICAL_KEY_ORDER = [
	'sidecarId',
	'providerId',
	'interfaceProfile',
	'optional',
	'replaceable',
	'metadataVerification',
	'registeredAtEpochMs',
	'contractVersion',
];

function fixtureCandidate(): Record<string, unknown> {
	return {
		sidecarId: FIXTURE_SIDECAR_ID,
		providerId: FIXTURE_PROVIDER_ID,
		interfaceProfile: 'freellmapi-compatible',
		optional: true,
		replaceable: true,
		metadataVerification: 'unverified',
		registeredAtEpochMs: FIXTURE_REGISTERED_AT_EPOCH_MS,
		contractVersion: INFERENCE_SIDECAR_VERSION,
	};
}

function admitted(admission: SidecarAdmission): SidecarAdmitted {
	assert.equal(admission.kind, 'admitted', `expected admission, got: ${JSON.stringify(admission)}`);
	return admission;
}

function rejectedReason(admission: SidecarAdmission): string {
	assert.equal(admission.kind, 'rejected', `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission.reason;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

function candidateWith(overrides: Record<string, unknown>): any {
	return { ...fixtureCandidate(), ...overrides };
}

function candidateWithout(...keys: string[]): any {
	const candidate = fixtureCandidate();
	for (const key of keys) {
		delete candidate[key];
	}
	return candidate;
}

function admittedRecordFor(overrides: Record<string, unknown>): SidecarRecord {
	return admitted(admitSidecar(candidateWith(overrides))).record;
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-004 sidecar contract', () => {

	suite('constants and closed lists', () => {
		test('contract set version is 1.0.0', () => {
			assert.equal(INFERENCE_SIDECAR_VERSION, '1.0.0');
		});

		test('the interface-profile vocabulary is the closed one-member reference set', () => {
			assert.deepEqual(SIDECAR_INTERFACE_PROFILES, ['freellmapi-compatible']);
		});

		test('the rejection vocabulary is the frozen nine in the exact check order, duplicate-free', () => {
			assert.deepEqual(SIDECAR_REJECTION_REASONS, [
				'not-an-object',
				'sidecar-id-empty',
				'provider-id-empty',
				'interface-profile-unknown',
				'sidecar-not-optional',
				'sidecar-not-replaceable',
				'metadata-verification-unknown',
				'registered-at-malformed',
				'contract-version-mismatch',
			]);
			assert.equal(new Set(SIDECAR_REJECTION_REASONS).size, SIDECAR_REJECTION_REASONS.length);
		});
	});

	suite('admitSidecar admissions', () => {
		test('admits an honest freellmapi-compatible sidecar record', () => {
			const admission = admitted(admitSidecar(fixtureCandidate()));
			assert.deepEqual(admission.record, {
				sidecarId: FIXTURE_SIDECAR_ID,
				providerId: FIXTURE_PROVIDER_ID,
				interfaceProfile: 'freellmapi-compatible',
				optional: true,
				replaceable: true,
				metadataVerification: 'unverified',
				registeredAtEpochMs: FIXTURE_REGISTERED_AT_EPOCH_MS,
				contractVersion: INFERENCE_SIDECAR_VERSION,
			});
		});

		test('the admitted record carries the canonical key order (the declaration order)', () => {
			const admission = admitted(admitSidecar(fixtureCandidate()));
			assert.deepEqual(Object.keys(admission.record), CANONICAL_KEY_ORDER);
		});

		test('a JSON-parsed boundary probe admits (foreign input, the arrival shape)', () => {
			const probe = foreign(JSON.stringify(fixtureCandidate()));
			assert.equal(admitSidecar(probe).kind, 'admitted');
		});

		test('registeredAtEpochMs 0 is admitted (the finite >= 0 boundary is inclusive)', () => {
			const record = admittedRecordFor({ registeredAtEpochMs: 0 });
			assert.equal(record.registeredAtEpochMs, 0);
		});

		test('a huge finite registeredAtEpochMs is admitted', () => {
			const record = admittedRecordFor({ registeredAtEpochMs: Number.MAX_SAFE_INTEGER });
			assert.equal(record.registeredAtEpochMs, Number.MAX_SAFE_INTEGER);
		});

		test("metadataVerification 'verified' is admitted (the landed one-way promotion's output is carried)", () => {
			assert.equal(admittedRecordFor({ metadataVerification: 'verified' }).metadataVerification, 'verified');
		});

		test("metadataVerification 'unverified' is admitted (the honest default)", () => {
			assert.equal(admittedRecordFor({ metadataVerification: 'unverified' }).metadataVerification, 'unverified');
		});

		test('admission is deterministic: the same candidate yields the same verdict twice', () => {
			const first = admitSidecar(fixtureCandidate());
			const second = admitSidecar(fixtureCandidate());
			assert.deepEqual(first, second);
		});

		test('the guard never mutates its input', () => {
			const candidate = fixtureCandidate();
			const expected = JSON.parse(JSON.stringify(candidate));
			admitSidecar(candidate);
			assert.deepEqual(candidate, expected);
		});
	});

	suite('admitSidecar rejections (every frozen reason fires)', () => {
		test('not-an-object: null, undefined, strings, numbers and booleans reject', () => {
			for (const candidate of [null, undefined, 'fixture.sidecar', 42, true]) {
				assert.equal(rejectedReason(admitSidecar(candidate)), 'not-an-object');
			}
		});

		test('sidecar-id-empty: missing, empty and non-string ids reject', () => {
			for (const sidecarId of ['', 42, null, true, {}]) {
				assert.equal(rejectedReason(admitSidecar(candidateWith({ sidecarId }))), 'sidecar-id-empty');
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('sidecarId'))), 'sidecar-id-empty');
		});

		test('provider-id-empty: missing, empty and non-string provider ids reject', () => {
			for (const providerId of ['', 42, null, true, {}]) {
				assert.equal(rejectedReason(admitSidecar(candidateWith({ providerId }))), 'provider-id-empty');
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('providerId'))), 'provider-id-empty');
		});

		test('interface-profile-unknown: values outside the closed set reject', () => {
			for (const interfaceProfile of [
				'openai-compatible',
				'freellmapi',
				'FREELLMAPI-COMPATIBLE',
				'freellmapi-compatible ',
				'',
				42,
				null,
				true,
			]) {
				assert.equal(
					rejectedReason(admitSidecar(candidateWith({ interfaceProfile }))),
					'interface-profile-unknown',
				);
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('interfaceProfile'))), 'interface-profile-unknown');
		});

		test('sidecar-not-optional: optional false is the required-dependency lie and rejects', () => {
			assert.equal(rejectedReason(admitSidecar(candidateWith({ optional: false }))), 'sidecar-not-optional');
		});

		test('sidecar-not-optional: an absent optional rejects (the lie by omission)', () => {
			assert.equal(rejectedReason(admitSidecar(candidateWithout('optional'))), 'sidecar-not-optional');
		});

		test("sidecar-not-optional: the string 'true' is not the literal true and rejects", () => {
			assert.equal(rejectedReason(admitSidecar(candidateWith({ optional: 'true' }))), 'sidecar-not-optional');
		});

		test('sidecar-not-optional: numeric 1 and other truthy shapes reject (literal true only)', () => {
			for (const optional of [1, 'yes', {}]) {
				assert.equal(rejectedReason(admitSidecar(candidateWith({ optional }))), 'sidecar-not-optional');
			}
		});

		test('sidecar-not-replaceable: false, absent and string-true reject (the authority lie)', () => {
			for (const replaceable of [false, 'true', 1, undefined]) {
				assert.equal(
					rejectedReason(admitSidecar(candidateWith({ replaceable }))),
					'sidecar-not-replaceable',
				);
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('replaceable'))), 'sidecar-not-replaceable');
		});

		test('metadata-verification-unknown: values outside the landed vocabulary reject', () => {
			for (const metadataVerification of ['pending', 'Verified', 'unknown', '', 42, null, true]) {
				assert.equal(
					rejectedReason(admitSidecar(candidateWith({ metadataVerification }))),
					'metadata-verification-unknown',
				);
			}
			assert.equal(
				rejectedReason(admitSidecar(candidateWithout('metadataVerification'))),
				'metadata-verification-unknown',
			);
		});

		test('registered-at-malformed: non-finite, negative and non-number times reject', () => {
			for (const registeredAtEpochMs of [NaN, Infinity, -Infinity, -1, -0.5, '1700000000000', null, true]) {
				assert.equal(
					rejectedReason(admitSidecar(candidateWith({ registeredAtEpochMs }))),
					'registered-at-malformed',
				);
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('registeredAtEpochMs'))), 'registered-at-malformed');
		});

		test('contract-version-mismatch: wrong, missing and non-string versions reject', () => {
			for (const contractVersion of ['1.0.1', '2.0.0', '0.9.0', '1.0', '', 1, null, true]) {
				assert.equal(
					rejectedReason(admitSidecar(candidateWith({ contractVersion }))),
					'contract-version-mismatch',
				);
			}
			assert.equal(rejectedReason(admitSidecar(candidateWithout('contractVersion'))), 'contract-version-mismatch');
		});
	});

	suite('admission check order (the reason list order is the verdict order)', () => {
		test('a candidate failing sidecar-id and provider-id reports sidecar-id-empty first', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ sidecarId: '', providerId: '' }))),
				'sidecar-id-empty',
			);
		});

		test('an unknown profile beats the optional lie', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ interfaceProfile: 'fixture.profile', optional: false }))),
				'interface-profile-unknown',
			);
		});

		test('the optional lie beats the replaceable lie', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ optional: false, replaceable: false }))),
				'sidecar-not-optional',
			);
		});

		test('the replaceable lie beats a malformed metadata verification', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ replaceable: false, metadataVerification: 'pending' }))),
				'sidecar-not-replaceable',
			);
		});

		test('a malformed metadata verification beats a malformed registered time', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ metadataVerification: 'pending', registeredAtEpochMs: -1 }))),
				'metadata-verification-unknown',
			);
		});

		test('a malformed registered time beats a version mismatch', () => {
			assert.equal(
				rejectedReason(admitSidecar(candidateWith({ registeredAtEpochMs: NaN, contractVersion: '9.9.9' }))),
				'registered-at-malformed',
			);
		});

		test('a not-an-object beats everything (no fields are reachable)', () => {
			assert.equal(rejectedReason(admitSidecar(foreign('null'))), 'not-an-object');
		});
	});

	suite('isSidecarRecord', () => {
		test('admitted records satisfy the predicate', () => {
			assert.equal(isSidecarRecord(admittedRecordFor({})), true);
		});

		test('the serialization round trip preserves the predicate', () => {
			const record = admittedRecordFor({});
			assert.equal(isSidecarRecord(foreign(serializeSidecarRecord(record))), true);
		});

		test('every rejection class fails the predicate', () => {
			for (const candidate of [
				null,
				'fixture.sidecar',
				42,
				candidateWith({ sidecarId: '' }),
				candidateWith({ interfaceProfile: 'fixture.profile' }),
				candidateWith({ metadataVerification: 'pending' }),
				candidateWith({ registeredAtEpochMs: -1 }),
				candidateWith({ contractVersion: '9.9.9' }),
			]) {
				assert.equal(isSidecarRecord(candidate), false);
			}
		});

		test('the optional lie fails the predicate even though every other field is honest', () => {
			assert.equal(isSidecarRecord(candidateWith({ optional: false })), false);
			assert.equal(isSidecarRecord(candidateWithout('optional')), false);
		});

		test('the replaceable lie fails the predicate even though every other field is honest', () => {
			assert.equal(isSidecarRecord(candidateWith({ replaceable: false })), false);
			assert.equal(isSidecarRecord(candidateWithout('replaceable')), false);
		});
	});

	suite('serializeSidecarRecord (canonical bytes)', () => {
		test('double-run byte-equal', () => {
			const record = admittedRecordFor({});
			assert.equal(serializeSidecarRecord(record), serializeSidecarRecord(record));
		});

		test('key-insertion-order independence: shuffled JSON input admits to identical bytes', () => {
			const shuffled = foreign(
				JSON.stringify({
					contractVersion: INFERENCE_SIDECAR_VERSION,
					registeredAtEpochMs: FIXTURE_REGISTERED_AT_EPOCH_MS,
					metadataVerification: 'unverified',
					replaceable: true,
					optional: true,
					interfaceProfile: 'freellmapi-compatible',
					providerId: FIXTURE_PROVIDER_ID,
					sidecarId: FIXTURE_SIDECAR_ID,
				}),
			);
			const straightBytes = serializeSidecarRecord(admitted(admitSidecar(fixtureCandidate())).record);
			const shuffledBytes = serializeSidecarRecord(admitted(admitSidecar(shuffled)).record);
			assert.equal(shuffledBytes, straightBytes);
		});

		test('every free-field difference changes the bytes (the closed/literal fields cannot differ by construction)', () => {
			const baseBytes = serializeSidecarRecord(admittedRecordFor({}));
			for (const [field, value] of [
				['sidecarId', 'fixture.sidecar.beta'],
				['providerId', 'fixture.provider.beta'],
				['metadataVerification', 'verified'],
				['registeredAtEpochMs', FIXTURE_REGISTERED_AT_EPOCH_MS + 1],
			] as const) {
				const changedBytes = serializeSidecarRecord(admittedRecordFor({ [field]: value }));
				assert.notEqual(changedBytes, baseBytes, `changing '${field}' must change the canonical bytes`);
			}
		});

		test('the canonical bytes carry the version stamp', () => {
			const bytes = serializeSidecarRecord(admittedRecordFor({}));
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_SIDECAR_VERSION}"`), true);
		});

		test('the canonical key order is the frozen declaration order', () => {
			const bytes = serializeSidecarRecord(admittedRecordFor({}));
			assert.deepEqual(Object.keys(foreign(bytes)), CANONICAL_KEY_ORDER);
		});

		test('refuses non-records fail-closed (no dishonest sidecar record gets canonical bytes)', () => {
			for (const bad of [null, undefined, 'fixture.sidecar', 42, {}, candidateWith({ optional: false })]) {
				assert.throws(() => serializeSidecarRecord(bad as SidecarRecord), TypeError);
			}
		});
	});

	suite('version stamping', () => {
		test('every admitted record stamps the contract version', () => {
			assert.equal(admittedRecordFor({}).contractVersion, INFERENCE_SIDECAR_VERSION);
			assert.equal(
				admittedRecordFor({ sidecarId: 'fixture.sidecar.beta' }).contractVersion,
				INFERENCE_SIDECAR_VERSION,
			);
		});

		test('the version rides the canonical bytes of every admitted record', () => {
			const bytes = serializeSidecarRecord(admittedRecordFor({ sidecarId: 'fixture.sidecar.gamma' }));
			assert.equal(foreign(bytes).contractVersion, '1.0.0');
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in sidecarContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/sidecarContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
