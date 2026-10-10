/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-003 provider adapter test suite (mocha tdd style, matching
 * build/flauz/inference/catalog/test/common/providerCatalog.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, catalog id,
 * plan id, model id, credential handle and probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value - no
 * real provider, endpoint, URL, transport endpoint or key is named
 * anywhere in this suite. Closed-vocabulary members (transport
 * kinds, provenance classes, verification and health states) are the
 * contract's own values under test. Runtime-boundary probes are
 * injected as JSON-parsed values, the shape foreign input arrives in
 * at a real boundary.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ADAPTER_RECORD_REJECTION_REASONS,
	ADAPTER_REJECTION_REASONS,
	ADAPTER_TRANSPORT_KINDS,
	INFERENCE_ADAPTER_VERSION,
	admitProviderAdapter,
	admitProviderAdapterRecord,
	isAdapterHealthReport,
	isProviderAdapterDescriptor,
	isProviderAdapterRecord,
	markReportVerified,
	reportAdapterSnapshot,
	serializeAdapterReport,
} from '../../common/providerAdapter.js';
import type {
	AdapterObservation,
	ProviderAdapterAdmission,
	ProviderAdapterDescriptor,
	ProviderAdapterHealthReport,
	ProviderAdapterRecord,
	ProviderAdapterRecordAdmission,
	ProviderAdapterRecordRejected,
	ProviderAdapterRejected,
} from '../../common/providerAdapter.js';
import {
	CAPACITY_PROVENANCES,
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	planSemanticsForTier,
} from '../../../semantics/common/planSemantics.js';
import {
	markProvenanceVerified,
	unknownSnapshot,
	unverifiedProvenance,
} from '../../../semantics/common/capacityDisclosure.js';
import type {
	KnownQuota,
	ProviderCapacitySnapshot,
	UnverifiedProvenanceInput,
} from '../../../semantics/common/capacityDisclosure.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogEntry, ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';

const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.main';
const FIXTURE_DISPLAY_NAME = 'Fixture Adapter Alpha';
const FIXTURE_ENTRY_ALPHA = 'fixture.entry.alpha';
const FIXTURE_ENTRY_BETA = 'fixture.entry.beta';
const FIXTURE_ENTRY_MOON = 'fixture.entry.moon';
const FIXTURE_CATALOG_ID = 'fixture.catalog.main';
const FIXTURE_PLAN_ID = 'fixture.plan.alpha';
const FIXTURE_MODEL_ID = 'fixture.model.alpha';
const FIXTURE_MODEL_BETA = 'fixture.model.beta';
const FIXTURE_CREDENTIAL_HANDLE = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_HANDLE_BETA = 'fixture.credential.handle.beta';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_START_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_LENGTH_MS = 60_000;

