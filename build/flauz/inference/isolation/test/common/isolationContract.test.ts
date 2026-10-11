/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-007 isolation contract test suite (mocha tdd style, matching
 * build/flauz/inference/matching/test/common/matchingContract.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, credential
 * handle, scope id, scope set id, catalog id and probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the usage classes, the verdicts, the
 * rejection reasons, the resolution reasons, the version stamps) are
 * the contract's own values under test. The three disclosed fixture
 * scope ids (fixture.scope.permitted / fixture.scope.unknown-term /
 * fixture.scope.prohibited) are the kit module's own exported
 * constants, registered by the kit suite against its fixture bound
 * records. Runtime-boundary probes are injected as JSON-parsed
 * values. All timestamps ride the fixed injected clock; the suites
 * never read a clock.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	INFERENCE_ISOLATION_VERSION,
	ISOLATION_ELIGIBILITY_PROBE_SCOPE,
	ISOLATION_REJECTION_REASONS,
	ISOLATION_RESOLUTION_REASONS,
	TERM_ELIGIBILITY_VERDICTS,
	USAGE_CLASSES,
	admitCredentialScope,
	admitCredentialScopeSet,
	isCredentialScopeDescriptor,
	isEligibilityDecisionRecord,
	isUsageClass,
	serializeCredentialScope,
	serializeEligibilityDecision,
	verdictForTermState,
} from '../../common/isolationContract.js';
import type { CredentialScopeDescriptor } from '../../common/isolationContract.js';
import {
	FIXTURE_SCOPE_PERMITTED_ID,
	FIXTURE_SCOPE_PROHIBITED_ID,
	FIXTURE_SCOPE_UNKNOWN_TERM_ID,
} from '../../common/isolationKit.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	markProvenanceVerified,
	unverifiedProvenance,
} from '../../../semantics/common/capacityDisclosure.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.isolation';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.isolation';
const FIXTURE_SCOPE_SET_ID = 'fixture.scope-set.isolation';
const FIXTURE_PROVIDER_ALPHA = 'fixture.provider.alpha';
const FIXTURE_PROVIDER_BETA = 'fixture.provider.beta';
const FIXTURE_PROVIDER_GAMMA = 'fixture.provider.gamma';
const FIXTURE_PROVIDER_DELTA = 'fixture.provider.delta';
const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_GAMMA = 'fixture.adapter.gamma';
const FIXTURE_ADAPTER_DELTA = 'fixture.adapter.delta';
const FIXTURE_CREDENTIAL_ALPHA = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_BETA = 'fixture.credential.handle.beta';
const FIXTURE_CREDENTIAL_GAMMA = 'fixture.credential.handle.gamma';
const FIXTURE_CREDENTIAL_DELTA = 'fixture.credential.handle.delta';
const FIXTURE_SCOPE_DELTA_ID = 'fixture.scope.delta';
const FIXTURE_NOW_MS = 1_700_000_000_000;

function fixtureCatalogRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			{
				...unknownCapacityEntry(FIXTURE_PROVIDER_ALPHA, 'third-party-free-tier', FIXTURE_NOW_MS),
				termsState: 'permitted',
			},
			unknownCapacityEntry(FIXTURE_PROVIDER_BETA, 'user-owned-endpoint', FIXTURE_NOW_MS),
			{
				...unknownCapacityEntry(FIXTURE_PROVIDER_GAMMA, 'third-party-free-tier', FIXTURE_NOW_MS),
				termsState: 'prohibited',
			},
			{
				...unknownCapacityEntry(FIXTURE_PROVIDER_DELTA, 'user-owned-endpoint', FIXTURE_NOW_MS),
				termsState: 'permitted',
			},
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureAdapterRecord(): ProviderAdapterRecord {
	return {
		adapterSetId: FIXTURE_ADAPTER_SET_ID,
		adapters: [
			{
				adapterId: FIXTURE_ADAPTER_ALPHA,
				displayName: 'Fixture Adapter Alpha',
				providerEntryId: FIXTURE_PROVIDER_ALPHA,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_ALPHA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_BETA,
				displayName: 'Fixture Adapter Beta',
				providerEntryId: FIXTURE_PROVIDER_BETA,
				transportKind: 'local-sidecar',
				capacityProvenance: 'user-owned-endpoint',
				credentialHandle: FIXTURE_CREDENTIAL_BETA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_GAMMA,
				displayName: 'Fixture Adapter Gamma',
				providerEntryId: FIXTURE_PROVIDER_GAMMA,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_GAMMA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_DELTA,
				displayName: 'Fixture Adapter Delta',
				providerEntryId: FIXTURE_PROVIDER_DELTA,
				transportKind: 'http-generic-json',
				capacityProvenance: 'user-owned-endpoint',
				credentialHandle: FIXTURE_CREDENTIAL_DELTA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
		],
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

/**
 * The cross-inconsistent hand-built adapter record (the battery fires
 * the catalog-dangling direction with it): the delta adapter
 * references a provider the bound catalog does not carry.
 */
function nowhereAdapterRecord(): ProviderAdapterRecord {
	return {
		...fixtureAdapterRecord(),
		adapters: fixtureAdapterRecord().adapters.map((adapter) =>
			adapter.adapterId === FIXTURE_ADAPTER_DELTA
				? { ...adapter, providerEntryId: 'fixture.provider.nowhere' }
				: adapter,
		),
	};
}

function scopeCandidate(id: string, adapterId: string, handleRef: string): Record<string, unknown> {
	return { id, adapterId, handleRef };
}

function fixtureDecidedDecision(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		kind: 'decided',
		contractVersion: INFERENCE_ISOLATION_VERSION,
		scopeId: FIXTURE_SCOPE_PERMITTED_ID,
		adapterId: FIXTURE_ADAPTER_ALPHA,
		providerEntryId: FIXTURE_PROVIDER_ALPHA,
		usageClass: 'product-inference',
		termsState: 'permitted',
		verdict: 'eligible',
		metadataVerification: 'unverified',
		provenance: unverifiedProvenance({
			requestedProviderId: FIXTURE_PROVIDER_ALPHA,
			requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
			actualProviderId: FIXTURE_PROVIDER_ALPHA,
			actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
			recordedAtEpochMs: FIXTURE_NOW_MS,
		}),
		decidedAtEpochMs: FIXTURE_NOW_MS,
		...overrides,
	};
}

function fixtureRefusalDecision(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		kind: 'no-eligible-binding',
		contractVersion: INFERENCE_ISOLATION_VERSION,
		decidedAtEpochMs: FIXTURE_NOW_MS,
		detail: 'fixture: no eligible binding to decide',
		...overrides,
	};
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-007 isolation contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('INFERENCE_ISOLATION_VERSION is 1.0.0', () => {
			assert.equal(INFERENCE_ISOLATION_VERSION, '1.0.0');
		});

		test('the isolation stamp and the landed sub-record stamps are distinct roles', () => {
			const decision = fixtureDecidedDecision();
			assert.equal(isEligibilityDecisionRecord(decision), true);
			const record = decision as { contractVersion: string; provenance: { contractVersion: string } };
			assert.equal(record.contractVersion, INFERENCE_ISOLATION_VERSION);
			assert.equal(record.provenance.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});
	});

	suite('ISOLATION_REJECTION_REASONS (the frozen list)', () => {
		test('the exact frozen contents and order', () => {
			assert.deepEqual(ISOLATION_REJECTION_REASONS, [
				'not-an-object',
				'version-mismatch',
				'invalid-scope-set-id',
				'invalid-scopes',
				'invalid-scope',
				'secret-shaped-scope',
				'invalid-scope-id',
				'invalid-adapter-id',
				'invalid-handle-ref',
				'unresolved-adapter-binding',
				'unresolved-catalog-entry',
				'credential-handle-mismatch',
				'duplicate-scope-id',
			]);
		});

		test('the list is unique (no reason can fire twice)', () => {
			assert.equal(new Set(ISOLATION_REJECTION_REASONS).size, ISOLATION_REJECTION_REASONS.length);
		});

		test('the no-secret, dangling-ref, handle-mismatch and duplicate members are members', () => {
			const reasons = ISOLATION_REJECTION_REASONS as readonly string[];
			assert.equal(reasons.includes('secret-shaped-scope'), true);
			assert.equal(reasons.includes('unresolved-adapter-binding'), true);
			assert.equal(reasons.includes('unresolved-catalog-entry'), true);
			assert.equal(reasons.includes('credential-handle-mismatch'), true);
			assert.equal(reasons.includes('duplicate-scope-id'), true);
		});
	});

	suite('USAGE_CLASSES (the frozen usage-class vocabulary)', () => {
		test('the exact frozen contents, order and uniqueness', () => {
			assert.deepEqual(USAGE_CLASSES, [
				'product-inference',
				'routing-failover',
				'matching-selection',
				'sidecar-report',
			]);
			assert.equal(new Set(USAGE_CLASSES).size, USAGE_CLASSES.length);
		});

		test('the four landed-surface classes; widening is a versioned decision', () => {
			const classes = USAGE_CLASSES as readonly string[];
			assert.equal(classes.includes('product-inference'), true);
			assert.equal(classes.includes('routing-failover'), true);
			assert.equal(classes.includes('matching-selection'), true);
			assert.equal(classes.includes('sidecar-report'), true);
			assert.equal(classes.includes('training-eval'), false);
		});

		test('isUsageClass: both directions', () => {
			assert.equal(isUsageClass('product-inference'), true);
			assert.equal(isUsageClass('sidecar-report'), true);
			assert.equal(isUsageClass('batch-training'), false);
			assert.equal(isUsageClass(undefined), false);
			assert.equal(isUsageClass(42), false);
		});
	});

	suite('TERM_ELIGIBILITY_VERDICTS (the frozen verdicts)', () => {
		test('the exact frozen contents, order and uniqueness', () => {
			assert.deepEqual(TERM_ELIGIBILITY_VERDICTS, ['eligible', 'ineligible', 'term-unknown']);
			assert.equal(new Set(TERM_ELIGIBILITY_VERDICTS).size, TERM_ELIGIBILITY_VERDICTS.length);
		});

		test("the honest-unknown member 'term-unknown' is first-class (never a silent null)", () => {
			assert.equal(typeof TERM_ELIGIBILITY_VERDICTS[2], 'string');
			assert.equal((TERM_ELIGIBILITY_VERDICTS as readonly string[]).includes('term-unknown'), true);
			assert.equal((TERM_ELIGIBILITY_VERDICTS as readonly string[]).includes('auto-eligible'), false);
		});

		test('verdictForTermState: the total deterministic fold over the landed term states', () => {
			assert.equal(verdictForTermState('permitted'), 'eligible');
			assert.equal(verdictForTermState('prohibited'), 'ineligible');
			assert.equal(verdictForTermState('unknown'), 'term-unknown');
		});
	});

	suite('ISOLATION_ELIGIBILITY_PROBE_SCOPE (the provenance scope-label convention)', () => {
		test('the scope label value - a scope label, never a model claim', () => {
			assert.equal(ISOLATION_ELIGIBILITY_PROBE_SCOPE, 'isolation.eligibility-probe');
		});
	});

	suite('ISOLATION_RESOLUTION_REASONS (the typed resolution verdict vocabulary)', () => {
		test('the exact frozen contents (the one-member list) and uniqueness', () => {
			assert.deepEqual(ISOLATION_RESOLUTION_REASONS, ['unknown-scope']);
			assert.equal(new Set(ISOLATION_RESOLUTION_REASONS).size, ISOLATION_RESOLUTION_REASONS.length);
		});
	});

	suite('admitCredentialScope (the scope walk)', () => {
		test('admits a well-formed scope and carries the triple verbatim', () => {
			const admission = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true, JSON.stringify(admission));
			if (admission.admitted) {
				assert.deepEqual(admission.scope, {
					id: FIXTURE_SCOPE_PERMITTED_ID,
					adapterId: FIXTURE_ADAPTER_ALPHA,
					handleRef: FIXTURE_CREDENTIAL_ALPHA,
				});
			}
		});

		test('rejects non-objects', () => {
			for (const candidate of [undefined, null, 42, 'scope']) {
				const admission = admitCredentialScope(candidate, fixtureAdapterRecord(), fixtureCatalogRecord());
				assert.equal(admission.admitted, false);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'not-an-object');
				}
			}
		});

		test('THE NO-SECRET LAW fires first: a secret-only candidate is the secret shape, never invalid-scope-id', () => {
			const admission = admitCredentialScope(
				{ apiKey: 'fixture.secret.material' },
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
				assert.match(admission.detail, /beyond the typed reference shape/);
			}
		});

		test('rejects a scope carrying an extra apiKey field (the no-secret law)', () => {
			const admission = admitCredentialScope(
				{
					...scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
					apiKey: 'fixture.secret.material',
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
				assert.match(admission.detail, /'apiKey'/);
			}
		});

		test('rejects a scope carrying an extra token field (the no-secret law)', () => {
			const admission = admitCredentialScope(
				{
					...scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
					token: 'fixture.secret.bearer',
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
			}
		});

		test('rejects a scope carrying even the family version stamp (the triple is minimal)', () => {
			const admission = admitCredentialScope(
				{
					...scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
					contractVersion: INFERENCE_ISOLATION_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
			}
		});

		test('rejects a JSON-parsed foreign secret-shaped candidate (the runtime boundary)', () => {
			const candidate = foreign(
				JSON.stringify({
					id: FIXTURE_SCOPE_PERMITTED_ID,
					adapterId: FIXTURE_ADAPTER_ALPHA,
					handleRef: FIXTURE_CREDENTIAL_ALPHA,
					env: 'FIXTURE_PROVIDER_KEY',
				}),
			);
			const admission = admitCredentialScope(candidate, fixtureAdapterRecord(), fixtureCatalogRecord());
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
			}
		});

		test('rejects an empty id, an empty adapter id and an empty handle ref', () => {
			const adapters = fixtureAdapterRecord();
			const catalog = fixtureCatalogRecord();
			const emptyId = admitCredentialScope(
				scopeCandidate('', FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
				adapters,
				catalog,
			);
			assert.equal(emptyId.admitted, false);
			if (!emptyId.admitted) {
				assert.equal(emptyId.reason, 'invalid-scope-id');
			}
			const emptyAdapter = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, '', FIXTURE_CREDENTIAL_ALPHA),
				adapters,
				catalog,
			);
			assert.equal(emptyAdapter.admitted, false);
			if (!emptyAdapter.admitted) {
				assert.equal(emptyAdapter.reason, 'invalid-adapter-id');
			}
			const emptyHandle = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, ''),
				adapters,
				catalog,
			);
			assert.equal(emptyHandle.admitted, false);
			if (!emptyHandle.admitted) {
				assert.equal(emptyHandle.reason, 'invalid-handle-ref');
			}
		});

		test('rejects an unresolved adapter binding (the no-dangling-ref law, direction one)', () => {
			const admission = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, 'fixture.adapter.nowhere', FIXTURE_CREDENTIAL_ALPHA),
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-adapter-binding');
				assert.match(admission.detail, /dangling adapter reference/);
			}
		});

		test('rejects an unresolved catalog entry (the no-dangling-ref law, direction two)', () => {
			const admission = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_DELTA_ID, FIXTURE_ADAPTER_DELTA, FIXTURE_CREDENTIAL_DELTA),
				nowhereAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-catalog-entry');
				assert.match(admission.detail, /dangling catalog reference/);
			}
		});

		test('rejects a caller-invented handle reference (the handle-equality law)', () => {
			const admission = admitCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, 'fixture.credential.invented'),
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'credential-handle-mismatch');
				assert.match(admission.detail, /EQUAL the bound adapter record's own credentialHandle/);
			}
		});

		test('the guard is pure: a rejected candidate is untouched', () => {
			const candidate = scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, 'fixture.adapter.nowhere', 'x');
			const before = JSON.stringify(candidate);
			admitCredentialScope(candidate, fixtureAdapterRecord(), fixtureCatalogRecord());
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('admitCredentialScopeSet (the set walk)', () => {
		test('admits a well-formed set with the scopes preserved in order', () => {
			const admission = admitCredentialScopeSet(
				{
					scopeSetId: FIXTURE_SCOPE_SET_ID,
					scopes: [
						scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
						scopeCandidate(FIXTURE_SCOPE_UNKNOWN_TERM_ID, FIXTURE_ADAPTER_BETA, FIXTURE_CREDENTIAL_BETA),
					],
					contractVersion: INFERENCE_ISOLATION_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true, JSON.stringify(admission));
			if (admission.admitted) {
				assert.equal(admission.record.scopeSetId, FIXTURE_SCOPE_SET_ID);
				assert.equal(admission.record.scopes.length, 2);
				assert.equal(admission.record.scopes[0].id, FIXTURE_SCOPE_PERMITTED_ID);
				assert.equal(admission.record.scopes[1].id, FIXTURE_SCOPE_UNKNOWN_TERM_ID);
				assert.equal(admission.record.contractVersion, INFERENCE_ISOLATION_VERSION);
			}
		});

		test('rejects non-objects, version mismatches, an empty set id and non-array scopes', () => {
			const adapters = fixtureAdapterRecord();
			const catalog = fixtureCatalogRecord();
			const notAnObject = admitCredentialScopeSet(undefined, adapters, catalog);
			assert.equal(notAnObject.admitted, false);
			if (!notAnObject.admitted) {
				assert.equal(notAnObject.reason, 'not-an-object');
			}
			const versionMismatch = admitCredentialScopeSet(
				{ scopeSetId: FIXTURE_SCOPE_SET_ID, scopes: [], contractVersion: '0.0.9' },
				adapters,
				catalog,
			);
			assert.equal(versionMismatch.admitted, false);
			if (!versionMismatch.admitted) {
				assert.equal(versionMismatch.reason, 'version-mismatch');
			}
			const emptySetId = admitCredentialScopeSet(
				{ scopeSetId: '', scopes: [], contractVersion: INFERENCE_ISOLATION_VERSION },
				adapters,
				catalog,
			);
			assert.equal(emptySetId.admitted, false);
			if (!emptySetId.admitted) {
				assert.equal(emptySetId.reason, 'invalid-scope-set-id');
			}
			const nonArray = admitCredentialScopeSet(
				{ scopeSetId: FIXTURE_SCOPE_SET_ID, scopes: 'nope', contractVersion: INFERENCE_ISOLATION_VERSION },
				adapters,
				catalog,
			);
			assert.equal(nonArray.admitted, false);
			if (!nonArray.admitted) {
				assert.equal(nonArray.reason, 'invalid-scopes');
			}
		});

		test('rejects a malformed scope with the scope walk cited verbatim in the detail', () => {
			const admission = admitCredentialScopeSet(
				{
					scopeSetId: FIXTURE_SCOPE_SET_ID,
					scopes: [scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, 'fixture.adapter.nowhere', 'x')],
					contractVersion: INFERENCE_ISOLATION_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'invalid-scope');
				assert.match(admission.detail, /admitCredentialScope: 'unresolved-adapter-binding'/);
			}
		});

		test('rejects a secret-shaped scope inside the set (the no-secret law through the fold)', () => {
			const admission = admitCredentialScopeSet(
				{
					scopeSetId: FIXTURE_SCOPE_SET_ID,
					scopes: [
						{
							...scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
							secret: 'fixture.secret.material',
						},
					],
					contractVersion: INFERENCE_ISOLATION_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'invalid-scope');
				assert.match(admission.detail, /'secret-shaped-scope'/);
			}
		});

		test('rejects a duplicate scope id (never a silent overwrite)', () => {
			const admission = admitCredentialScopeSet(
				{
					scopeSetId: FIXTURE_SCOPE_SET_ID,
					scopes: [
						scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
						scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_DELTA, FIXTURE_CREDENTIAL_DELTA),
					],
					contractVersion: INFERENCE_ISOLATION_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'duplicate-scope-id');
				assert.match(admission.detail, /never a silent overwrite/);
			}
		});

		test('the empty set is honest (zero scopes admitted)', () => {
			const admission = admitCredentialScopeSet(
				{ scopeSetId: FIXTURE_SCOPE_SET_ID, scopes: [], contractVersion: INFERENCE_ISOLATION_VERSION },
				fixtureAdapterRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true);
			if (admission.admitted) {
				assert.equal(admission.record.scopes.length, 0);
			}
		});
	});

	suite('isCredentialScopeDescriptor (the shape guard, both directions)', () => {
		test('admits well-formed scopes, both directions', () => {
			assert.equal(
				isCredentialScopeDescriptor(scopeCandidate('s', FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA)),
				true,
			);
			assert.equal(
				isCredentialScopeDescriptor(foreign(JSON.stringify(scopeCandidate('s', 'a', 'h')))),
				true,
			);
		});

		test('rejects non-objects, malformed fields and missing fields', () => {
			assert.equal(isCredentialScopeDescriptor(undefined), false);
			assert.equal(isCredentialScopeDescriptor(null), false);
			assert.equal(isCredentialScopeDescriptor(42), false);
			assert.equal(isCredentialScopeDescriptor({ id: '', adapterId: 'a', handleRef: 'h' }), false);
			assert.equal(isCredentialScopeDescriptor({ id: 's', adapterId: '', handleRef: 'h' }), false);
			assert.equal(isCredentialScopeDescriptor({ id: 's', adapterId: 'a', handleRef: '' }), false);
			assert.equal(isCredentialScopeDescriptor({ id: 's', adapterId: 'a' }), false);
		});

		test('rejects secret-shaped scopes at the shape level (the no-secret guard, shape direction)', () => {
			assert.equal(
				isCredentialScopeDescriptor({ id: 's', adapterId: 'a', handleRef: 'h', apiKey: 'x' }),
				false,
			);
			assert.equal(
				isCredentialScopeDescriptor(foreign('{"id":"s","adapterId":"a","handleRef":"h","token":"t"}')),
				false,
			);
		});

		test('the shipped types cannot express a secret-shaped scope (the compile-time direction)', () => {
			const typedTriple: CredentialScopeDescriptor = {
				id: 'fixture.scope.typed-pin',
				adapterId: FIXTURE_ADAPTER_ALPHA,
				handleRef: FIXTURE_CREDENTIAL_ALPHA,
			};
			assert.equal(typedTriple.handleRef, FIXTURE_CREDENTIAL_ALPHA);
			// The compile-time pin: an object literal carrying a field beyond
			// the typed triple errors under excess-property checking - the
			// directive below fails the scoped tsc gate if the error ever
			// disappears (the no-secret law made structural at the type level).
			const secretShaped: CredentialScopeDescriptor = {
				id: 'fixture.scope.typed-pin',
				adapterId: FIXTURE_ADAPTER_ALPHA,
				handleRef: FIXTURE_CREDENTIAL_ALPHA,
				// @ts-expect-error - a field beyond the typed reference triple is unrepresentable
				apiKey: 'fixture.secret.material',
			};
			assert.equal(secretShaped.handleRef, FIXTURE_CREDENTIAL_ALPHA);
		});
	});

	suite('serializeCredentialScope (canonical bytes)', () => {
		test('double-run byte-equal', () => {
			const scope = scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			assert.equal(serializeCredentialScope(scope), serializeCredentialScope(scope));
		});

		test('key-insertion-order independence: scrambled input keys, same bytes', () => {
			const ordered = scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const scrambled = foreign(
				JSON.stringify({
					handleRef: FIXTURE_CREDENTIAL_ALPHA,
					id: FIXTURE_SCOPE_PERMITTED_ID,
					adapterId: FIXTURE_ADAPTER_ALPHA,
				}),
			);
			assert.equal(serializeCredentialScope(scrambled), serializeCredentialScope(ordered));
		});

		test('the bytes pin the fixed key order (the exact triple bytes)', () => {
			const bytes = serializeCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
			);
			assert.equal(
				bytes,
				'{"id":"fixture.scope.permitted","adapterId":"fixture.adapter.alpha","handleRef":"fixture.credential.handle.alpha"}',
			);
		});

		test('the bytes carry no field beyond the typed triple (the no-secret law, byte level)', () => {
			const bytes = serializeCredentialScope(
				scopeCandidate(FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA),
			);
			const parsed = foreign(bytes) as Record<string, unknown>;
			assert.deepEqual(Object.keys(parsed).sort(), ['adapterId', 'handleRef', 'id']);
		});

		test('refuses a malformed scope fail-closed (no dishonest scope gets canonical bytes)', () => {
			assert.throws(
				() => serializeCredentialScope({ id: 's', adapterId: 'a', handleRef: 'h', apiKey: 'x' }),
				/serializeCredentialScope: scope must satisfy isCredentialScopeDescriptor/,
			);
			assert.throws(() => serializeCredentialScope(undefined), TypeError);
		});
	});

	suite('isEligibilityDecisionRecord (the decision guard, both directions)', () => {
		test('admits the decided fixture (permitted -> eligible)', () => {
			assert.equal(isEligibilityDecisionRecord(fixtureDecidedDecision()), true);
		});

		test('admits the unknown-term fixture (the honest-unknown verdict)', () => {
			const decision = fixtureDecidedDecision({
				scopeId: FIXTURE_SCOPE_UNKNOWN_TERM_ID,
				adapterId: FIXTURE_ADAPTER_BETA,
				providerEntryId: FIXTURE_PROVIDER_BETA,
				termsState: 'unknown',
				verdict: 'term-unknown',
				provenance: unverifiedProvenance({
					requestedProviderId: FIXTURE_PROVIDER_BETA,
					requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					actualProviderId: FIXTURE_PROVIDER_BETA,
					actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					recordedAtEpochMs: FIXTURE_NOW_MS,
				}),
			});
			assert.equal(isEligibilityDecisionRecord(decision), true);
		});

		test('admits the prohibited fixture (the ineligible verdict)', () => {
			const decision = fixtureDecidedDecision({
				scopeId: FIXTURE_SCOPE_PROHIBITED_ID,
				adapterId: FIXTURE_ADAPTER_GAMMA,
				providerEntryId: FIXTURE_PROVIDER_GAMMA,
				termsState: 'prohibited',
				verdict: 'ineligible',
				provenance: unverifiedProvenance({
					requestedProviderId: FIXTURE_PROVIDER_GAMMA,
					requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					actualProviderId: FIXTURE_PROVIDER_GAMMA,
					actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					recordedAtEpochMs: FIXTURE_NOW_MS,
				}),
			});
			assert.equal(isEligibilityDecisionRecord(decision), true);
		});

		test('admits the no-eligible-binding refusal fixture', () => {
			assert.equal(isEligibilityDecisionRecord(fixtureRefusalDecision()), true);
		});

		test('admits a caller-promoted decision (the delegated one-way markProvenanceVerified)', () => {
			const base = fixtureDecidedDecision();
			const promoted = {
				...base,
				provenance: markProvenanceVerified(base.provenance as Parameters<typeof markProvenanceVerified>[0]),
			};
			assert.equal(isEligibilityDecisionRecord(promoted), true);
			assert.equal(
				(promoted.provenance as { modelVerification: string }).modelVerification,
				'verified',
			);
		});

		test('rejects non-objects, bad kinds and version mismatches', () => {
			assert.equal(isEligibilityDecisionRecord(undefined), false);
			assert.equal(isEligibilityDecisionRecord(null), false);
			assert.equal(isEligibilityDecisionRecord(42), false);
			assert.equal(isEligibilityDecisionRecord({ kind: 'decided' }), false);
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), kind: 'maybe' }), false);
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), contractVersion: '0.0.9' }), false);
			assert.equal(isEligibilityDecisionRecord({ ...fixtureRefusalDecision(), contractVersion: '0.0.9' }), false);
		});

		test('rejects a malformed refusal (non-finite instant, empty detail)', () => {
			assert.equal(
				isEligibilityDecisionRecord({ ...fixtureRefusalDecision(), decidedAtEpochMs: Number.NaN }),
				false,
			);
			assert.equal(isEligibilityDecisionRecord({ ...fixtureRefusalDecision(), detail: '' }), false);
		});

		test('rejects a usage class outside the frozen vocabulary', () => {
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), usageClass: 'batch-training' }), false);
		});

		test('rejects a terms state outside the landed vocabulary', () => {
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), termsState: 'maybe' }), false);
		});

		test('rejects a verdict outside the frozen vocabulary', () => {
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), verdict: 'auto-eligible' }), false);
		});

		test('THE HONEST-UNKNOWN LAW structural: the verdict is the total fold of the term state', () => {
			assert.equal(
				isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), termsState: 'unknown' }),
				false,
			);
			assert.equal(
				isEligibilityDecisionRecord({
					...fixtureDecidedDecision(),
					termsState: 'permitted',
					verdict: 'term-unknown',
				}),
				false,
			);
			assert.equal(
				isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), termsState: 'prohibited' }),
				false,
			);
			assert.equal(
				isEligibilityDecisionRecord({
					...fixtureDecidedDecision(),
					termsState: 'unknown',
					verdict: 'ineligible',
				}),
				false,
			);
		});

		test('rejects a malformed provenance (fails the landed admitProvenance)', () => {
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), provenance: undefined }), false);
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), provenance: { bad: true } }), false);
		});

		test('rejects a provenance inconsistent with the provider binding and the probe scope label', () => {
			const otherProvider = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_GAMMA,
				requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				actualProviderId: FIXTURE_PROVIDER_GAMMA,
				actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			assert.equal(
				isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), provenance: otherProvider }),
				false,
			);
			const modelClaim = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_ALPHA,
				requestedModelId: 'fixture.model.claim',
				actualProviderId: FIXTURE_PROVIDER_ALPHA,
				actualModelId: 'fixture.model.claim',
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), provenance: modelClaim }), false);
		});

		test('rejects a provenance recording instant disagreeing with the decision instant (one decision, one time)', () => {
			const otherTime = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_ALPHA,
				requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				actualProviderId: FIXTURE_PROVIDER_ALPHA,
				actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				recordedAtEpochMs: FIXTURE_NOW_MS + 1,
			});
			assert.equal(isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), provenance: otherTime }), false);
		});

		test('rejects a metadata verification state outside the landed vocabulary', () => {
			assert.equal(
				isEligibilityDecisionRecord({ ...fixtureDecidedDecision(), metadataVerification: 'sometimes' }),
				false,
			);
		});
	});

	suite('serializeEligibilityDecision (canonical bytes)', () => {
		test('double-run byte-equal', () => {
			const decision = fixtureDecidedDecision();
			assert.equal(serializeEligibilityDecision(decision), serializeEligibilityDecision(decision));
		});

		test('key-insertion-order independence: scrambled top-level and nested keys, same bytes', () => {
			const ordered = fixtureDecidedDecision();
			const scrambled = foreign(
				JSON.stringify({
					decidedAtEpochMs: FIXTURE_NOW_MS,
					provenance: foreign(JSON.stringify(ordered.provenance)),
					metadataVerification: 'unverified',
					verdict: 'eligible',
					termsState: 'permitted',
					usageClass: 'product-inference',
					providerEntryId: FIXTURE_PROVIDER_ALPHA,
					adapterId: FIXTURE_ADAPTER_ALPHA,
					scopeId: FIXTURE_SCOPE_PERMITTED_ID,
					contractVersion: INFERENCE_ISOLATION_VERSION,
					kind: 'decided',
				}),
			);
			assert.equal(serializeEligibilityDecision(scrambled), serializeEligibilityDecision(ordered));
		});

		test('the decided bytes pin the fixed key order (the exact byte string)', () => {
			const bytes = serializeEligibilityDecision(fixtureDecidedDecision());
			assert.equal(
				bytes,
				'{"kind":"decided","contractVersion":"1.0.0","scopeId":"fixture.scope.permitted","adapterId":"fixture.adapter.alpha","providerEntryId":"fixture.provider.alpha","usageClass":"product-inference","termsState":"permitted","verdict":"eligible","metadataVerification":"unverified","provenance":{"contractVersion":"1.0.0","requestedProviderId":"fixture.provider.alpha","requestedModelId":"isolation.eligibility-probe","actualProviderId":"fixture.provider.alpha","actualModelId":"isolation.eligibility-probe","substitution":"none","modelVerification":"unverified","recordedAtEpochMs":1700000000000},"decidedAtEpochMs":1700000000000}',
			);
		});

		test('the refusal bytes pin the fixed key order', () => {
			const bytes = serializeEligibilityDecision(fixtureRefusalDecision());
			assert.equal(
				bytes,
				'{"kind":"no-eligible-binding","contractVersion":"1.0.0","decidedAtEpochMs":1700000000000,"detail":"fixture: no eligible binding to decide"}',
			);
		});

		test('the provenance sub-record rides the landed canonical key order', () => {
			const bytes = serializeEligibilityDecision(fixtureDecidedDecision());
			const parsed = foreign(bytes) as { provenance: Record<string, unknown> };
			assert.deepEqual(Object.keys(parsed.provenance), [
				'contractVersion',
				'requestedProviderId',
				'requestedModelId',
				'actualProviderId',
				'actualModelId',
				'substitution',
				'modelVerification',
				'recordedAtEpochMs',
			]);
		});

		test('refuses a malformed decision fail-closed (no dishonest decision gets canonical bytes)', () => {
			assert.throws(
				() => serializeEligibilityDecision({ kind: 'decided' }),
				/serializeEligibilityDecision: decision must satisfy isEligibilityDecisionRecord/,
			);
			assert.throws(
				() => serializeEligibilityDecision({ ...fixtureDecidedDecision(), verdict: 'auto-eligible' }),
				TypeError,
			);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in isolationContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/isolationContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in isolationKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/isolationKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
