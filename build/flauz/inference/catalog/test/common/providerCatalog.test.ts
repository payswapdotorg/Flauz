/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-002 provider catalog test suite (mocha tdd style, matching
 * build/flauz/inference/semantics/test/common/planSemantics.test.ts).
 *
 * Fixture policy: every entry id, plan id, catalog id and probe
 * value below is SYNTHETIC (prefixed 'fixture.') and is NOT an
 * authority value - no real provider, endpoint or key is named
 * anywhere in this suite. Closed-vocabulary members (term states,
 * provenance classes, verification states) are the contract's own
 * values under test. Runtime-boundary probes are injected as
 * JSON-parsed values, the shape foreign input arrives in at a real
 * boundary.
 */
import { strict as assert } from 'node:assert';
import {
	CATALOG_ENTRY_REJECTION_REASONS,
	CATALOG_RECORD_REJECTION_REASONS,
	INFERENCE_CATALOG_VERSION,
	PROVIDER_TERM_STATES,
	admitCatalogEntry,
	admitCatalogRecord,
	catalogIndexById,
	isProviderCatalogEntry,
	isProviderCatalogRecord,
	markEntryMetadataVerified,
	serializeCatalogEntry,
	serializeCatalogRecord,
	unknownCapacityEntry,
} from '../../common/providerCatalog.js';
import type {
	CatalogEntryAdmission,
	CatalogEntryRejected,
	CatalogRecordAdmission,
	CatalogRecordRejected,
	ProviderCatalogEntry,
	ProviderCatalogRecord,
} from '../../common/providerCatalog.js';
import {
	CAPACITY_PROVENANCES,
	FLAUZ_PLAN_TIERS,
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	planSemanticsForTier,
} from '../../../semantics/common/planSemantics.js';
import type { FlauzPlanTier, PlanSemanticsRecord } from '../../../semantics/common/planSemantics.js';
import { unknownSnapshot } from '../../../semantics/common/capacityDisclosure.js';
import type { ProviderCapacitySnapshot } from '../../../semantics/common/capacityDisclosure.js';

const FIXTURE_ENTRY_ALPHA = 'fixture.entry.alpha';
const FIXTURE_ENTRY_BETA = 'fixture.entry.beta';
const FIXTURE_CATALOG_ID = 'fixture.catalog.main';
const FIXTURE_PLAN_ID = 'fixture.plan.alpha';
const FIXTURE_DISPLAY_NAME = 'Fixture Entry Alpha';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_START_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_LENGTH_MS = 60_000;

function fixtureClaim(tier: FlauzPlanTier = 'free', planId: string = FIXTURE_PLAN_ID): PlanSemanticsRecord {
	return planSemanticsForTier(tier, planId);
}

function fixtureKnownSnapshot(providerId: string): ProviderCapacitySnapshot {
	return {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		providerId,
		verification: 'unverified',
		health: 'healthy',
		quota: {
			state: 'known',
			remaining: 42,
			limit: 60,
			window: {
				kind: 'fixed',
				windowStartEpochMs: FIXTURE_WINDOW_START_MS,
				windowLengthMs: FIXTURE_WINDOW_LENGTH_MS,
			},
		},
		cooldown: { state: 'none' },
		resetSchedule: {
			kind: 'interval-aligned',
			anchorEpochMs: FIXTURE_WINDOW_START_MS,
			intervalMs: FIXTURE_WINDOW_LENGTH_MS,
		},
		observedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureEntry(entryId: string = FIXTURE_ENTRY_ALPHA): ProviderCatalogEntry {
	return {
		entryId,
		displayName: FIXTURE_DISPLAY_NAME,
		providerClass: 'third-party-free-tier',
		planClaims: [fixtureClaim('free')],
		capacitySnapshot: fixtureKnownSnapshot(entryId),
		metadataVerification: 'unverified',
		termsState: 'unknown',
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

/** Runtime-boundary probe helper: candidate with overrides, the shape foreign input arrives in. */
function entryWith(overrides: Record<string, unknown>): unknown {
	return { ...fixtureEntry(), ...overrides };
}

function fixtureRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), fixtureEntry(FIXTURE_ENTRY_BETA)],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function rejectedEntry(admission: CatalogEntryAdmission): CatalogEntryRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as CatalogEntryRejected;
}

function admittedEntry(admission: CatalogEntryAdmission): ProviderCatalogEntry {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.entry;
}

function rejectedRecord(admission: CatalogRecordAdmission): CatalogRecordRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as CatalogRecordRejected;
}

