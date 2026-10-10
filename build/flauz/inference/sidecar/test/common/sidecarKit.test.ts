/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-004 sidecar kit test suite (mocha tdd style, matching
 * build/flauz/inference/semantics/test/common/planSemantics.test.ts).
 *
 * Fixture policy: every sidecar id, provider id, model-scope label
 * and probe value below is SYNTHETIC (prefixed 'fixture.' or the
 * disclosed 'sidecar.' scope label) and is NOT an authority value.
 * Closed-vocabulary members (the one interface profile, the
 * verification states, the disclosed fixture ids) are the contract's
 * own values under test. Runtime-boundary probes are injected as
 * JSON-parsed values, the shape foreign input arrives in at a real
 * boundary.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID,
	FIXTURE_SIDECAR_KNOWN_QUOTA_ID,
	FIXTURE_SIDECAR_NO_STATE_ID,
	INFERENCE_SIDECAR_VERSION as KIT_INFERENCE_SIDECAR_VERSION,
	SIDECAR_CAPACITY_REPORT_SCOPE,
	SIDECAR_KIT_REJECTION_REASONS,
	createSidecarKit,
} from '../../common/sidecarKit.js';
import type { SidecarKit, SidecarKitAdmission } from '../../common/sidecarKit.js';
import {
	INFERENCE_SIDECAR_VERSION as CONTRACT_INFERENCE_SIDECAR_VERSION,
	SIDECAR_REJECTION_REASONS,
	admitSidecar,
	isSidecarRecord,
	serializeSidecarRecord,
} from '../../common/sidecarContract.js';
import type { SidecarRecord } from '../../common/sidecarContract.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	admitProvenance,
	cooldownActive,
	markProvenanceVerified,
	quotaWindowContains,
	unknownSnapshot,
} from '../../../semantics/common/capacityDisclosure.js';

const FIXTURE_CLOCK_EPOCH_MS = 1700000000000;
const FIXTURE_REGISTERED_AT_EPOCH_MS = 1700000000000;
const FIXTURE_NO_STATE_PROVIDER_ID = 'fixture.provider.gamma';
const FIXTURE_KNOWN_QUOTA_PROVIDER_ID = 'fixture.provider.alpha';
const FIXTURE_ACTIVE_COOLDOWN_PROVIDER_ID = 'fixture.provider.beta';

function fixedClock(): number {
	return FIXTURE_CLOCK_EPOCH_MS;
}

function sequencedClock(startEpochMs: number, stepMs: number): { now: () => number } {
	let current = startEpochMs;
	return {
		now: () => {
			const at = current;
			current += stepMs;
			return at;
		},
	};
}

function fixtureCandidate(sidecarId: string): Record<string, unknown> {
	return {
		sidecarId,
		providerId: 'fixture.provider.delta',
		interfaceProfile: 'freellmapi-compatible',
		optional: true,
		replaceable: true,
		metadataVerification: 'unverified',
		registeredAtEpochMs: FIXTURE_REGISTERED_AT_EPOCH_MS,
		contractVersion: CONTRACT_INFERENCE_SIDECAR_VERSION,
	};
}

