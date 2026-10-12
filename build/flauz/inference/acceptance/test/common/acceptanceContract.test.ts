/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 acceptance contract test suite (mocha tdd style, matching
 * build/flauz/inference/presentation/test/common/presentationContract.test.ts).
 *
 * Fixture policy: every provider id, adapter id, model id, scope id
 * and handle reference below is SYNTHETIC (prefixed 'fixture.') and
 * is NOT an authority value, NOT credential material (the typed
 * reference is the landed triple shape only). Closed-vocabulary
 * members (the evidence labels, the drill classes, the rejection
 * reasons, the serializer citation names, the version stamps) are
 * the contract's own values under test. Runtime-boundary probes are
 * injected as JSON-parsed values. The canonical-byte tests pin
 * determinism and the landed serializers' embedded key orders; the
 * suites never read a clock; the in-suite determinism greps pin the
 * sources to law-comment lines only.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ACCEPTANCE_BYTE_SERIALIZERS,
	ACCEPTANCE_EVIDENCE_LABELS,
	ACCEPTANCE_REJECTION_REASONS,
	DRILL_CLASSES,
	FAILURE_DRILL_CLASSES,
	INFERENCE_ACCEPTANCE_VERSION,
	isAcceptanceEvidenceLabel,
	isAcceptanceLedgerLine,
	isDrillClass,
	isDrillEvidence,
	isDrillRecord,
	isFailureDrillClass,
	isFailureEvidence,
	serializeAcceptanceRecord,
} from '../../common/acceptanceContract.js';
import type {
	AcceptanceLedgerLine,
	ByteCitation,
	DrillRecord,
	FailureEvidence,
} from '../../common/acceptanceContract.js';
import {
	INFERENCE_PRESENTATION_VERSION,
	serializePresentationRecord,
} from '../../../presentation/common/presentationContract.js';
import type {
	CapacityView,
	DecisionView,
	ProvenanceView,
	ResetExpectationView,
} from '../../../presentation/common/presentationContract.js';
import { serializeCredentialScope } from '../../../isolation/common/isolationContract.js';

const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_RESET_AT_MS = 1_700_003_600_000;
const FIXTURE_PROVIDER = 'fixture.provider.healthy';
const FIXTURE_ADAPTER = 'fixture.acceptance.healthy';
const FIXTURE_MODEL = 'fixture.model.healthy-main';
const FIXTURE_CREDENTIAL = 'fixture.credential.handle.healthy';
const FIXTURE_SCOPE_ID = 'fixture.scope.healthy';

function fixtureScope(): { id: string; adapterId: string; handleRef: string } {
	return { id: FIXTURE_SCOPE_ID, adapterId: FIXTURE_ADAPTER, handleRef: FIXTURE_CREDENTIAL };
}

function fixtureProvenanceView(): ProvenanceView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		verification: 'unverified',
		substitution: 'none',
		scopeLabel: FIXTURE_MODEL,
		requestedProviderId: FIXTURE_PROVIDER,
		requestedModelId: FIXTURE_MODEL,
		actualProviderId: FIXTURE_PROVIDER,
		actualModelId: FIXTURE_MODEL,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureResetExpectationView(): ResetExpectationView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		resetClass: 'fixed-instant',
		expectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' },
		projectedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureCapacityView(): CapacityView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		providerId: FIXTURE_PROVIDER,
		health: 'healthy',
		verification: 'unverified',
		capacityState: 'available',
		cooldown: false,
		quotaRemaining: 1000,
		resetExpectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' },
		provenance: fixtureProvenanceView(),
		generatedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureDecisionView(): DecisionView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'isolation',
		side: 'selected',
		decidedAtEpochMs: FIXTURE_NOW_MS,
		adapterId: FIXTURE_ADAPTER,
		reasons: ['eligible'],
		provenance: fixtureProvenanceView(),
	};
}

/**
 * The byte citations of the fixture drill record, produced THROUGH
 * the landed serializers (the never-re-derive law's own citation
 * shape - the kit cites, never re-implements; the fixture mirrors
 * it honestly).
 */
function fixtureByteCitations(): ByteCitation[] {
	return [
		{ serializer: 'serializeCredentialScope', bytes: serializeCredentialScope(fixtureScope()) },
		{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(fixtureProvenanceView()) },
		{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(fixtureCapacityView()) },
		{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(fixtureResetExpectationView()) },
		{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(fixtureDecisionView()) },
	];
}