function admittedRecord(admission: CatalogRecordAdmission): ProviderCatalogRecord {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.record;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

suite('INF-002 provider catalog', () => {

	suite('constants and closed lists', () => {
		test('the catalog contract version is 1.0.0', () => {
			assert.equal(INFERENCE_CATALOG_VERSION, '1.0.0');
		});

		test('provider term states are the closed unknown/permitted/prohibited list', () => {
			assert.deepEqual(PROVIDER_TERM_STATES, ['unknown', 'permitted', 'prohibited']);
		});

		test('the rejection vocabularies are closed, non-empty and duplicate-free', () => {
			for (const list of [CATALOG_ENTRY_REJECTION_REASONS, CATALOG_RECORD_REJECTION_REASONS]) {
				assert.equal(list.length > 0, true);
				assert.equal(new Set(list).size, list.length);
			}
		});

		test('an admitted entry carries the catalog stamp while its snapshot and claims carry the semantics stamp', () => {
			const entry = admittedEntry(admitCatalogEntry(fixtureEntry()));
			assert.equal(entry.contractVersion, INFERENCE_CATALOG_VERSION);
			assert.equal(entry.capacitySnapshot.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			assert.equal(entry.planClaims[0].contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});

		test('every capacity provenance class is a legal provider class', () => {
			for (const providerClass of CAPACITY_PROVENANCES) {
				const admission = admitCatalogEntry(entryWith({ providerClass }));
				assert.equal(admission.admitted, true, `class '${providerClass}' must be admitted`);
				assert.equal(admittedEntry(admission).providerClass, providerClass);
			}
		});
	});

	suite('unknownCapacityEntry (the honest default constructor)', () => {
		test('derives the all-unknown honest default entry', () => {
			const entry = unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', FIXTURE_NOW_MS);
			assert.equal(entry.metadataVerification, 'unverified');
			assert.equal(entry.termsState, 'unknown');
			assert.deepEqual(entry.planClaims, []);
			assert.equal(entry.capacitySnapshot.health, 'unknown');
			assert.equal(entry.capacitySnapshot.quota.state, 'unknown');
			assert.equal(entry.capacitySnapshot.resetSchedule.kind, 'unknown');
		});

		test('rides the semantics family unknownSnapshot for the capacity snapshot', () => {
			const entry = unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'user-owned-endpoint', FIXTURE_NOW_MS);
			assert.deepEqual(entry.capacitySnapshot, unknownSnapshot(FIXTURE_ENTRY_ALPHA, FIXTURE_NOW_MS));
		});

		test('the entryId is the honest default displayName (never an invented label)', () => {
			const entry = unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'third-party-free-tier', FIXTURE_NOW_MS);
			assert.equal(entry.displayName, FIXTURE_ENTRY_ALPHA);
		});

		test('stamps the catalog contract version', () => {
			const entry = unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', FIXTURE_NOW_MS);
			assert.equal(entry.contractVersion, INFERENCE_CATALOG_VERSION);
		});

		test('the derived entry is admitted by the catalog guard and the shape predicate', () => {
			for (const providerClass of CAPACITY_PROVENANCES) {
				const entry = unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, providerClass, FIXTURE_NOW_MS);
				assert.equal(admitCatalogEntry(entry).admitted, true);
				assert.equal(isProviderCatalogEntry(entry), true);
			}
		});

		test('throws TypeError on an empty or non-string entry id', () => {
			assert.throws(() => unknownCapacityEntry('', 'flauz-provisioned', FIXTURE_NOW_MS), TypeError);
			assert.throws(() => unknownCapacityEntry(foreign('42'), 'flauz-provisioned', FIXTURE_NOW_MS), TypeError);
		});

		test('throws TypeError on an unknown provider class', () => {
			assert.throws(
				() => unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, foreign('"fixture.class.moon"'), FIXTURE_NOW_MS),
				TypeError,
			);
		});

		test('throws TypeError on a non-finite observed timestamp', () => {
			assert.throws(() => unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', foreign('null')), TypeError);
			assert.throws(
				() => unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', Number.NaN),
				TypeError,
			);
		});

		test('double construction is byte-equal (determinism)', () => {
			const first = serializeCatalogEntry(unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', FIXTURE_NOW_MS));
			const second = serializeCatalogEntry(unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', FIXTURE_NOW_MS));
			assert.equal(first, second);
		});
	});

	suite('admitCatalogEntry rejections (every path)', () => {
		test('rejects non-objects: null, undefined, string, number, boolean', () => {
			for (const candidate of [null, undefined, 'fixture.string', 42, true]) {
				const rejection = rejectedEntry(admitCatalogEntry(candidate));
				assert.equal(rejection.reason, 'not-an-object');
			}
		});

		test('rejects a contract-version mismatch (wrong value and missing key)', () => {
			assert.equal(
				rejectedEntry(admitCatalogEntry(entryWith({ contractVersion: '0.9.9' }))).reason,
				'version-mismatch',
			);
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.contractVersion;
			assert.equal(rejectedEntry(admitCatalogEntry(missing)).reason, 'version-mismatch');
		});

		test('rejects a missing, empty or non-string entry id', () => {
			assert.equal(rejectedEntry(admitCatalogEntry(entryWith({ entryId: '' }))).reason, 'invalid-entry-id');
			assert.equal(rejectedEntry(admitCatalogEntry(entryWith({ entryId: 42 }))).reason, 'invalid-entry-id');
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.entryId;
			assert.equal(rejectedEntry(admitCatalogEntry(missing)).reason, 'invalid-entry-id');
		});

		test('rejects a missing, empty or non-string display name', () => {
			assert.equal(rejectedEntry(admitCatalogEntry(entryWith({ displayName: '' }))).reason, 'invalid-display-name');
			assert.equal(rejectedEntry(admitCatalogEntry(entryWith({ displayName: foreign('null') }))).reason, 'invalid-display-name');
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.displayName;
			assert.equal(rejectedEntry(admitCatalogEntry(missing)).reason, 'invalid-display-name');
		});

		test('rejects an unknown provider class (foreign value and missing key)', () => {
			assert.equal(
				rejectedEntry(admitCatalogEntry(entryWith({ providerClass: 'fixture.class.moon' }))).reason,
				'unknown-provider-class',
			);
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.providerClass;
			assert.equal(rejectedEntry(admitCatalogEntry(missing)).reason, 'unknown-provider-class');
		});

		test('rejects non-array plan claims', () => {
			for (const planClaims of [foreign('null'), 'fixture.claims', 42, { length: 0 }]) {
				assert.equal(
					rejectedEntry(admitCatalogEntry(entryWith({ planClaims }))).reason,
					'invalid-plan-claims',
				);
			}
		});

		test('rejects a non-object plan claim, citing the honest-promise reason verbatim', () => {
			const rejection = rejectedEntry(admitCatalogEntry(entryWith({ planClaims: [foreign('42')] })));
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes("planClaims[0]"), true);
			assert.equal(rejection.detail.includes("'not-an-object'"), true);
		});

		test('rejects a plan claim stamped with the wrong contract version, citing it verbatim', () => {
			const claim = { ...fixtureClaim('free'), contractVersion: '0.9.9' };
			const rejection = rejectedEntry(admitCatalogEntry(entryWith({ planClaims: [claim] })));
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes("'version-mismatch'"), true);
		});

		test('rejects the lie: a plan claim carrying the unlimited guarantee (the promise-split law)', () => {
			const claim = {
				...fixtureClaim('free'),
				providerCapacityClaim: { ...fixtureClaim('free').providerCapacityClaim, guarantee: 'unlimited' },
			};
			const rejection = rejectedEntry(admitCatalogEntry(entryWith({ planClaims: [claim] })));
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes("'unlimited-provider-capacity'"), true);
			assert.equal(
				rejection.detail.includes('a provider capacity claim may never carry the unlimited guarantee'),
				true,
			);
		});

		test('rejects a claim whose capacity guarantee is not provider-dependent, citing the guard reason', () => {
			const claim = {
				...fixtureClaim('free'),
				providerCapacityClaim: {
					...fixtureClaim('free').providerCapacityClaim,
					guarantee: 'fixture.guarantee.bounded',
				},
			};
			const rejection = rejectedEntry(admitCatalogEntry(entryWith({ planClaims: [claim] })));
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes("'invalid-provider-claim'"), true);
		});

		test('rejects a plan claim with an unknown tier, citing the guard reason', () => {
			const claim = { ...fixtureClaim('free'), tier: 'fixture.tier.enterprise' };
			const rejection = rejectedEntry(admitCatalogEntry(entryWith({ planClaims: [claim] })));
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes("'unknown-tier'"), true);
		});

		test('surfaces the FIRST offending claim index', () => {
			const lie = {
				...fixtureClaim('provisioned'),
				providerCapacityClaim: { ...fixtureClaim('provisioned').providerCapacityClaim, guarantee: 'unlimited' },
			};
			const rejection = rejectedEntry(
				admitCatalogEntry(entryWith({ planClaims: [fixtureClaim('free'), lie] })),
			);
			assert.equal(rejection.reason, 'dishonest-plan-claim');
			assert.equal(rejection.detail.includes('planClaims[1]'), true);
		});

		test('rejects a missing capacity snapshot (a snapshot without provenance)', () => {
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.capacitySnapshot;
			const rejection = rejectedEntry(admitCatalogEntry(missing));
			assert.equal(rejection.reason, 'invalid-capacity-snapshot');
			assert.equal(rejection.detail.includes('isProviderCapacitySnapshot'), true);
		});

		test('rejects a snapshot failing the disclosure shape guard (no attribution, wrong version, bad time)', () => {
			const snapshot = fixtureKnownSnapshot(FIXTURE_ENTRY_ALPHA) as unknown as Record<string, unknown>;
			const noProviderId = { ...snapshot };
			delete noProviderId.providerId;
			const wrongVersion = { ...snapshot, contractVersion: '0.9.9' };
			const badTime = { ...snapshot, observedAtEpochMs: foreign('null') };
			for (const candidate of [foreign('null'), noProviderId, wrongVersion, badTime]) {
				assert.equal(
					rejectedEntry(admitCatalogEntry(entryWith({ capacitySnapshot: candidate }))).reason,
					'invalid-capacity-snapshot',
				);
			}
		});

		test('rejects an invalid metadata verification state (null and foreign values)', () => {
			for (const metadataVerification of [foreign('null'), 'maybe', 42]) {
				assert.equal(
					rejectedEntry(admitCatalogEntry(entryWith({ metadataVerification }))).reason,
					'invalid-metadata-verification',
				);
			}
		});

		test('rejects an invalid terms state (null and foreign values)', () => {
			for (const termsState of [foreign('null'), 'fixture.terms.maybe', 42]) {
				assert.equal(
					rejectedEntry(admitCatalogEntry(entryWith({ termsState }))).reason,
					'invalid-terms-state',
				);
			}
		});
	});

	suite('honest-state defaults and acceptance', () => {
		test('metadataVerification defaults to unverified when absent', () => {
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.metadataVerification;
			const entry = admittedEntry(admitCatalogEntry(missing));
			assert.equal(entry.metadataVerification, 'unverified');
			const explicitAbsent = entryWith({ metadataVerification: undefined });
			assert.equal(admittedEntry(admitCatalogEntry(explicitAbsent)).metadataVerification, 'unverified');
		});

		test('termsState defaults to unknown when absent (permission is never assumed)', () => {
			const missing = fixtureEntry() as unknown as Record<string, unknown>;
			delete missing.termsState;
			const entry = admittedEntry(admitCatalogEntry(missing));
			assert.equal(entry.termsState, 'unknown');
			const explicitAbsent = entryWith({ termsState: undefined });
			assert.equal(admittedEntry(admitCatalogEntry(explicitAbsent)).termsState, 'unknown');
		});

		test('explicit verification and terms states are carried verbatim', () => {
			const verified = admittedEntry(admitCatalogEntry(entryWith({ metadataVerification: 'verified' })));
			assert.equal(verified.metadataVerification, 'verified');
			const permitted = admittedEntry(admitCatalogEntry(entryWith({ termsState: 'permitted' })));
			assert.equal(permitted.termsState, 'permitted');
			const prohibited = admittedEntry(admitCatalogEntry(entryWith({ termsState: 'prohibited' })));
			assert.equal(prohibited.termsState, 'prohibited');
		});

		test('admits a full entry and returns the canonical record', () => {
			const entry = admittedEntry(admitCatalogEntry(fixtureEntry()));
			assert.deepEqual(entry, fixtureEntry());
		});

		test('admitted plan claims are the honest-promise canonical records', () => {
			const claims = [fixtureClaim('free'), fixtureClaim('self-hosted')];
			const entry = admittedEntry(admitCatalogEntry(entryWith({ planClaims: claims })));
			assert.deepEqual(entry.planClaims, claims);
			for (const claim of entry.planClaims) {
				assert.equal(claim.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			}
		});

		test('an empty plan-claims array is admitted (honest no-claims)', () => {
			const entry = admittedEntry(admitCatalogEntry(entryWith({ planClaims: [] })));
			assert.deepEqual(entry.planClaims, []);
		});

		test('admission never mutates the candidate', () => {
			const candidate = fixtureEntry();
			const before = JSON.stringify(candidate);
			admitCatalogEntry(candidate);
			isProviderCatalogEntry(candidate);
			serializeCatalogEntry(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('markEntryMetadataVerified (the one-way promotion)', () => {
		test('promotes unverified to verified', () => {
			const promoted = markEntryMetadataVerified(fixtureEntry());
			assert.equal(promoted.metadataVerification, 'verified');
		});

		test('an already-verified entry stays verified (idempotent)', () => {
			const once = markEntryMetadataVerified(fixtureEntry());
			const twice = markEntryMetadataVerified(once);
			assert.equal(twice.metadataVerification, 'verified');
		});

		test('preserves every other field verbatim (verification never rewrites terms)', () => {
			const source = admittedEntry(admitCatalogEntry(entryWith({ termsState: 'permitted' })));
			const promoted = markEntryMetadataVerified(source);
			assert.equal(promoted.entryId, source.entryId);
			assert.equal(promoted.displayName, source.displayName);
			assert.equal(promoted.providerClass, source.providerClass);
			assert.deepEqual(promoted.planClaims, source.planClaims);
			assert.deepEqual(promoted.capacitySnapshot, source.capacitySnapshot);
			assert.equal(promoted.termsState, 'permitted');
			assert.equal(promoted.contractVersion, source.contractVersion);
		});

		test('never mutates its input (pure copy)', () => {
			const source = fixtureEntry();
			const before = JSON.stringify(source);
			markEntryMetadataVerified(source);
			assert.equal(JSON.stringify(source), before);
		});

		test('double promotion is byte-equal to single promotion', () => {
			const once = serializeCatalogEntry(markEntryMetadataVerified(fixtureEntry()));
			const twice = serializeCatalogEntry(markEntryMetadataVerified(markEntryMetadataVerified(fixtureEntry())));
			assert.equal(once, twice);
		});
	});

	suite('admitCatalogRecord and entry-id uniqueness', () => {
		test('admits a well-formed multi-entry record', () => {
			const record = admittedRecord(admitCatalogRecord(fixtureRecord()));
			assert.equal(record.catalogId, FIXTURE_CATALOG_ID);
			assert.equal(record.entries.length, 2);
			assert.equal(record.contractVersion, INFERENCE_CATALOG_VERSION);
		});

		test('rejects non-objects, version mismatches, invalid catalog ids and non-array entries', () => {
			for (const candidate of [null, 'fixture.string', 42]) {
				assert.equal(rejectedRecord(admitCatalogRecord(candidate)).reason, 'not-an-object');
			}
			assert.equal(
				rejectedRecord(admitCatalogRecord({ ...fixtureRecord(), contractVersion: '0.9.9' })).reason,
				'version-mismatch',
			);
			assert.equal(
				rejectedRecord(admitCatalogRecord({ ...fixtureRecord(), catalogId: '' })).reason,
				'invalid-catalog-id',
			);
			assert.equal(
				rejectedRecord(admitCatalogRecord({ ...fixtureRecord(), entries: foreign('null') })).reason,
				'invalid-entries',
			);
		});

		test('rejects a record carrying an invalid entry, surfacing the entry reason verbatim', () => {
			const lie = {
				...fixtureClaim('free'),
				providerCapacityClaim: { ...fixtureClaim('free').providerCapacityClaim, guarantee: 'unlimited' },
			};
			const candidate = {
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), entryWith({ planClaims: [lie] })],
			};
			const rejection = rejectedRecord(admitCatalogRecord(candidate));
			assert.equal(rejection.reason, 'invalid-entry');
			assert.equal(rejection.detail.includes("'dishonest-plan-claim'"), true);
			assert.equal(rejection.detail.includes("'unlimited-provider-capacity'"), true);
		});

		test('rejects a duplicate entry id (never a silent overwrite)', () => {
			const candidate = {
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), fixtureEntry(FIXTURE_ENTRY_ALPHA)],
			};
			const rejection = rejectedRecord(admitCatalogRecord(candidate));
			assert.equal(rejection.reason, 'duplicate-entry-id');
			assert.equal(rejection.detail.includes(FIXTURE_ENTRY_ALPHA), true);
		});

		test('duplicate detection is position-independent', () => {
			const first = {
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_BETA), fixtureEntry(FIXTURE_ENTRY_ALPHA), fixtureEntry(FIXTURE_ENTRY_BETA)],
			};
			assert.equal(rejectedRecord(admitCatalogRecord(first)).reason, 'duplicate-entry-id');
		});

		test('a duplicate with different content is still rejected (no overwrite by content)', () => {
			const duplicate = {
				...fixtureEntry(FIXTURE_ENTRY_ALPHA),
				displayName: 'Fixture Entry Alpha Prime',
				providerClass: 'flauz-provisioned',
			};
			const candidate = {
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), duplicate],
			};
			const rejection = rejectedRecord(admitCatalogRecord(candidate));
			assert.equal(rejection.reason, 'duplicate-entry-id');
			assert.equal(rejection.detail.includes('never a silent overwrite'), true);
		});

		test('the admitted record canonicalizes every entry', () => {
			const record = admittedRecord(admitCatalogRecord(fixtureRecord()));
			for (const entry of record.entries) {
				assert.equal(admitCatalogEntry(entry).admitted, true);
				assert.equal(isProviderCatalogEntry(entry), true);
			}
		});
	});

	suite('catalogIndexById (the pure derivation)', () => {
		test('maps every entry id to its entry', () => {
			const record = admittedRecord(admitCatalogRecord(fixtureRecord()));
			const index = catalogIndexById(record);
			assert.equal(index[FIXTURE_ENTRY_ALPHA].entryId, FIXTURE_ENTRY_ALPHA);
			assert.equal(index[FIXTURE_ENTRY_BETA].entryId, FIXTURE_ENTRY_BETA);
			assert.equal(Object.keys(index).length, 2);
		});

		test('the index is frozen (a read-only view)', () => {
			const index = catalogIndexById(admittedRecord(admitCatalogRecord(fixtureRecord())));
			assert.equal(Object.isFrozen(index), true);
		});

		test('lookups return the record own entries (identity)', () => {
			const record = admittedRecord(admitCatalogRecord(fixtureRecord()));
			const index = catalogIndexById(record);
			assert.equal(index[FIXTURE_ENTRY_ALPHA], record.entries[0]);
			assert.equal(index[FIXTURE_ENTRY_BETA], record.entries[1]);
		});

		test('an empty record derives an empty index', () => {
			const index = catalogIndexById({
				catalogId: FIXTURE_CATALOG_ID,
				entries: [],
				contractVersion: INFERENCE_CATALOG_VERSION,
			});
			assert.equal(Object.isFrozen(index), true);
			assert.deepEqual(Object.keys(index), []);
		});

		test('prototype-hazard entry ids still land as own keys', () => {
			const record = admittedRecord(
				admitCatalogRecord({
					...fixtureRecord(),
					entries: [entryWith({ entryId: '__proto__' }), entryWith({ entryId: 'constructor' })],
				}),
			);
			const index = catalogIndexById(record);
			assert.equal(
				Object.prototype.hasOwnProperty.call(index, '__proto__'),
				true,
			);
			assert.equal(Object.prototype.hasOwnProperty.call(index, 'constructor'), true);
			assert.equal(index['__proto__'].entryId, '__proto__');
			assert.equal(index['constructor'].entryId, 'constructor');
		});
	});

	suite('canonical serialization and determinism', () => {
		test('equal entries serialize byte-equal (double build)', () => {
			const first = serializeCatalogEntry(fixtureEntry());
			const second = serializeCatalogEntry(fixtureEntry());
			assert.equal(first, second);
			assert.equal(typeof first, 'string');
		});

		test('canonical bytes are independent of the input key insertion order', () => {
			const claim = fixtureClaim('free');
			const snapshot = fixtureKnownSnapshot(FIXTURE_ENTRY_ALPHA);
			const shuffled = {
				contractVersion: INFERENCE_CATALOG_VERSION,
				termsState: 'unknown' as const,
				metadataVerification: 'unverified' as const,
				capacitySnapshot: {
					observedAtEpochMs: snapshot.observedAtEpochMs,
					resetSchedule: snapshot.resetSchedule,
					cooldown: snapshot.cooldown,
					quota: snapshot.quota,
					health: snapshot.health,
					verification: snapshot.verification,
					providerId: snapshot.providerId,
					contractVersion: snapshot.contractVersion,
				},
				planClaims: [
					{
						providerCapacityClaim: claim.providerCapacityClaim,
						productPromise: claim.productPromise,
						tier: claim.tier,
						contractVersion: claim.contractVersion,
						planId: claim.planId,
					},
				],
				providerClass: 'third-party-free-tier' as const,
				displayName: FIXTURE_DISPLAY_NAME,
				entryId: FIXTURE_ENTRY_ALPHA,
			};
			assert.equal(serializeCatalogEntry(shuffled), serializeCatalogEntry(fixtureEntry()));
		});

		test('each identity difference changes the bytes (entry id, display name, provider class)', () => {
			const base = serializeCatalogEntry(fixtureEntry());
			assert.notEqual(serializeCatalogEntry(entryWith({ entryId: FIXTURE_ENTRY_BETA })), base);
			assert.notEqual(serializeCatalogEntry(entryWith({ displayName: 'Fixture Entry Beta' })), base);
			assert.notEqual(serializeCatalogEntry(entryWith({ providerClass: 'flauz-provisioned' })), base);
		});

		test('each honest-state difference changes the bytes (verification, terms)', () => {
			const base = serializeCatalogEntry(fixtureEntry());
			assert.notEqual(serializeCatalogEntry(entryWith({ metadataVerification: 'verified' })), base);
			assert.notEqual(serializeCatalogEntry(entryWith({ termsState: 'permitted' })), base);
			assert.notEqual(serializeCatalogEntry(entryWith({ termsState: 'prohibited' })), base);
		});

		test('plan-claim differences change the bytes (added claim, other tier, no claims)', () => {
			const base = serializeCatalogEntry(fixtureEntry());
			assert.notEqual(
				serializeCatalogEntry(entryWith({ planClaims: [fixtureClaim('free'), fixtureClaim('provisioned')] })),
				base,
			);
			assert.notEqual(serializeCatalogEntry(entryWith({ planClaims: [fixtureClaim('self-hosted')] })), base);
			assert.notEqual(serializeCatalogEntry(entryWith({ planClaims: [] })), base);
		});

		test('snapshot-state differences change the bytes (health, quota, cooldown, reset)', () => {
			const snapshot = fixtureKnownSnapshot(FIXTURE_ENTRY_ALPHA);
			const variants = [
				fixtureEntry(),
				entryWith({ capacitySnapshot: { ...snapshot, health: 'degraded' } }),
				entryWith({ capacitySnapshot: { ...snapshot, quota: { state: 'unknown' } } }),
				entryWith({
					capacitySnapshot: {
						...snapshot,
						cooldown: {
							state: 'active',
							reason: 'rate-limited',
							sinceEpochMs: FIXTURE_NOW_MS,
							untilEpochMs: FIXTURE_NOW_MS + FIXTURE_WINDOW_LENGTH_MS,
						},
					},
				}),
				entryWith({
					capacitySnapshot: { ...snapshot, resetSchedule: { kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS } },
				}),
				entryWith({ capacitySnapshot: unknownSnapshot(FIXTURE_ENTRY_ALPHA, FIXTURE_NOW_MS) }),
			];
			const bytes = variants.map((variant) => serializeCatalogEntry(variant));
			assert.equal(new Set(bytes).size, bytes.length);
		});

		test('the canonical bytes carry the version stamp', () => {
			const bytes = serializeCatalogEntry(fixtureEntry());
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_CATALOG_VERSION}"`), true);
		});

		test('serialization refuses dishonest entries (fail closed, reason named)', () => {
			const lie = {
				...fixtureClaim('free'),
				providerCapacityClaim: { ...fixtureClaim('free').providerCapacityClaim, guarantee: 'unlimited' },
			};
			assert.throws(
				() => serializeCatalogEntry(entryWith({ planClaims: [lie] })),
				/dishonest-plan-claim.*unlimited-provider-capacity/,
			);
			assert.throws(() => serializeCatalogEntry(foreign('null')), /not-an-object/);
		});

		test('records serialize byte-equal and preserve entry order', () => {
			const first = serializeCatalogRecord(fixtureRecord());
			const second = serializeCatalogRecord(fixtureRecord());
			assert.equal(first, second);
			const reordered = serializeCatalogRecord({
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_BETA), fixtureEntry(FIXTURE_ENTRY_ALPHA)],
			});
			assert.notEqual(reordered, first);
		});

		test('serializeCatalogRecord refuses invalid records (duplicate id throws)', () => {
			const candidate = {
				...fixtureRecord(),
				entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), fixtureEntry(FIXTURE_ENTRY_ALPHA)],
			};
			assert.throws(() => serializeCatalogRecord(candidate), /duplicate-entry-id/);
		});
	});

	suite('shape guards', () => {
		test('isProviderCatalogEntry agrees with admission on accepted and rejected probes', () => {
			assert.equal(isProviderCatalogEntry(fixtureEntry()), true);
			assert.equal(isProviderCatalogEntry(unknownCapacityEntry(FIXTURE_ENTRY_ALPHA, 'flauz-provisioned', FIXTURE_NOW_MS)), true);
			for (const probe of [
				null,
				42,
				entryWith({ entryId: '' }),
				entryWith({ providerClass: 'fixture.class.moon' }),
				entryWith({ termsState: 'fixture.terms.maybe' }),
				entryWith({ capacitySnapshot: foreign('null') }),
			]) {
				assert.equal(isProviderCatalogEntry(probe), false, `probe must be rejected: ${JSON.stringify(probe)}`);
			}
		});

		test('isProviderCatalogRecord agrees with admission on accepted and rejected probes', () => {
			assert.equal(isProviderCatalogRecord(fixtureRecord()), true);
			for (const probe of [
				null,
				{ ...fixtureRecord(), contractVersion: '0.9.9' },
				{ ...fixtureRecord(), entries: [fixtureEntry(FIXTURE_ENTRY_ALPHA), fixtureEntry(FIXTURE_ENTRY_ALPHA)] },
			]) {
				assert.equal(isProviderCatalogRecord(probe), false);
			}
		});
	});
});