function fixtureDescriptor(adapterId: string = FIXTURE_ADAPTER_ALPHA): ProviderAdapterDescriptor {
	return {
		adapterId,
		displayName: FIXTURE_DISPLAY_NAME,
		providerEntryId: FIXTURE_ENTRY_ALPHA,
		transportKind: 'http-openai-compatible',
		capacityProvenance: 'user-owned-endpoint',
		credentialHandle: FIXTURE_CREDENTIAL_HANDLE,
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

function fixtureDescriptorBeta(): ProviderAdapterDescriptor {
	return {
		adapterId: FIXTURE_ADAPTER_BETA,
		displayName: 'Fixture Adapter Beta',
		providerEntryId: FIXTURE_ENTRY_BETA,
		transportKind: 'local-sidecar',
		capacityProvenance: 'third-party-free-tier',
		credentialHandle: FIXTURE_CREDENTIAL_HANDLE_BETA,
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

/** Runtime-boundary probe helper: descriptor with overrides, the shape foreign input arrives in. */
function adapterWith(overrides: Record<string, unknown>): unknown {
	return { ...fixtureDescriptor(), ...overrides };
}

function fixtureObservation(): AdapterObservation {
	return {
		observedAtEpochMs: FIXTURE_NOW_MS,
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
		reset: {
			kind: 'interval-aligned',
			anchorEpochMs: FIXTURE_WINDOW_START_MS,
			intervalMs: FIXTURE_WINDOW_LENGTH_MS,
		},
	};
}

/** Observation probe helper: fixture with overrides (all fields required; probes may break them). */
function observationWith(overrides: Record<string, unknown>): AdapterObservation {
	return { ...fixtureObservation(), ...overrides } as unknown as AdapterObservation;
}

/** A malformed observation probe: one required field deleted, plus optional overrides. */
function brokenObservation(missingField: string, overrides: Record<string, unknown> = {}): AdapterObservation {
	const candidate = { ...fixtureObservation(), ...overrides } as unknown as Record<string, unknown>;
	delete candidate[missingField];
	return candidate as unknown as AdapterObservation;
}

function fixtureProvenanceInput(): UnverifiedProvenanceInput {
	return {
		requestedProviderId: FIXTURE_ENTRY_ALPHA,
		requestedModelId: FIXTURE_MODEL_ID,
		actualProviderId: FIXTURE_ENTRY_ALPHA,
		actualModelId: FIXTURE_MODEL_ID,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	};
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

function fixtureCatalogEntry(entryId: string): ProviderCatalogEntry {
	return {
		entryId,
		displayName: FIXTURE_DISPLAY_NAME,
		providerClass: 'third-party-free-tier',
		planClaims: [planSemanticsForTier('free', FIXTURE_PLAN_ID)],
		capacitySnapshot: fixtureKnownSnapshot(entryId),
		metadataVerification: 'unverified',
		termsState: 'unknown',
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureCatalogRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			fixtureCatalogEntry(FIXTURE_ENTRY_ALPHA),
			unknownCapacityEntry(FIXTURE_ENTRY_BETA, 'user-owned-endpoint', FIXTURE_NOW_MS),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureAdapterRecord(): ProviderAdapterRecord {
	return {
		adapterSetId: FIXTURE_ADAPTER_SET_ID,
		adapters: [fixtureDescriptor(), fixtureDescriptorBeta()],
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

function rejectedAdapter(admission: ProviderAdapterAdmission): ProviderAdapterRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as ProviderAdapterRejected;
}

function admittedAdapter(admission: ProviderAdapterAdmission): ProviderAdapterDescriptor {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.adapter;
}

function rejectedRecord(admission: ProviderAdapterRecordAdmission): ProviderAdapterRecordRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as ProviderAdapterRecordRejected;
}

function admittedRecord(admission: ProviderAdapterRecordAdmission): ProviderAdapterRecord {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.record;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

function fixtureReport(): ProviderAdapterHealthReport {
	return reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), fixtureProvenanceInput());
}

suite('INF-003 provider adapters', () => {

	suite('constants and closed lists', () => {
		test('the adapter contract version is 1.0.0', () => {
			assert.equal(INFERENCE_ADAPTER_VERSION, '1.0.0');
		});

		test('transport kinds are the closed frozen four, duplicate-free', () => {
			assert.deepEqual([...ADAPTER_TRANSPORT_KINDS], [
				'http-openai-compatible',
				'http-anthropic-compatible',
				'http-generic-json',
				'local-sidecar',
			]);
			assert.equal(Object.isFrozen(ADAPTER_TRANSPORT_KINDS), true);
			assert.equal(new Set(ADAPTER_TRANSPORT_KINDS).size, ADAPTER_TRANSPORT_KINDS.length);
		});

		test('transport kinds are SHAPES, never endpoints or credentials (structural honesty)', () => {
			for (const kind of ADAPTER_TRANSPORT_KINDS) {
				assert.equal(kind.includes('://'), false, `kind '${kind}' must not carry a URL scheme`);
				assert.equal(kind.includes(':'), false, `kind '${kind}' must not carry a port or key delimiter`);
				assert.equal(kind.includes('@'), false, `kind '${kind}' must not carry a userinfo shape`);
				assert.equal(kind.includes('='), false, `kind '${kind}' must not carry secret material`);
				assert.equal(kind.includes(' '), false, `kind '${kind}' must be a single identifier`);
			}
		});

		test('the rejection vocabularies are closed, non-empty and duplicate-free', () => {
			for (const list of [ADAPTER_REJECTION_REASONS, ADAPTER_RECORD_REJECTION_REASONS]) {
				assert.equal(list.length > 0, true);
				assert.equal(new Set(list).size, list.length);
			}
		});

		test('a report carries the adapter stamp while its snapshot and provenance carry the semantics stamp', () => {
			const report = fixtureReport();
			assert.equal(report.contractVersion, INFERENCE_ADAPTER_VERSION);
			assert.equal(report.snapshot.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			assert.equal(report.provenance.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});

		test('every transport kind and every direct-legal provenance class admits a descriptor', () => {
			for (const transportKind of ADAPTER_TRANSPORT_KINDS) {
				const admission = admitProviderAdapter(adapterWith({ transportKind }));
				assert.equal(admission.admitted, true, `kind '${transportKind}' must be admitted`);
				assert.equal(admittedAdapter(admission).transportKind, transportKind);
			}
			for (const provenance of ['user-owned-endpoint', 'third-party-free-tier'] as const) {
				const admission = admitProviderAdapter(adapterWith({ capacityProvenance: provenance }));
				assert.equal(admission.admitted, true, `provenance '${provenance}' must be admitted`);
			}
		});
	});

	suite('admitProviderAdapter rejections (every path)', () => {
		test('rejects non-objects: null, undefined, string, number, boolean', () => {
			for (const candidate of [null, undefined, 'fixture.string', 42, true]) {
				const rejection = rejectedAdapter(admitProviderAdapter(candidate));
				assert.equal(rejection.reason, 'not-an-object');
			}
		});

		test('rejects a contract-version mismatch (wrong value and missing key)', () => {
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ contractVersion: '0.9.9' }))).reason,
				'version-mismatch',
			);
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.contractVersion;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'version-mismatch');
		});

		test('rejects a missing, empty or non-string adapter id', () => {
			assert.equal(rejectedAdapter(admitProviderAdapter(adapterWith({ adapterId: '' }))).reason, 'invalid-adapter-id');
			assert.equal(rejectedAdapter(admitProviderAdapter(adapterWith({ adapterId: 42 }))).reason, 'invalid-adapter-id');
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.adapterId;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'invalid-adapter-id');
		});

		test('rejects a missing, empty or non-string display name', () => {
			assert.equal(rejectedAdapter(admitProviderAdapter(adapterWith({ displayName: '' }))).reason, 'invalid-display-name');
			assert.equal(rejectedAdapter(admitProviderAdapter(adapterWith({ displayName: foreign('null') }))).reason, 'invalid-display-name');
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.displayName;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'invalid-display-name');
		});

		test('rejects a missing, empty or non-string provider entry id', () => {
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ providerEntryId: '' }))).reason,
				'invalid-provider-entry-id',
			);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ providerEntryId: foreign('42') }))).reason,
				'invalid-provider-entry-id',
			);
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.providerEntryId;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'invalid-provider-entry-id');
		});

		test('rejects an unknown transport kind (foreign value and missing key)', () => {
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ transportKind: 'fixture.transport.moon' }))).reason,
				'unknown-transport-kind',
			);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ transportKind: 'https' }))).reason,
				'unknown-transport-kind',
			);
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.transportKind;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'unknown-transport-kind');
		});

		test('rejects a capacity provenance outside the landed semantics vocabulary', () => {
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ capacityProvenance: 'fixture.provenance.moon' }))).reason,
				'invalid-capacity-provenance',
			);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ capacityProvenance: foreign('null') }))).reason,
				'invalid-capacity-provenance',
			);
			const rejection = rejectedAdapter(
				admitProviderAdapter(adapterWith({ capacityProvenance: 'fixture.provenance.moon' })),
			);
			assert.equal(rejection.detail.includes(CAPACITY_PROVENANCES.join('/')), true);
		});

		test('THE DIRECT-ADAPTER LAW: rejects flauz-provisioned with the dedicated typed reason', () => {
			const rejection = rejectedAdapter(admitProviderAdapter(adapterWith({ capacityProvenance: 'flauz-provisioned' })));
			assert.equal(rejection.reason, 'flauz-provisioned-adapter');
			assert.equal(rejection.detail.includes('Flauz does not provision what it does not own'), true);
			assert.equal(rejection.detail.includes('the direct-adapter law'), true);
		});

		test('the direct-adapter law holds for every transport kind (no provisioning escape hatch)', () => {
			for (const transportKind of ADAPTER_TRANSPORT_KINDS) {
				const rejection = rejectedAdapter(
					admitProviderAdapter(adapterWith({ transportKind, capacityProvenance: 'flauz-provisioned' })),
				);
				assert.equal(rejection.reason, 'flauz-provisioned-adapter', `kind '${transportKind}' must reject`);
			}
		});

		test('rejects a non-string, empty or whitespace-only credential handle', () => {
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: foreign('42') }))).reason,
				'invalid-credential-handle',
			);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: '' }))).reason,
				'invalid-credential-handle',
			);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: '   ' }))).reason,
				'invalid-credential-handle',
			);
			const missing = fixtureDescriptor() as unknown as Record<string, unknown>;
			delete missing.credentialHandle;
			assert.equal(rejectedAdapter(admitProviderAdapter(missing)).reason, 'invalid-credential-handle');
		});

		test('rejects secret-looking handles: a run longer than 40 characters', () => {
			const longRun = 'a'.repeat(41);
			const rejection = rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: longRun })));
			assert.equal(rejection.reason, 'secret-bearing-credential-handle');
			assert.equal(rejection.detail.includes('40'), true);
		});

		test('rejects secret-looking handles: the characters =, : and / beyond a plain identifier shape', () => {
			for (const handle of [
				'fixture.handle=secret-material',
				'fixture.handle:secret-material',
				'fixture.handle/secret-material',
				'key=AAAA',
				'https://provider.example/v1/keys',
			]) {
				const rejection = rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: handle })));
				assert.equal(rejection.reason, 'secret-bearing-credential-handle', `handle '${handle}' must be rejected`);
			}
			const rejection = rejectedAdapter(
				admitProviderAdapter(adapterWith({ credentialHandle: 'fixture.handle=secret-material' })),
			);
			assert.equal(rejection.detail.includes("INF-007's"), true);
		});
	});

	suite('the credential-handle shape guard (both directions)', () => {
		test('admits honest plain reference handles (single and multi-word)', () => {
			for (const handle of [
				FIXTURE_CREDENTIAL_HANDLE,
				'fixture handle alpha',
				'keyring-slot-07',
				'vault-ref adapter-alpha',
			]) {
				const admission = admitProviderAdapter(adapterWith({ credentialHandle: handle }));
				assert.equal(admission.admitted, true, `handle '${handle}' must be admitted`);
				assert.equal(admittedAdapter(admission).credentialHandle, handle);
			}
		});

		test('admits a handle at the exact 40-character boundary (the boundary is inclusive)', () => {
			const boundary = 'a'.repeat(40);
			const admission = admitProviderAdapter(adapterWith({ credentialHandle: boundary }));
			assert.equal(admission.admitted, true);
		});

		test('rejects a handle at 41 characters (one past the boundary)', () => {
			const past = 'a'.repeat(41);
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: past }))).reason,
				'secret-bearing-credential-handle',
			);
		});

		test('the run-length rule is per whitespace-separated run, not per handle', () => {
			const multiWord = `${'a'.repeat(40)} ${'b'.repeat(40)}`;
			assert.equal(admitProviderAdapter(adapterWith({ credentialHandle: multiWord })).admitted, true);
			const oneLong = `${'a'.repeat(40)} ${'b'.repeat(41)}`;
			assert.equal(
				rejectedAdapter(admitProviderAdapter(adapterWith({ credentialHandle: oneLong }))).reason,
				'secret-bearing-credential-handle',
			);
		});

		test('the guard is conservative: short non-delimited material passes (documented honestly)', () => {
			// A 39-char opaque run without delimiters is NOT caught by the
			// vocabulary-level rule - the real isolation is INF-007's.
			const shortOpaque = 'opaque'.repeat(6) + 'aaa';
			assert.equal(shortOpaque.length, 39);
			assert.equal(admitProviderAdapter(adapterWith({ credentialHandle: shortOpaque })).admitted, true);
		});
	});

	suite('descriptor acceptance and honesty', () => {
		test('admits a full descriptor and returns the canonical record', () => {
			const adapter = admittedAdapter(admitProviderAdapter(fixtureDescriptor()));
			assert.deepEqual(adapter, fixtureDescriptor());
		});

		test('the credential handle is carried verbatim - a reference, never material', () => {
			const adapter = admittedAdapter(
				admitProviderAdapter(adapterWith({ credentialHandle: 'fixture.handle.carried' })),
			);
			assert.equal(adapter.credentialHandle, 'fixture.handle.carried');
		});

		test('admission never mutates the candidate', () => {
			const candidate = fixtureDescriptor();
			const before = JSON.stringify(candidate);
			admitProviderAdapter(candidate);
			isProviderAdapterDescriptor(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});

		test('determinism: same candidate, same verdict, same reason and detail', () => {
			const first = admitProviderAdapter(adapterWith({ transportKind: 'fixture.transport.moon' }));
			const second = admitProviderAdapter(adapterWith({ transportKind: 'fixture.transport.moon' }));
			assert.deepEqual(first, second);
			const third = admitProviderAdapter(fixtureDescriptor());
			const fourth = admitProviderAdapter(fixtureDescriptor());
			assert.deepEqual(third, fourth);
		});

		test('both direct-legal provenance classes are carried verbatim', () => {
			const owned = admittedAdapter(admitProviderAdapter(adapterWith({ capacityProvenance: 'user-owned-endpoint' })));
			assert.equal(owned.capacityProvenance, 'user-owned-endpoint');
			const freeTier = admittedAdapter(
				admitProviderAdapter(adapterWith({ capacityProvenance: 'third-party-free-tier' })),
			);
			assert.equal(freeTier.capacityProvenance, 'third-party-free-tier');
		});
	});

	suite('admitProviderAdapterRecord: uniqueness and the no-dangling-ref extension', () => {
		test('admits a well-formed adapter set record bound to a resolving catalog', () => {
			const record = admittedRecord(admitProviderAdapterRecord(fixtureAdapterRecord(), fixtureCatalogRecord()));
			assert.equal(record.adapterSetId, FIXTURE_ADAPTER_SET_ID);
			assert.equal(record.adapters.length, 2);
			assert.equal(record.contractVersion, INFERENCE_ADAPTER_VERSION);
		});

		test('rejects non-objects, version mismatches, invalid set ids and non-array adapters', () => {
			for (const candidate of [null, 'fixture.string', 42]) {
				assert.equal(rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord())).reason, 'not-an-object');
			}
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord({ ...fixtureAdapterRecord(), contractVersion: '0.9.9' }, fixtureCatalogRecord())).reason,
				'version-mismatch',
			);
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord({ ...fixtureAdapterRecord(), adapterSetId: '' }, fixtureCatalogRecord())).reason,
				'invalid-adapter-set-id',
			);
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord({ ...fixtureAdapterRecord(), adapters: foreign('null') }, fixtureCatalogRecord())).reason,
				'invalid-adapters',
			);
		});

		test('rejects a record carrying an invalid adapter, surfacing the adapter reason verbatim', () => {
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor(), adapterWith({ capacityProvenance: 'flauz-provisioned' })],
			};
			const rejection = rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'invalid-adapter');
			assert.equal(rejection.detail.includes('adapters[1]'), true);
			assert.equal(rejection.detail.includes("'flauz-provisioned-adapter'"), true);
		});

		test('rejects a duplicate adapter id (never a silent overwrite)', () => {
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor(), fixtureDescriptor()],
			};
			const rejection = rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'duplicate-adapter-id');
			assert.equal(rejection.detail.includes(FIXTURE_ADAPTER_ALPHA), true);
			assert.equal(rejection.detail.includes('never a silent overwrite'), true);
		});

		test('duplicate detection is position-independent', () => {
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptorBeta(), fixtureDescriptor(), fixtureDescriptorBeta()],
			};
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord())).reason,
				'duplicate-adapter-id',
			);
		});

		test('a duplicate with different content is still rejected (no overwrite by content)', () => {
			const duplicate = {
				...fixtureDescriptor(),
				displayName: 'Fixture Adapter Alpha Prime',
				transportKind: 'http-generic-json',
			};
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor(), duplicate],
			};
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord())).reason,
				'duplicate-adapter-id',
			);
		});

		test('rejects an invalid bound catalog, citing the catalog family reason verbatim', () => {
			const brokenCatalog = {
				...fixtureCatalogRecord(),
				entries: [
					fixtureCatalogEntry(FIXTURE_ENTRY_ALPHA),
					fixtureCatalogEntry(FIXTURE_ENTRY_ALPHA),
				],
			};
			const rejection = rejectedRecord(admitProviderAdapterRecord(fixtureAdapterRecord(), brokenCatalog));
			assert.equal(rejection.reason, 'invalid-catalog');
			assert.equal(rejection.detail.includes("'duplicate-entry-id'"), true);
			assert.equal(rejection.detail.includes('admitCatalogRecord'), true);
		});

		test('rejects a non-object bound catalog (fail closed)', () => {
			for (const catalog of [null, 'fixture.catalog', 42]) {
				const rejection = rejectedRecord(admitProviderAdapterRecord(fixtureAdapterRecord(), catalog));
				assert.equal(rejection.reason, 'invalid-catalog');
				assert.equal(rejection.detail.includes("'not-an-object'"), true);
			}
		});

		test('THE NO-DANGLING-REF EXTENSION: rejects an adapter whose provider entry does not resolve', () => {
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [
					fixtureDescriptor(),
					adapterWith({ adapterId: 'fixture.adapter.moon', providerEntryId: FIXTURE_ENTRY_MOON }),
				],
			};
			const rejection = rejectedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'unknown-provider-entry');
			assert.equal(rejection.detail.includes('adapters[1]'), true);
			assert.equal(rejection.detail.includes(FIXTURE_ENTRY_MOON), true);
			assert.equal(rejection.detail.includes('never a silent dangling ref'), true);
		});

		test('the resolving direction: every adapter bound to a catalog entry admits', () => {
			const alphaOnly = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor()],
			};
			assert.equal(admitProviderAdapterRecord(alphaOnly, fixtureCatalogRecord()).admitted, true);
			const betaOnly = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptorBeta()],
			};
			assert.equal(admitProviderAdapterRecord(betaOnly, fixtureCatalogRecord()).admitted, true);
			const bothEntries = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor(), fixtureDescriptorBeta()],
			};
			assert.equal(admitProviderAdapterRecord(bothEntries, fixtureCatalogRecord()).admitted, true);
		});

		test('two adapters may bind the same provider entry (uniqueness is on adapter id, not entry)', () => {
			const twin = {
				...fixtureDescriptorBeta(),
				adapterId: 'fixture.adapter.gamma',
				providerEntryId: FIXTURE_ENTRY_ALPHA,
				transportKind: 'http-generic-json',
			};
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [fixtureDescriptor(), twin],
			};
			const record = admittedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord()));
			assert.equal(record.adapters.length, 2);
			assert.equal(record.adapters[1].providerEntryId, FIXTURE_ENTRY_ALPHA);
		});

		test('an empty adapters array is admitted (the honest empty set) and binds to any catalog', () => {
			const candidate = {
				...fixtureAdapterRecord(),
				adapters: [],
			};
			const record = admittedRecord(admitProviderAdapterRecord(candidate, fixtureCatalogRecord()));
			assert.deepEqual(record.adapters, []);
			assert.equal(isProviderAdapterRecord(candidate), true);
		});
	});

	suite('reportAdapterSnapshot over the honest-unknown combinations', () => {
		test('builds the snapshot from a fully-known observation', () => {
			const report = fixtureReport();
			assert.deepEqual(report.snapshot, fixtureKnownSnapshot(FIXTURE_ENTRY_ALPHA));
		});

		test('unknown health rides the unknownSnapshot default (a first-class state, never a null)', () => {
			const report = reportAdapterSnapshot(
				fixtureDescriptor(),
				observationWith({ health: 'unknown' }),
				fixtureProvenanceInput(),
			);
			assert.equal(report.snapshot.health, 'unknown');
			assert.equal(report.snapshot.quota.state, 'known');
		});

		test('unknown quota rides the unknownSnapshot default', () => {
			const report = reportAdapterSnapshot(
				fixtureDescriptor(),
				observationWith({ quota: { state: 'unknown' } }),
				fixtureProvenanceInput(),
			);
			assert.deepEqual(report.snapshot.quota, { state: 'unknown' });
			assert.equal(report.snapshot.health, 'healthy');
		});

		test('no cooldown rides the unknownSnapshot default (typed absence)', () => {
			const report = reportAdapterSnapshot(
				fixtureDescriptor(),
				observationWith({ cooldown: { state: 'none' } }),
				fixtureProvenanceInput(),
			);
			assert.deepEqual(report.snapshot.cooldown, { state: 'none' });
		});

		test('unknown reset rides the unknownSnapshot default', () => {
			const report = reportAdapterSnapshot(
				fixtureDescriptor(),
				observationWith({ reset: { kind: 'unknown' } }),
				fixtureProvenanceInput(),
			);
			assert.deepEqual(report.snapshot.resetSchedule, { kind: 'unknown' });
		});

		test('the all-unknown observation deep-equals the landed unknownSnapshot', () => {
			const observation = observationWith({
				health: 'unknown',
				quota: { state: 'unknown' },
				cooldown: { state: 'none' },
				reset: { kind: 'unknown' },
			});
			const report = reportAdapterSnapshot(fixtureDescriptor(), observation, fixtureProvenanceInput());
			assert.deepEqual(report.snapshot, unknownSnapshot(FIXTURE_ENTRY_ALPHA, FIXTURE_NOW_MS));
		});

		test('EVERY combination of known and unknown states is carried verbatim (16 combos)', () => {
			const healths = ['healthy', 'unknown'] as const;
			const quotas = [
				fixtureObservation().quota,
				{ state: 'unknown' } as const,
			];
			const cooldowns = [
				{ state: 'none' } as const,
				{
					state: 'active',
					reason: 'rate-limited',
					sinceEpochMs: FIXTURE_NOW_MS,
					untilEpochMs: FIXTURE_NOW_MS + FIXTURE_WINDOW_LENGTH_MS,
				} as const,
			];
			const resets = [
				fixtureObservation().reset,
				{ kind: 'unknown' } as const,
			];
			let combinations = 0;
			for (const health of healths) {
				for (const quota of quotas) {
					for (const cooldown of cooldowns) {
						for (const reset of resets) {
							const observation = observationWith({ health, quota, cooldown, reset });
							const report = reportAdapterSnapshot(fixtureDescriptor(), observation, fixtureProvenanceInput());
							assert.equal(report.snapshot.health, health);
							assert.deepEqual(report.snapshot.quota, quota);
							assert.deepEqual(report.snapshot.cooldown, cooldown);
							assert.deepEqual(report.snapshot.resetSchedule, reset);
							combinations++;
						}
					}
				}
			}
			assert.equal(combinations, 16);
		});

		test('each known reset kind is carried into the snapshot', () => {
			for (const reset of [
				{ kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS + FIXTURE_WINDOW_LENGTH_MS },
				{ kind: 'interval-aligned', anchorEpochMs: FIXTURE_WINDOW_START_MS, intervalMs: FIXTURE_WINDOW_LENGTH_MS },
				{ kind: 'provider-discretion' },
			] as const) {
				const report = reportAdapterSnapshot(fixtureDescriptor(), observationWith({ reset }), fixtureProvenanceInput());
				assert.deepEqual(report.snapshot.resetSchedule, reset);
			}
		});
	});

	suite('report fold: attribution, stamping and time injection', () => {
		test('the snapshot is for the adapter provider entry id and rides the semantics stamp', () => {
			const report = fixtureReport();
			assert.equal(report.snapshot.providerId, FIXTURE_ENTRY_ALPHA);
			assert.equal(report.snapshot.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});

		test('the report stamps the adapter family version and the adapter id', () => {
			const report = fixtureReport();
			assert.equal(report.contractVersion, INFERENCE_ADAPTER_VERSION);
			assert.equal(report.adapterId, FIXTURE_ADAPTER_ALPHA);
		});

		test('the injected observation time rides both the report and its snapshot (one observation, one time)', () => {
			const report = reportAdapterSnapshot(
				fixtureDescriptor(),
				observationWith({ observedAtEpochMs: FIXTURE_NOW_MS + 1 }),
				fixtureProvenanceInput(),
			);
			assert.equal(report.observedAtEpochMs, FIXTURE_NOW_MS + 1);
			assert.equal(report.snapshot.observedAtEpochMs, FIXTURE_NOW_MS + 1);
			assert.equal(fixtureReport().observedAtEpochMs, fixtureReport().snapshot.observedAtEpochMs);
		});

		test('an active cooldown with its reason and inclusive bounds is carried verbatim', () => {
			const cooldown = {
				state: 'active',
				reason: 'quota-exhausted',
				sinceEpochMs: FIXTURE_NOW_MS,
				untilEpochMs: FIXTURE_NOW_MS + FIXTURE_WINDOW_LENGTH_MS,
			} as const;
			const report = reportAdapterSnapshot(fixtureDescriptor(), observationWith({ cooldown }), fixtureProvenanceInput());
			assert.deepEqual(report.snapshot.cooldown, cooldown);
		});

		test('the fold never mutates its inputs', () => {
			const adapter = fixtureDescriptor();
			const observation = fixtureObservation();
			const provenance = fixtureProvenanceInput();
			const adapterBefore = JSON.stringify(adapter);
			const observationBefore = JSON.stringify(observation);
			const provenanceBefore = JSON.stringify(provenance);
			reportAdapterSnapshot(adapter, observation, provenance);
			assert.equal(JSON.stringify(adapter), adapterBefore);
			assert.equal(JSON.stringify(observation), observationBefore);
			assert.equal(JSON.stringify(provenance), provenanceBefore);
		});

		test('the folded report is admitted by isAdapterHealthReport and serializes to a string', () => {
			const report = fixtureReport();
			assert.equal(isAdapterHealthReport(report), true);
			assert.equal(typeof serializeAdapterReport(report), 'string');
		});
	});

	suite('the never-fabricate-verification law', () => {
		test('an unverified adapter reports unverified (provenance and snapshot both)', () => {
			const report = fixtureReport();
			assert.equal(report.provenance.modelVerification, 'unverified');
			assert.equal(report.snapshot.verification, 'unverified');
		});

		test('the default provenance is the landed unverifiedProvenance of the injected input', () => {
			const report = fixtureReport();
			assert.deepEqual(report.provenance, unverifiedProvenance(fixtureProvenanceInput()));
		});

		test('a differing selection is labeled disclosed at construction (never hidden)', () => {
			const input: UnverifiedProvenanceInput = {
				...fixtureProvenanceInput(),
				requestedModelId: FIXTURE_MODEL_BETA,
			};
			const report = reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), input);
			assert.equal(report.provenance.substitution, 'disclosed');
		});

		test('a caller-supplied verified provenance is carried verbatim, never demoted', () => {
			const verified = markProvenanceVerified(unverifiedProvenance(fixtureProvenanceInput()));
			const report = reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), verified);
			assert.deepEqual(report.provenance, verified);
			assert.equal(report.provenance.modelVerification, 'verified');
		});

		test('the caller receipt is the only fold-time source of a verified snapshot', () => {
			const verified = markProvenanceVerified(unverifiedProvenance(fixtureProvenanceInput()));
			const report = reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), verified);
			assert.equal(report.snapshot.verification, 'verified');
			assert.equal(fixtureReport().snapshot.verification, 'unverified');
		});

		test('only the one-way promotion flips a folded unverified report (the original never mutates)', () => {
			const report = fixtureReport();
			const promoted = markReportVerified(report);
			assert.equal(report.provenance.modelVerification, 'unverified');
			assert.equal(report.snapshot.verification, 'unverified');
			assert.equal(promoted.provenance.modelVerification, 'verified');
			assert.equal(promoted.snapshot.verification, 'verified');
		});
	});

	suite('report fold fail-closed guards', () => {
		test('throws TypeError on a non-admitted adapter (a rejected adapter never reports)', () => {
			const flauzProvisioned = adapterWith({ capacityProvenance: 'flauz-provisioned' }) as ProviderAdapterDescriptor;
			assert.throws(
				() => reportAdapterSnapshot(flauzProvisioned, fixtureObservation(), fixtureProvenanceInput()),
				/isProviderAdapterDescriptor/,
			);
		});

		test('throws TypeError on a non-finite observation timestamp (the contract never reads a clock)', () => {
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ observedAtEpochMs: Number.NaN }), fixtureProvenanceInput()),
				/never reads a clock/,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ observedAtEpochMs: foreign('null') }), fixtureProvenanceInput()),
				TypeError,
			);
		});

		test('throws TypeError on an observation missing a required field (never a silent default)', () => {
			for (const field of ['health', 'quota', 'cooldown', 'reset']) {
				assert.throws(
					() => reportAdapterSnapshot(fixtureDescriptor(), brokenObservation(field), fixtureProvenanceInput()),
					TypeError,
					`missing '${field}' must throw`,
				);
			}
		});

		test('throws TypeError on an observation with foreign states outside the landed vocabulary', () => {
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ health: 'fixture.health.moon' }), fixtureProvenanceInput()),
				TypeError,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ quota: { state: 'maybe' } }), fixtureProvenanceInput()),
				TypeError,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ cooldown: { state: 'paused' } }), fixtureProvenanceInput()),
				TypeError,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ reset: { kind: 'fixture.reset.moon' } }), fixtureProvenanceInput()),
				TypeError,
			);
		});

		test('throws TypeError on a malformed quota (negative remaining is not a known quota)', () => {
			const quota = {
				state: 'known',
				remaining: -1,
				limit: 60,
				window: {
					kind: 'fixed',
					windowStartEpochMs: FIXTURE_WINDOW_START_MS,
					windowLengthMs: FIXTURE_WINDOW_LENGTH_MS,
				},
			};
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), observationWith({ quota }), fixtureProvenanceInput()),
				TypeError,
			);
		});

		test('throws TypeError on a provenance record failing admitProvenance (never silently repaired)', () => {
			const hiddenSubstitution = {
				...unverifiedProvenance({ ...fixtureProvenanceInput(), requestedModelId: FIXTURE_MODEL_BETA }),
				substitution: 'none',
			};
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), hiddenSubstitution),
				/hidden-substitution/,
			);
			const wrongVersion = { ...unverifiedProvenance(fixtureProvenanceInput()), contractVersion: '0.9.9' };
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), wrongVersion),
				/version-mismatch/,
			);
		});

		test('throws TypeError on a misattributed provenance (actual provider must name the adapter entry)', () => {
			const misattributed = unverifiedProvenance({
				...fixtureProvenanceInput(),
				requestedProviderId: FIXTURE_ENTRY_BETA,
				actualProviderId: FIXTURE_ENTRY_BETA,
			});
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), misattributed),
				/misattributed/,
			);
		});

		test('throws TypeError on a malformed or non-object provenance input', () => {
			const emptyModel = { ...fixtureProvenanceInput(), requestedModelId: '' };
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), emptyModel),
				TypeError,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), foreign('null')),
				/provenance input must be a non-null object/,
			);
			assert.throws(
				() => reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), foreign('42')),
				/provenance input must be a non-null object/,
			);
		});
	});

	suite('markReportVerified (the one-way promotion)', () => {
		test('promotes the report provenance riding the landed markProvenanceVerified', () => {
			const report = fixtureReport();
			const promoted = markReportVerified(report);
			assert.deepEqual(promoted.provenance, markProvenanceVerified(report.provenance));
			assert.equal(promoted.provenance.modelVerification, 'verified');
		});

		test('promotes the snapshot verification alongside (the report stays consistent)', () => {
			const promoted = markReportVerified(fixtureReport());
			assert.equal(promoted.snapshot.verification, 'verified');
		});

		test('an already-verified report stays verified (idempotent, never demoted)', () => {
			const once = markReportVerified(fixtureReport());
			const twice = markReportVerified(once);
			assert.equal(twice.provenance.modelVerification, 'verified');
			assert.equal(twice.snapshot.verification, 'verified');
			assert.deepEqual(twice, once);
		});

		test('preserves every other field verbatim', () => {
			const report = fixtureReport();
			const promoted = markReportVerified(report);
			assert.equal(promoted.adapterId, report.adapterId);
			assert.equal(promoted.observedAtEpochMs, report.observedAtEpochMs);
			assert.equal(promoted.contractVersion, report.contractVersion);
			assert.equal(promoted.snapshot.providerId, report.snapshot.providerId);
			assert.equal(promoted.snapshot.health, report.snapshot.health);
			assert.deepEqual(promoted.snapshot.quota, report.snapshot.quota);
			assert.deepEqual(promoted.snapshot.cooldown, report.snapshot.cooldown);
			assert.deepEqual(promoted.snapshot.resetSchedule, report.snapshot.resetSchedule);
			assert.equal(promoted.provenance.substitution, report.provenance.substitution);
			assert.equal(promoted.provenance.requestedModelId, report.provenance.requestedModelId);
		});

		test('never mutates its input (pure copy)', () => {
			const report = fixtureReport();
			const before = JSON.stringify(report);
			markReportVerified(report);
			assert.equal(JSON.stringify(report), before);
		});

		test('double promotion is byte-equal to single promotion', () => {
			const once = serializeAdapterReport(markReportVerified(fixtureReport()));
			const twice = serializeAdapterReport(markReportVerified(markReportVerified(fixtureReport())));
			assert.equal(once, twice);
		});

		test('promotion changes the canonical bytes (verification is observable)', () => {
			const base = serializeAdapterReport(fixtureReport());
			const promoted = serializeAdapterReport(markReportVerified(fixtureReport()));
			assert.notEqual(promoted, base);
		});
	});

	suite('serializeAdapterReport (canonical bytes)', () => {
		test('double folding is byte-equal (determinism)', () => {
			const first = serializeAdapterReport(fixtureReport());
			const second = serializeAdapterReport(fixtureReport());
			assert.equal(first, second);
			assert.equal(typeof first, 'string');
		});

		test('canonical bytes are independent of the input key insertion order', () => {
			const report = fixtureReport();
			const quota = report.snapshot.quota;
			assert.equal(quota.state, 'known', 'the fixture report must carry a known quota for the shuffle probe');
			const knownQuota = quota as KnownQuota;
			const shuffledSnapshot = {
				observedAtEpochMs: report.snapshot.observedAtEpochMs,
				resetSchedule: report.snapshot.resetSchedule,
				cooldown: report.snapshot.cooldown,
				quota: {
					window: {
						windowLengthMs: knownQuota.window.windowLengthMs,
						windowStartEpochMs: knownQuota.window.windowStartEpochMs,
						kind: knownQuota.window.kind,
					},
					limit: knownQuota.limit,
					remaining: knownQuota.remaining,
					state: knownQuota.state,
				},
				health: report.snapshot.health,
				verification: report.snapshot.verification,
				providerId: report.snapshot.providerId,
				contractVersion: report.snapshot.contractVersion,
			};
			const shuffledProvenance = {
				recordedAtEpochMs: report.provenance.recordedAtEpochMs,
				modelVerification: report.provenance.modelVerification,
				substitution: report.provenance.substitution,
				actualModelId: report.provenance.actualModelId,
				actualProviderId: report.provenance.actualProviderId,
				requestedModelId: report.provenance.requestedModelId,
				requestedProviderId: report.provenance.requestedProviderId,
				contractVersion: report.provenance.contractVersion,
			};
			const shuffled = {
				observedAtEpochMs: report.observedAtEpochMs,
				provenance: shuffledProvenance,
				snapshot: shuffledSnapshot,
				contractVersion: report.contractVersion,
				adapterId: report.adapterId,
			};
			assert.equal(isAdapterHealthReport(shuffled), true);
			assert.equal(serializeAdapterReport(shuffled), serializeAdapterReport(report));
		});

		test('each snapshot-state difference changes the bytes (health, quota, cooldown, reset)', () => {
			const base = fixtureReport();
			const variants = [
				base,
				reportAdapterSnapshot(fixtureDescriptor(), observationWith({ health: 'degraded' }), fixtureProvenanceInput()),
				reportAdapterSnapshot(fixtureDescriptor(), observationWith({ health: 'unknown' }), fixtureProvenanceInput()),
				reportAdapterSnapshot(fixtureDescriptor(), observationWith({ quota: { state: 'unknown' } }), fixtureProvenanceInput()),
				reportAdapterSnapshot(
					fixtureDescriptor(),
					observationWith({
						cooldown: {
							state: 'active',
							reason: 'rate-limited',
							sinceEpochMs: FIXTURE_NOW_MS,
							untilEpochMs: FIXTURE_NOW_MS + FIXTURE_WINDOW_LENGTH_MS,
						},
					}),
					fixtureProvenanceInput(),
				),
				reportAdapterSnapshot(fixtureDescriptor(), observationWith({ reset: { kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS } }), fixtureProvenanceInput()),
				reportAdapterSnapshot(fixtureDescriptor(), observationWith({ reset: { kind: 'provider-discretion' } }), fixtureProvenanceInput()),
				reportAdapterSnapshot(
					fixtureDescriptor(),
					observationWith({ observedAtEpochMs: FIXTURE_NOW_MS + 1 }),
					fixtureProvenanceInput(),
				),
			];
			const bytes = variants.map((variant) => serializeAdapterReport(variant));
			assert.equal(new Set(bytes).size, bytes.length);
		});

		test('identity and verification differences change the bytes', () => {
			const base = serializeAdapterReport(fixtureReport());
			const otherAdapter = serializeAdapterReport(
				reportAdapterSnapshot(admittedAdapter(admitProviderAdapter(adapterWith({ adapterId: FIXTURE_ADAPTER_BETA }))), fixtureObservation(), fixtureProvenanceInput()),
			);
			assert.notEqual(otherAdapter, base);
			const verified = serializeAdapterReport(
				reportAdapterSnapshot(
					fixtureDescriptor(),
					fixtureObservation(),
					markProvenanceVerified(unverifiedProvenance(fixtureProvenanceInput())),
				),
			);
			assert.notEqual(verified, base);
			const otherModel = serializeAdapterReport(
				reportAdapterSnapshot(
					fixtureDescriptor(),
					fixtureObservation(),
					unverifiedProvenance({ ...fixtureProvenanceInput(), requestedModelId: FIXTURE_MODEL_BETA }),
				),
			);
			assert.notEqual(otherModel, base);
		});

		test('the canonical bytes carry the adapter stamp and the semantics stamps', () => {
			const bytes = serializeAdapterReport(fixtureReport());
			assert.equal(bytes.includes(`"adapterId":"${FIXTURE_ADAPTER_ALPHA}"`), true);
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_ADAPTER_VERSION}"`), true);
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_SEMANTICS_CONTRACTS_VERSION}"`), true);
		});

		test('serialization refuses non-admitted reports (fail closed, reason named)', () => {
			assert.throws(() => serializeAdapterReport(foreign('null')), /isAdapterHealthReport/);
			assert.throws(
				() => serializeAdapterReport({ ...fixtureReport(), contractVersion: '0.9.9' }),
				/isAdapterHealthReport/,
			);
			assert.throws(
				() => serializeAdapterReport({ ...fixtureReport(), observedAtEpochMs: FIXTURE_NOW_MS + 1 }),
				/isAdapterHealthReport/,
			);
			assert.throws(
				() => serializeAdapterReport({ ...fixtureReport(), provenance: foreign('null') }),
				/isAdapterHealthReport/,
			);
		});

		test('a promoted report serializes with both verification fields verified', () => {
			const bytes = serializeAdapterReport(markReportVerified(fixtureReport()));
			assert.equal(bytes.includes('"modelVerification":"verified"'), true);
			assert.equal(bytes.includes('"verification":"verified"'), true);
			assert.equal(bytes.includes('"modelVerification":"unverified"'), false);
		});

		test('the unverified report serializes with both verification fields unverified', () => {
			const bytes = serializeAdapterReport(fixtureReport());
			assert.equal(bytes.includes('"modelVerification":"unverified"'), true);
			assert.equal(bytes.includes('"verification":"unverified"'), true);
			assert.equal(bytes.includes('"verification":"verified"'), false);
		});
	});

	suite('shape guards', () => {
		test('isProviderAdapterDescriptor agrees with admission on accepted and rejected probes', () => {
			assert.equal(isProviderAdapterDescriptor(fixtureDescriptor()), true);
			assert.equal(isProviderAdapterDescriptor(fixtureDescriptorBeta()), true);
			for (const probe of [
				null,
				42,
				adapterWith({ adapterId: '' }),
				adapterWith({ transportKind: 'fixture.transport.moon' }),
				adapterWith({ capacityProvenance: 'flauz-provisioned' }),
				adapterWith({ capacityProvenance: 'fixture.provenance.moon' }),
				adapterWith({ credentialHandle: 'a'.repeat(41) }),
				adapterWith({ credentialHandle: 'fixture.handle=secret' }),
			]) {
				assert.equal(isProviderAdapterDescriptor(probe), false, `probe must be rejected: ${JSON.stringify(probe)}`);
			}
		});

		test('isProviderAdapterRecord agrees at the shape level (no catalog binding repeated)', () => {
			assert.equal(isProviderAdapterRecord(fixtureAdapterRecord()), true);
			for (const probe of [
				null,
				{ ...fixtureAdapterRecord(), contractVersion: '0.9.9' },
				{ ...fixtureAdapterRecord(), adapters: [fixtureDescriptor(), fixtureDescriptor()] },
				{
					...fixtureAdapterRecord(),
					adapters: [fixtureDescriptor(), adapterWith({ capacityProvenance: 'flauz-provisioned' })],
				},
				{ ...fixtureAdapterRecord(), adapters: foreign('null') },
			]) {
				assert.equal(isProviderAdapterRecord(probe), false, `probe must be rejected: ${JSON.stringify(probe)}`);
			}
		});

		test('the record shape guard does not decide the catalog binding (admission-time law)', () => {
			const dangling = {
				...fixtureAdapterRecord(),
				adapters: [adapterWith({ providerEntryId: FIXTURE_ENTRY_MOON })],
			};
			assert.equal(isProviderAdapterRecord(dangling), true);
			assert.equal(
				rejectedRecord(admitProviderAdapterRecord(dangling, fixtureCatalogRecord())).reason,
				'unknown-provider-entry',
			);
		});

		test('isAdapterHealthReport accepts the folded report and rejects malformed probes', () => {
			assert.equal(isAdapterHealthReport(fixtureReport()), true);
			assert.equal(isAdapterHealthReport(markReportVerified(fixtureReport())), true);
			for (const probe of [
				null,
				42,
				{ ...fixtureReport(), contractVersion: '0.9.9' },
				{ ...fixtureReport(), adapterId: '' },
				{ ...fixtureReport(), provenance: foreign('null') },
				{ ...fixtureReport(), snapshot: foreign('null') },
			]) {
				assert.equal(isAdapterHealthReport(probe), false, `probe must be rejected: ${JSON.stringify(probe)}`);
			}
		});

		test('isAdapterHealthReport rejects a misattributed report (provenance vs snapshot provider)', () => {
			const misattributed = {
				...fixtureReport(),
				provenance: unverifiedProvenance({
					...fixtureProvenanceInput(),
					requestedProviderId: FIXTURE_ENTRY_BETA,
					actualProviderId: FIXTURE_ENTRY_BETA,
				}),
			};
			assert.equal(isAdapterHealthReport(misattributed), false);
		});

		test('isAdapterHealthReport rejects a report whose observation times disagree', () => {
			const mismatched = { ...fixtureReport(), observedAtEpochMs: FIXTURE_NOW_MS + 1 };
			assert.equal(isAdapterHealthReport(mismatched), false);
		});
	});

	suite('determinism greps (the injected-clock law)', () => {
		const moduleSource = readFileSync(
			fileURLToPath(new URL('../../common/providerAdapter.ts', import.meta.url)),
			'utf8',
		);

		test('the common module carries no Date.now, Math.random or new Date call sites (law comments only)', () => {
			const matches = moduleSource
				.split('\n')
				.filter((line) => line.match(/Date\.now|Math\.random|new Date\(/));
			assert.equal(matches.length > 0, true, 'the determinism law comment must exist');
			for (const line of matches) {
				assert.equal(
					/^\s*(\*|\/\/|\/\*)/.test(line),
					true,
					`only law-comment lines may quote the banned calls, got: ${line}`,
				);
			}
		});

		test('the common module carries no process.env read (law comments only)', () => {
			const matches = moduleSource.split('\n').filter((line) => line.includes('process.env'));
			for (const line of matches) {
				assert.equal(
					/^\s*(\*|\/\/|\/\*)/.test(line),
					true,
					`only law-comment lines may quote process.env, got: ${line}`,
				);
			}
		});
	});
});