function admittedKitRegistration(admission: SidecarKitAdmission): SidecarRecord {
	assert.equal(admission.kind, 'admitted', `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.record;
}

function rejectedKitReason(admission: SidecarKitAdmission): string {
	assert.equal(admission.kind, 'rejected', `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission.reason;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

function bytesOf(kit: SidecarKit): string {
	return kit.list().map((record) => serializeSidecarRecord(record)).join('\n');
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-004 sidecar kit', () => {

	suite('createSidecarKit (the fail-closed factory)', () => {
		test('throws TypeError when options is missing or not an object', () => {
			for (const bad of [undefined, null, 'fixture.options', 42, true]) {
				assert.throws(() => createSidecarKit(bad as any), TypeError);
			}
		});

		test('throws TypeError when now is not a function (the injected-clock law)', () => {
			assert.throws(() => createSidecarKit({} as any), TypeError);
			assert.throws(() => createSidecarKit({ now: 42 } as any), TypeError);
			assert.throws(() => createSidecarKit({ now: 'fixture.now' } as any), TypeError);
		});

		test('throws TypeError when the injected clock cannot produce an admittable registration time', () => {
			assert.throws(() => createSidecarKit({ now: () => NaN }), TypeError);
			assert.throws(() => createSidecarKit({ now: () => Infinity }), TypeError);
			assert.throws(() => createSidecarKit({ now: () => -1 }), TypeError);
		});

		test('a fixed finite clock creates the kit without throwing', () => {
			assert.equal(typeof createSidecarKit({ now: fixedClock }), 'object');
		});
	});

	suite('the ready-made fixture sidecars (disclosed)', () => {
		test('a fresh kit carries exactly the three fixture sidecars', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.count(), 3);
			assert.deepEqual(
				kit.list().map((record) => record.sidecarId),
				[
					FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID,
					FIXTURE_SIDECAR_KNOWN_QUOTA_ID,
					FIXTURE_SIDECAR_NO_STATE_ID,
				],
			);
		});

		test('every fixture id is fixture.-prefixed (the evidence label)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(record.sidecarId.startsWith('fixture.'), true);
			}
		});

		test('every fixture record satisfies isSidecarRecord (fixtures are ordinary admitted records)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(isSidecarRecord(record), true);
			}
		});

		test('every fixture is freellmapi-compatible, optional and replaceable by construction', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(record.interfaceProfile, 'freellmapi-compatible');
				assert.equal(record.optional, true);
				assert.equal(record.replaceable, true);
			}
		});

		test('every fixture defaults to unverified metadata (the unverified-default law)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(record.metadataVerification, 'unverified');
			}
		});

		test('fixture registration stamps the injected clock time (the injected-clock law)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(record.registeredAtEpochMs, FIXTURE_CLOCK_EPOCH_MS);
			}
		});

		test('each fixture serves its own disclosed synthetic provider', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.find(FIXTURE_SIDECAR_KNOWN_QUOTA_ID)?.providerId, FIXTURE_KNOWN_QUOTA_PROVIDER_ID);
			assert.equal(kit.find(FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID)?.providerId, FIXTURE_ACTIVE_COOLDOWN_PROVIDER_ID);
			assert.equal(kit.find(FIXTURE_SIDECAR_NO_STATE_ID)?.providerId, FIXTURE_NO_STATE_PROVIDER_ID);
		});
	});

	suite('register', () => {
		test('admits an honest candidate through the contract guard', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const record = admittedKitRegistration(kit.register(fixtureCandidate('fixture.sidecar.delta')));
			assert.equal(record.sidecarId, 'fixture.sidecar.delta');
			assert.equal(kit.count(), 4);
			assert.deepEqual(kit.find('fixture.sidecar.delta'), record);
		});

		test('the admitted record is carried verbatim (deep-equal to the contract guard output)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const candidate = fixtureCandidate('fixture.sidecar.delta');
			const kitRecord = admittedKitRegistration(kit.register(candidate));
			const contractRecord = admitSidecar(candidate);
			assert.equal(contractRecord.kind, 'admitted');
			assert.deepEqual(kitRecord, contractRecord.record);
		});

		test('a JSON-parsed boundary probe registers (foreign input, the arrival shape)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const probe = foreign(JSON.stringify(fixtureCandidate('fixture.sidecar.epsilon')));
			assert.equal(kit.register(probe).kind, 'admitted');
		});

		test('a duplicate sidecarId is rejected with the documented sidecar-id-duplicate reason', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.register(fixtureCandidate('fixture.sidecar.delta')).kind, 'admitted');
			assert.equal(rejectedKitReason(kit.register(fixtureCandidate('fixture.sidecar.delta'))), 'sidecar-id-duplicate');
		});

		test('a duplicate under a different provider id is still a duplicate (uniqueness is on sidecarId)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.register(fixtureCandidate('fixture.sidecar.delta')).kind, 'admitted');
			const otherProvider = { ...fixtureCandidate('fixture.sidecar.delta'), providerId: 'fixture.provider.zeta' };
			assert.equal(rejectedKitReason(kit.register(otherProvider)), 'sidecar-id-duplicate');
		});

		test('a duplicate registration leaves the kit unchanged (never a silent overwrite)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const original = admittedKitRegistration(kit.register(fixtureCandidate('fixture.sidecar.delta')));
			kit.register(fixtureCandidate('fixture.sidecar.delta'));
			assert.equal(kit.count(), 4);
			assert.deepEqual(kit.find('fixture.sidecar.delta'), original);
		});

		test('the contract guard runs first: a malformed duplicate reports the contract reason, not the duplicate', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.register(fixtureCandidate('fixture.sidecar.delta')).kind, 'admitted');
			const malformedDuplicate = { ...fixtureCandidate('fixture.sidecar.delta'), optional: false };
			assert.equal(rejectedKitReason(kit.register(malformedDuplicate)), 'sidecar-not-optional');
		});

		test('every contract rejection passes through register verbatim', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(rejectedKitReason(kit.register(null)), 'not-an-object');
			assert.equal(rejectedKitReason(kit.register(fixtureCandidate(''))), 'sidecar-id-empty');
			assert.equal(
				rejectedKitReason(kit.register({ ...fixtureCandidate('fixture.sidecar.delta'), replaceable: false })),
				'sidecar-not-replaceable',
			);
			assert.equal(
				rejectedKitReason(kit.register({ ...fixtureCandidate('fixture.sidecar.delta'), contractVersion: '9.9.9' })),
				'contract-version-mismatch',
			);
		});

		test('a rejected registration never inflates the count', () => {
			const kit = createSidecarKit({ now: fixedClock });
			kit.register(null);
			kit.register(fixtureCandidate(''));
			kit.register({ ...fixtureCandidate('fixture.sidecar.delta'), optional: 'true' });
			assert.equal(kit.count(), 3);
		});
	});

	suite('list / find / count', () => {
		test('list is sorted by sidecarId', () => {
			const kit = createSidecarKit({ now: fixedClock });
			kit.register(fixtureCandidate('fixture.sidecar.zulu'));
			kit.register(fixtureCandidate('fixture.sidecar.aaa'));
			assert.deepEqual(
				kit.list().map((record) => record.sidecarId),
				[
					'fixture.sidecar.aaa',
					FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID,
					FIXTURE_SIDECAR_KNOWN_QUOTA_ID,
					FIXTURE_SIDECAR_NO_STATE_ID,
					'fixture.sidecar.zulu',
				],
			);
		});

		test('list is stable across repeated calls', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.deepEqual(kit.list(), kit.list());
		});

		test('list returns a fresh copy: the caller cannot mutate kit state through it', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const expected = kit.list().map((record) => record.sidecarId);
			(kit.list() as SidecarRecord[]).pop();
			assert.deepEqual(
				kit.list().map((record) => record.sidecarId),
				expected,
			);
			assert.equal(kit.count(), 3);
		});

		test('find returns the record for a registered id and undefined on a miss', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.find(FIXTURE_SIDECAR_KNOWN_QUOTA_ID)?.sidecarId, FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.equal(kit.find('fixture.sidecar.missing'), undefined);
			assert.equal(kit.find(''), undefined);
		});

		test('count tracks registrations and duplicates never inflate it', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.count(), 3);
			kit.register(fixtureCandidate('fixture.sidecar.delta'));
			assert.equal(kit.count(), 4);
			kit.register(fixtureCandidate('fixture.sidecar.delta'));
			assert.equal(kit.count(), 4);
		});
	});

	suite('reportSnapshot (THE HONEST-DEFAULT LAW)', () => {
		test('an unknown id returns undefined (fail-closed miss, never a fabricated snapshot)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.reportSnapshot('fixture.sidecar.missing'), undefined);
			assert.equal(kit.reportSnapshot(''), undefined);
		});

		test('a sidecar with NO attached state reports the landed unknownSnapshot (never fabricated healthy)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID);
			assert.deepEqual(snapshot, unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, FIXTURE_CLOCK_EPOCH_MS));
		});

		test('the honest default carries every unknown state first-class', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID);
			assert.equal(snapshot?.health, 'unknown');
			assert.deepEqual(snapshot?.quota, { state: 'unknown' });
			assert.deepEqual(snapshot?.cooldown, { state: 'none' });
			assert.deepEqual(snapshot?.resetSchedule, { kind: 'unknown' });
			assert.equal(snapshot?.verification, 'unverified');
		});

		test('the honest default stamps the semantics family version (distinct-role stamping)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID);
			assert.equal(snapshot?.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			for (const record of kit.list()) {
				assert.equal(record.contractVersion, CONTRACT_INFERENCE_SIDECAR_VERSION);
			}
		});

		test('the known-quota fixture reports its deterministic known quota', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.equal(snapshot?.health, 'healthy');
			assert.equal(snapshot?.quota.state, 'known');
			if (snapshot?.quota.state === 'known') {
				assert.equal(snapshot.quota.remaining, 42);
				assert.equal(snapshot.quota.limit, 100);
				assert.equal(quotaWindowContains(snapshot.quota.window, FIXTURE_CLOCK_EPOCH_MS), true);
			}
		});

		test('the known-quota fixture rides the landed unknownSnapshot base (verification stays unverified)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.equal(snapshot?.providerId, FIXTURE_KNOWN_QUOTA_PROVIDER_ID);
			assert.equal(snapshot?.verification, 'unverified');
			assert.equal(snapshot?.observedAtEpochMs, FIXTURE_CLOCK_EPOCH_MS);
		});

		test('the active-cooldown fixture reports its deterministic active cooldown', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID);
			assert.equal(snapshot?.health, 'cooldown');
			assert.equal(snapshot?.cooldown.state, 'active');
			if (snapshot?.cooldown.state === 'active') {
				assert.equal(snapshot.cooldown.reason, 'rate-limited');
				assert.equal(snapshot.cooldown.sinceEpochMs, FIXTURE_CLOCK_EPOCH_MS - 60000);
				assert.equal(snapshot.cooldown.untilEpochMs, FIXTURE_CLOCK_EPOCH_MS + 60000);
				assert.equal(cooldownActive(snapshot.cooldown, FIXTURE_CLOCK_EPOCH_MS), true);
			}
		});

		test('the active-cooldown fixture keeps its quota honestly unknown (the base default)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const snapshot = kit.reportSnapshot(FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID);
			assert.deepEqual(snapshot?.quota, { state: 'unknown' });
		});

		test('the fixtures are deterministic: the same clock yields byte-equal snapshots across calls', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const sidecarId of [
				FIXTURE_SIDECAR_KNOWN_QUOTA_ID,
				FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID,
				FIXTURE_SIDECAR_NO_STATE_ID,
			]) {
				assert.deepEqual(kit.reportSnapshot(sidecarId), kit.reportSnapshot(sidecarId));
			}
		});

		test('the injected clock drives observedAtEpochMs: advancing the clock advances the report', () => {
			const clock = sequencedClock(1700000000000, 1000);
			const kit = createSidecarKit({ now: clock.now });
			assert.equal(kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID)?.observedAtEpochMs, 1700000001000);
			assert.equal(kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID)?.observedAtEpochMs, 1700000002000);
		});

		test('attachFixtureState attaches a state source that then reports', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const attached = kit.attachFixtureState(
				FIXTURE_SIDECAR_NO_STATE_ID,
				(atEpochMs: number) => unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, atEpochMs),
			);
			assert.equal(attached, true);
			assert.deepEqual(
				kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID),
				unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, FIXTURE_CLOCK_EPOCH_MS),
			);
		});

		test('attachFixtureState returns false for an unknown id and never mutates the kit', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(
				kit.attachFixtureState(
					'fixture.sidecar.missing',
					(atEpochMs: number) => unknownSnapshot('fixture.provider.missing', atEpochMs),
				),
				false,
			);
			assert.equal(kit.count(), 3);
			assert.equal(kit.reportSnapshot('fixture.sidecar.missing'), undefined);
		});

		test('attachFixtureState replaces a previous attachment (last attach wins)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(
				kit.attachFixtureState(
					FIXTURE_SIDECAR_NO_STATE_ID,
					(atEpochMs: number) => ({
						...unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, atEpochMs),
						health: 'degraded',
					}),
				),
				true,
			);
			assert.equal(
				kit.attachFixtureState(
					FIXTURE_SIDECAR_NO_STATE_ID,
					(atEpochMs: number) => unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, atEpochMs),
				),
				true,
			);
			assert.equal(kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID)?.health, 'unknown');
		});

		test('attachFixtureState throws TypeError on a non-function source (fail-closed)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.throws(() => kit.attachFixtureState(FIXTURE_SIDECAR_NO_STATE_ID, 42 as any), TypeError);
			assert.throws(() => kit.attachFixtureState(FIXTURE_SIDECAR_NO_STATE_ID, undefined as any), TypeError);
		});

		test('a malformed attached state fails closed with a TypeError, never a silent default', () => {
			const kit = createSidecarKit({ now: fixedClock });
			kit.attachFixtureState(FIXTURE_SIDECAR_NO_STATE_ID, (atEpochMs: number) => ({
				...unknownSnapshot(FIXTURE_NO_STATE_PROVIDER_ID, atEpochMs),
				health: 'not-a-state',
			}) as any);
			assert.throws(() => kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID), TypeError);
		});

		test('a misattributed attached snapshot fails closed (no dangling attribution)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			kit.attachFixtureState(
				FIXTURE_SIDECAR_NO_STATE_ID,
				(atEpochMs: number) => unknownSnapshot('fixture.provider.other', atEpochMs),
			);
			assert.throws(() => kit.reportSnapshot(FIXTURE_SIDECAR_NO_STATE_ID), TypeError);
		});
	});

	suite('provenanceOf (the delegated provenance laws)', () => {
		test('an unknown id returns undefined', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.equal(kit.provenanceOf('fixture.sidecar.missing'), undefined);
			assert.equal(kit.provenanceOf(''), undefined);
		});

		test('the default provenance is unverified by construction', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(kit.provenanceOf(record.sidecarId)?.modelVerification, 'unverified');
			}
		});

		test('the default provenance names the sidecar provider with no substitution', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				const provenance = kit.provenanceOf(record.sidecarId);
				assert.equal(provenance?.requestedProviderId, record.providerId);
				assert.equal(provenance?.actualProviderId, record.providerId);
				assert.equal(provenance?.substitution, 'none');
			}
		});

		test('the model fields carry the disclosed scope label (a scope label, never a model claim)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.equal(provenance?.requestedModelId, SIDECAR_CAPACITY_REPORT_SCOPE);
			assert.equal(provenance?.actualModelId, SIDECAR_CAPACITY_REPORT_SCOPE);
		});

		test('the default provenance satisfies the landed admitProvenance guard', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			const admission = admitProvenance(provenance);
			assert.equal(admission.admitted, true);
		});

		test('the default provenance stamps the semantics version and the injected clock time', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.equal(provenance?.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			assert.equal(provenance?.recordedAtEpochMs, FIXTURE_CLOCK_EPOCH_MS);
		});

		test('the one-way promotion is delegated to the landed markProvenanceVerified and preserves every other field', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.ok(provenance);
			const promoted = markProvenanceVerified(provenance);
			assert.equal(promoted.modelVerification, 'verified');
			assert.deepEqual({ ...promoted, modelVerification: provenance.modelVerification }, provenance);
		});

		test('the promotion is idempotent (a verified provenance stays verified)', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID);
			assert.ok(provenance);
			assert.equal(markProvenanceVerified(markProvenanceVerified(provenance)).modelVerification, 'verified');
		});

		test('the kit never self-promotes: provenanceOf stays unverified after an external promotion', () => {
			const kit = createSidecarKit({ now: fixedClock });
			const provenance = kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID);
			assert.ok(provenance);
			markProvenanceVerified(provenance);
			assert.equal(kit.provenanceOf(FIXTURE_SIDECAR_KNOWN_QUOTA_ID)?.modelVerification, 'unverified');
		});

		test('provenanceOf is a pure derivation: the same clock yields deep-equal provenance across calls', () => {
			const kit = createSidecarKit({ now: fixedClock });
			assert.deepEqual(
				kit.provenanceOf(FIXTURE_SIDECAR_NO_STATE_ID),
				kit.provenanceOf(FIXTURE_SIDECAR_NO_STATE_ID),
			);
		});

		test('the injected clock drives recordedAtEpochMs: advancing the clock advances the provenance', () => {
			const clock = sequencedClock(1700000000000, 1000);
			const kit = createSidecarKit({ now: clock.now });
			assert.equal(kit.provenanceOf(FIXTURE_SIDECAR_NO_STATE_ID)?.recordedAtEpochMs, 1700000001000);
			assert.equal(kit.provenanceOf(FIXTURE_SIDECAR_NO_STATE_ID)?.recordedAtEpochMs, 1700000002000);
		});
	});

	suite('version stamping across both module copies (COMMAND_FACADE)', () => {
		test('both INFERENCE_SIDECAR_VERSION copies are 1.0.0 and equal', () => {
			assert.equal(CONTRACT_INFERENCE_SIDECAR_VERSION, '1.0.0');
			assert.equal(KIT_INFERENCE_SIDECAR_VERSION, '1.0.0');
			assert.equal(CONTRACT_INFERENCE_SIDECAR_VERSION, KIT_INFERENCE_SIDECAR_VERSION);
		});

		test('every kit record stamps the sidecar version', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(record.contractVersion, CONTRACT_INFERENCE_SIDECAR_VERSION);
			}
		});

		test('the kit rejection vocabulary extends the contract list with exactly the documented duplicate reason', () => {
			assert.deepEqual(SIDECAR_KIT_REJECTION_REASONS, [
				...SIDECAR_REJECTION_REASONS,
				'sidecar-id-duplicate',
			]);
			assert.equal(new Set(SIDECAR_KIT_REJECTION_REASONS).size, SIDECAR_KIT_REJECTION_REASONS.length);
			assert.equal(
				(SIDECAR_KIT_REJECTION_REASONS as readonly string[]).includes('sidecar-id-duplicate'),
				true,
			);
		});
	});

	suite('canonical bytes over kit state', () => {
		test('serializeSidecarRecord double-run byte-equal over every kit record', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const record of kit.list()) {
				assert.equal(serializeSidecarRecord(record), serializeSidecarRecord(record));
			}
		});

		test('two kits on the same fixed clock serialize byte-equal fixture lists', () => {
			const kitA = createSidecarKit({ now: fixedClock });
			const kitB = createSidecarKit({ now: fixedClock });
			assert.equal(bytesOf(kitA), bytesOf(kitB));
		});

		test('a registered honest candidate serializes byte-equal through both kits', () => {
			const kitA = createSidecarKit({ now: fixedClock });
			const kitB = createSidecarKit({ now: fixedClock });
			kitA.register(fixtureCandidate('fixture.sidecar.delta'));
			kitB.register(fixtureCandidate('fixture.sidecar.delta'));
			assert.equal(bytesOf(kitA), bytesOf(kitB));
			assert.equal(bytesOf(kitA).includes('"sidecarId":"fixture.sidecar.delta"'), true);
		});

		test('the kit bytes carry the version stamp on every record', () => {
			const kit = createSidecarKit({ now: fixedClock });
			for (const line of bytesOf(kit).split('\n')) {
				assert.equal(line.includes(`"contractVersion":"${CONTRACT_INFERENCE_SIDECAR_VERSION}"`), true);
			}
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in sidecarKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/sidecarKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in sidecarContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/sidecarContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