function fixtureDrillRecord(): DrillRecord {
	return {
		kind: 'drill',
		contractVersion: INFERENCE_ACCEPTANCE_VERSION,
		drillId: 'fixture.drill.healthy-1',
		drillClass: 'acceptance-exchange',
		evidenceLabel: 'fixture',
		adapterId: FIXTURE_ADAPTER,
		providerEntryId: FIXTURE_PROVIDER,
		transportKind: 'http-generic-json',
		capacityProvenance: 'third-party-free-tier',
		credentialHandle: FIXTURE_CREDENTIAL,
		scope: fixtureScope(),
		payload: {
			provenanceView: fixtureProvenanceView(),
			capacityView: fixtureCapacityView(),
			resetExpectationView: fixtureResetExpectationView(),
			decisionView: fixtureDecisionView(),
			eligibilityVerdict: 'eligible',
		},
		byteCitations: fixtureByteCitations(),
		startedAtEpochMs: FIXTURE_NOW_MS,
		completedAtEpochMs: FIXTURE_NOW_MS + 1000,
		failureReason: 'none',
	};
}

function fixtureFailureEvidence(): FailureEvidence {
	return {
		kind: 'failure',
		contractVersion: INFERENCE_ACCEPTANCE_VERSION,
		drillId: 'fixture.drill.refused-1',
		drillClass: 'network-refused',
		evidenceLabel: 'fixture',
		adapterId: FIXTURE_ADAPTER,
		failureReason: 'rate limited by the fixture port',
		disclosure: { side: 'refused', reasons: ['rate limited by the fixture port'] },
		failedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureLedgerLine(): AcceptanceLedgerLine {
	return {
		contractVersion: INFERENCE_ACCEPTANCE_VERSION,
		line: 1,
		recordKind: 'drill',
		canonicalBytes: serializeAcceptanceRecord(fixtureDrillRecord()),
		record: fixtureDrillRecord(),
	};
}

/** The deep key-shuffle: every object's own keys reversed (canonical bytes must not care). */
function shuffleDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => shuffleDeep(entry)) as unknown as T;
	}
	if (typeof value === 'object' && value !== null) {
		const shuffled: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
			shuffled[key] = shuffleDeep((value as Record<string, unknown>)[key]);
		}
		return shuffled as unknown as T;
	}
	return value;
}

function parsedJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-009 acceptance contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('INFERENCE_ACCEPTANCE_VERSION is 1.0.0', () => {
			assert.equal(INFERENCE_ACCEPTANCE_VERSION, '1.0.0');
		});

		test('the acceptance stamp and the landed family stamps are distinct roles', () => {
			const record = fixtureDrillRecord();
			assert.equal(record.contractVersion, INFERENCE_ACCEPTANCE_VERSION);
			assert.equal(record.payload.provenanceView.contractVersion, INFERENCE_PRESENTATION_VERSION);
			assert.equal(record.payload.capacityView.contractVersion, INFERENCE_PRESENTATION_VERSION);
			assert.equal(record.payload.resetExpectationView.contractVersion, INFERENCE_PRESENTATION_VERSION);
			assert.equal(record.payload.decisionView.contractVersion, INFERENCE_PRESENTATION_VERSION);
		});
	});

	suite('ACCEPTANCE_EVIDENCE_LABELS (the frozen list)', () => {
		test('the exact three labels, in the frozen order', () => {
			assert.deepEqual([...ACCEPTANCE_EVIDENCE_LABELS], ['fixture', 'local-real', 'live-real']);
		});

		test('the labels are unique', () => {
			assert.equal(new Set(ACCEPTANCE_EVIDENCE_LABELS).size, ACCEPTANCE_EVIDENCE_LABELS.length);
		});

		test('isAcceptanceEvidenceLabel admits the members only', () => {
			assert.equal(isAcceptanceEvidenceLabel('fixture'), true);
			assert.equal(isAcceptanceEvidenceLabel('local-real'), true);
			assert.equal(isAcceptanceEvidenceLabel('live-real'), true);
			assert.equal(isAcceptanceEvidenceLabel('promoted'), false);
			assert.equal(isAcceptanceEvidenceLabel('live'), false);
			assert.equal(isAcceptanceEvidenceLabel(''), false);
			assert.equal(isAcceptanceEvidenceLabel(null), false);
			assert.equal(isAcceptanceEvidenceLabel(1), false);
		});
	});

	suite('ACCEPTANCE_REJECTION_REASONS (the frozen list)', () => {
		test('the exact eleven reasons, in the frozen order', () => {
			assert.deepEqual([...ACCEPTANCE_REJECTION_REASONS], [
				'not-an-object',
				'caller-supplied-label',
				'caller-supplied-verdict',
				'shape-law-violation',
				'no-live-port',
				'credential-shape',
				'unresolved-adapter-binding',
				'unresolved-scope-binding',
				'unresolved-decision-binding',
				'unresolved-ledger-line',
				'malformed-record',
			]);
		});

		test('the reasons are unique', () => {
			assert.equal(new Set(ACCEPTANCE_REJECTION_REASONS).size, ACCEPTANCE_REJECTION_REASONS.length);
		});
	});

	suite('DRILL_CLASSES and FAILURE_DRILL_CLASSES (the frozen lists)', () => {
		test('the exact seven classes, in the frozen order', () => {
			assert.deepEqual([...DRILL_CLASSES], [
				'acceptance-exchange',
				'quota-failure',
				'cooldown-failure',
				'reset-failure',
				'eligibility-refusal',
				'provenance-unknown',
				'network-refused',
			]);
		});

		test('the failure classes are the six, in the landed failure order', () => {
			assert.deepEqual([...FAILURE_DRILL_CLASSES], [
				'quota-failure',
				'cooldown-failure',
				'reset-failure',
				'eligibility-refusal',
				'provenance-unknown',
				'network-refused',
			]);
		});

		test('the failure classes exclude the acceptance class (a completed exchange is a DrillRecord)', () => {
			assert.equal(FAILURE_DRILL_CLASSES.includes('acceptance-exchange' as never), false);
		});

		test('isDrillClass and isFailureDrillClass admit their members only', () => {
			assert.equal(isDrillClass('acceptance-exchange'), true);
			assert.equal(isDrillClass('quota-failure'), true);
			assert.equal(isDrillClass('not-a-class'), false);
			assert.equal(isFailureDrillClass('quota-failure'), true);
			assert.equal(isFailureDrillClass('network-refused'), true);
			assert.equal(isFailureDrillClass('acceptance-exchange'), false);
			assert.equal(isFailureDrillClass(null), false);
		});
	});

	suite('ACCEPTANCE_BYTE_SERIALIZERS (the frozen citation vocabulary)', () => {
		test('the exact five landed serializer names, in the frozen order', () => {
			assert.deepEqual([...ACCEPTANCE_BYTE_SERIALIZERS], [
				'serializeCredentialScope',
				'serializeAdapterReport',
				'serializeCapacityDisclosure',
				'serializePresentationRecord',
				'serializeEligibilityDecision',
			]);
		});

		test('the serializer names are unique', () => {
			assert.equal(new Set(ACCEPTANCE_BYTE_SERIALIZERS).size, ACCEPTANCE_BYTE_SERIALIZERS.length);
		});
	});

	suite('isDrillRecord (the honest-evidence laws made structural)', () => {
		test('the fixture drill record admits', () => {
			assert.equal(isDrillRecord(fixtureDrillRecord()), true);
		});

		test('a JSON-parsed fixture record admits at the runtime boundary', () => {
			assert.equal(isDrillRecord(parsedJson(fixtureDrillRecord())), true);
		});

		test('a non-object is not a record', () => {
			assert.equal(isDrillRecord(null), false);
			assert.equal(isDrillRecord(undefined), false);
			assert.equal(isDrillRecord('drill'), false);
			assert.equal(isDrillRecord(42), false);
		});

		test('the acceptance stamp is required', () => {
			const record = { ...fixtureDrillRecord(), contractVersion: '0.9.0' };
			assert.equal(isDrillRecord(record), false);
		});

		test('the drill kind is required', () => {
			const record = { ...fixtureDrillRecord(), kind: 'failure' };
			assert.equal(isDrillRecord(record), false);
		});

		test('the drill class must be the acceptance-exchange class (failures ride FailureEvidence)', () => {
			const record = { ...fixtureDrillRecord(), drillClass: 'quota-failure' };
			assert.equal(isDrillRecord(record), false);
		});

		test('a non-member evidence label is rejected', () => {
			const record = { ...fixtureDrillRecord(), evidenceLabel: 'promoted' };
			assert.equal(isDrillRecord(record), false);
		});

		test("'local-real' is rejected on a drill record (the upgrade law's record classes)", () => {
			const record = { ...fixtureDrillRecord(), evidenceLabel: 'local-real' };
			assert.equal(isDrillRecord(record), false);
		});

		test('empty adapter / provider / handle fields are rejected', () => {
			assert.equal(isDrillRecord({ ...fixtureDrillRecord(), adapterId: '' }), false);
			assert.equal(isDrillRecord({ ...fixtureDrillRecord(), providerEntryId: '' }), false);
			assert.equal(isDrillRecord({ ...fixtureDrillRecord(), credentialHandle: '' }), false);
		});

		test('a non-member transport kind is rejected (the landed vocabulary only)', () => {
			const record = { ...fixtureDrillRecord(), transportKind: 'carrier-pigeon' };
			assert.equal(isDrillRecord(record), false);
		});

		test('a non-member capacity provenance is rejected (the landed vocabulary only)', () => {
			const record = { ...fixtureDrillRecord(), capacityProvenance: 'magic' };
			assert.equal(isDrillRecord(record), false);
		});

		test('a scope beyond the landed triple shape is rejected (the no-secret law)', () => {
			const record = {
				...fixtureDrillRecord(),
				scope: { ...fixtureScope(), apiKey: 'fixture.secret-shaped-value' },
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('the handle-equality law: the scope adapter binding must equal the record own adapter binding', () => {
			const record = {
				...fixtureDrillRecord(),
				scope: { id: FIXTURE_SCOPE_ID, adapterId: 'fixture.acceptance.other', handleRef: FIXTURE_CREDENTIAL },
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('the handle-equality law: the scope handle reference must equal the record own credentialHandle', () => {
			const record = {
				...fixtureDrillRecord(),
				scope: { id: FIXTURE_SCOPE_ID, adapterId: FIXTURE_ADAPTER, handleRef: 'fixture.credential.invented' },
				credentialHandle: 'fixture.credential.invented',
			};
			const inconsistent = { ...record, scope: { ...fixtureScope(), handleRef: 'fixture.credential.different' } };
			assert.equal(isDrillRecord(record), true);
			assert.equal(isDrillRecord(inconsistent), false);
		});

		test('a non-member eligibility verdict is rejected (the landed vocabulary only)', () => {
			const record = {
				...fixtureDrillRecord(),
				payload: { ...fixtureDrillRecord().payload, eligibilityVerdict: 'super-eligible' },
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('the decision view must be the isolation decided-side projection (family and side)', () => {
			const wrongFamily = {
				...fixtureDrillRecord(),
				payload: {
					...fixtureDrillRecord().payload,
					decisionView: { ...fixtureDecisionView(), family: 'routing' },
				},
			};
			const wrongSide = {
				...fixtureDrillRecord(),
				payload: {
					...fixtureDrillRecord().payload,
					decisionView: { ...fixtureDecisionView(), side: 'refused', adapterId: 'none', provenance: 'none' },
				},
			};
			assert.equal(isDrillRecord(wrongFamily), false);
			assert.equal(isDrillRecord(wrongSide), false);
		});

		test("the decision view's reasons carry exactly the landed verdict", () => {
			const record = {
				...fixtureDrillRecord(),
				payload: {
					...fixtureDrillRecord().payload,
					decisionView: { ...fixtureDecisionView(), reasons: ['eligible', 'extra'] },
				},
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('a dangling provenance attribution is rejected (no dangling attribution)', () => {
			const record = {
				...fixtureDrillRecord(),
				providerEntryId: 'fixture.provider.other',
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('a dangling capacity attribution is rejected (no dangling attribution)', () => {
			const record = {
				...fixtureDrillRecord(),
				payload: {
					...fixtureDrillRecord().payload,
					capacityView: { ...fixtureCapacityView(), providerId: 'fixture.provider.other' },
				},
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('empty byte citations are rejected (the never-re-derive law needs its citations)', () => {
			const record = { ...fixtureDrillRecord(), byteCitations: [] };
			assert.equal(isDrillRecord(record), false);
		});

		test('a non-member serializer citation name is rejected', () => {
			const record = {
				...fixtureDrillRecord(),
				byteCitations: [{ serializer: 'serializeMyOwnThing', bytes: '{}' }],
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('empty citation bytes are rejected', () => {
			const record = {
				...fixtureDrillRecord(),
				byteCitations: [{ serializer: 'serializeCredentialScope', bytes: '' }],
			};
			assert.equal(isDrillRecord(record), false);
		});

		test('non-finite timestamps are rejected', () => {
			assert.equal(isDrillRecord({ ...fixtureDrillRecord(), startedAtEpochMs: Number.NaN }), false);
			assert.equal(isDrillRecord({ ...fixtureDrillRecord(), completedAtEpochMs: Number.POSITIVE_INFINITY }), false);
		});

		test('a completion before the start is rejected (never a negative latency)', () => {
			const record = { ...fixtureDrillRecord(), startedAtEpochMs: FIXTURE_NOW_MS + 2000 };
			assert.equal(isDrillRecord(record), false);
		});

		test("the failure reason must be the literal 'none' (a drill record never failed)", () => {
			const record = { ...fixtureDrillRecord(), failureReason: 'rate limited by the fixture port' };
			assert.equal(isDrillRecord(record), false);
		});

		test('an extra own field is rejected (no parallel vocabulary is representable)', () => {
			const record = { ...fixtureDrillRecord(), retryCount: 3 };
			assert.equal(isDrillRecord(record), false);
		});

		test('an extra payload field is rejected (the projection set is pinned)', () => {
			const record = {
				...fixtureDrillRecord(),
				payload: { ...fixtureDrillRecord().payload, displayLabel: 'healthy' },
			};
			assert.equal(isDrillRecord(record), false);
		});
	});

	suite('isFailureEvidence (the honest-failure law made structural)', () => {
		test('the fixture failure evidence admits', () => {
			assert.equal(isFailureEvidence(fixtureFailureEvidence()), true);
		});

		test('a JSON-parsed failure evidence admits at the runtime boundary', () => {
			assert.equal(isFailureEvidence(parsedJson(fixtureFailureEvidence())), true);
		});

		test('a non-object is not failure evidence', () => {
			assert.equal(isFailureEvidence(null), false);
			assert.equal(isFailureEvidence('failure'), false);
		});

		test('the acceptance stamp is required', () => {
			const evidence = { ...fixtureFailureEvidence(), contractVersion: '2.0.0' };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('the failure kind is required', () => {
			const evidence = { ...fixtureFailureEvidence(), kind: 'drill' };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('the acceptance-exchange class is rejected (a completed exchange is a DrillRecord)', () => {
			const evidence = { ...fixtureFailureEvidence(), drillClass: 'acceptance-exchange' };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test("'local-real' is rejected on a failure record (the upgrade law's record classes)", () => {
			const evidence = { ...fixtureFailureEvidence(), evidenceLabel: 'local-real' };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('an empty failure reason is rejected (verbatim, never empty)', () => {
			const evidence = { ...fixtureFailureEvidence(), failureReason: '' };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test("the disclosure side must be the literal 'refused'", () => {
			const evidence = {
				...fixtureFailureEvidence(),
				disclosure: { side: 'completed', reasons: ['rate limited by the fixture port'] },
			};
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('empty disclosure reasons are rejected (the never-silent-empty law)', () => {
			const evidence = {
				...fixtureFailureEvidence(),
				disclosure: { side: 'refused', reasons: [] },
			};
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('a non-string disclosure reason is rejected', () => {
			const evidence = {
				...fixtureFailureEvidence(),
				disclosure: { side: 'refused', reasons: ['rate limited by the fixture port', 42] },
			};
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('a non-finite failure instant is rejected', () => {
			const evidence = { ...fixtureFailureEvidence(), failedAtEpochMs: Number.NaN };
			assert.equal(isFailureEvidence(evidence), false);
		});

		test('an extra own field is rejected', () => {
			const evidence = { ...fixtureFailureEvidence(), retried: false };
			assert.equal(isFailureEvidence(evidence), false);
		});
	});

	suite('isDrillEvidence and isAcceptanceLedgerLine', () => {
		test('either evidence side admits', () => {
			assert.equal(isDrillEvidence(fixtureDrillRecord()), true);
			assert.equal(isDrillEvidence(fixtureFailureEvidence()), true);
		});

		test('a non-record is not evidence', () => {
			assert.equal(isDrillEvidence({ kind: 'drill' }), false);
			assert.equal(isDrillEvidence(null), false);
		});

		test('the fixture ledger line admits', () => {
			assert.equal(isAcceptanceLedgerLine(fixtureLedgerLine()), true);
		});

		test('the record kind must agree with the embedded record own kind (one line, one record kind)', () => {
			const line = { ...fixtureLedgerLine(), recordKind: 'failure' };
			assert.equal(isAcceptanceLedgerLine(line), false);
		});

		test('a zero line index is rejected (the 1-based idiom)', () => {
			const line = { ...fixtureLedgerLine(), line: 0 };
			assert.equal(isAcceptanceLedgerLine(line), false);
		});

		test('a non-member record kind is rejected', () => {
			const line = { ...fixtureLedgerLine(), recordKind: 'audit' };
			assert.equal(isAcceptanceLedgerLine(line), false);
		});

		test('empty canonical bytes are rejected', () => {
			const line = { ...fixtureLedgerLine(), canonicalBytes: '' };
			assert.equal(isAcceptanceLedgerLine(line), false);
		});

		test('an extra ledger-line field is rejected', () => {
			const line = { ...fixtureLedgerLine(), byteOffset: 12 };
			assert.equal(isAcceptanceLedgerLine(line), false);
		});
	});

	suite('serializeAcceptanceRecord (the canonical bytes law)', () => {
		test('the drill record bytes are deterministic across double runs', () => {
			assert.equal(serializeAcceptanceRecord(fixtureDrillRecord()), serializeAcceptanceRecord(fixtureDrillRecord()));
		});

		test('the bytes are key-order independent (a deep-shuffled record serializes byte-equal)', () => {
			assert.equal(serializeAcceptanceRecord(shuffleDeep(fixtureDrillRecord())), serializeAcceptanceRecord(fixtureDrillRecord()));
		});

		test('the failure evidence bytes are deterministic', () => {
			assert.equal(serializeAcceptanceRecord(fixtureFailureEvidence()), serializeAcceptanceRecord(fixtureFailureEvidence()));
			assert.equal(serializeAcceptanceRecord(shuffleDeep(fixtureFailureEvidence())), serializeAcceptanceRecord(fixtureFailureEvidence()));
		});

		test("the scope triple embeds the landed serializeCredentialScope key order verbatim", () => {
			const bytes = serializeAcceptanceRecord(fixtureDrillRecord());
			const parsed = JSON.parse(bytes) as Record<string, unknown>;
			assert.deepEqual(parsed['scope'], JSON.parse(serializeCredentialScope(fixtureScope())));
		});

		test('the payload views embed the landed serializePresentationRecord key order verbatim', () => {
			const bytes = serializeAcceptanceRecord(fixtureDrillRecord());
			const parsed = JSON.parse(bytes) as Record<string, unknown>;
			const payload = parsed['payload'] as Record<string, unknown>;
			assert.deepEqual(payload['provenanceView'], JSON.parse(serializePresentationRecord(fixtureProvenanceView())));
			assert.deepEqual(payload['capacityView'], JSON.parse(serializePresentationRecord(fixtureCapacityView())));
			assert.deepEqual(payload['resetExpectationView'], JSON.parse(serializePresentationRecord(fixtureResetExpectationView())));
			assert.deepEqual(payload['decisionView'], JSON.parse(serializePresentationRecord(fixtureDecisionView())));
		});

		test('the bytes round-trip: the parse admits under isDrillRecord', () => {
			const parsed = JSON.parse(serializeAcceptanceRecord(fixtureDrillRecord())) as unknown;
			assert.equal(isDrillRecord(parsed), true);
			assert.equal(serializeAcceptanceRecord(parsed), serializeAcceptanceRecord(fixtureDrillRecord()));
		});

		test('the failure bytes round-trip under isFailureEvidence', () => {
			const parsed = JSON.parse(serializeAcceptanceRecord(fixtureFailureEvidence())) as unknown;
			assert.equal(isFailureEvidence(parsed), true);
		});

		test('a non-record throws TypeError (no dishonest drill evidence ever gets canonical bytes)', () => {
			assert.throws(() => serializeAcceptanceRecord(null), TypeError);
			assert.throws(() => serializeAcceptanceRecord({ kind: 'drill' }), TypeError);
			assert.throws(() => serializeAcceptanceRecord('drill'), TypeError);
		});

		test('a malformed drill record throws TypeError', () => {
			const record = { ...fixtureDrillRecord(), evidenceLabel: 'promoted' };
			assert.throws(() => serializeAcceptanceRecord(record), TypeError);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every Date.now / Math.random / process.env hit in acceptanceContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/acceptanceContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in acceptanceKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/acceptanceKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
