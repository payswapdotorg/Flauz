/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-006 matching contract test suite (mocha tdd style, matching
 * build/flauz/inference/routing/test/common/routingContract.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle, matrix id and probe value below is SYNTHETIC
 * (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the verdicts, the rejection reasons,
 * the modality set, the version stamps) are the contract's own
 * values under test. Runtime-boundary probes are injected as
 * JSON-parsed values, the shape foreign input arrives in at a real
 * boundary. All timestamps are injected plain-number epoch
 * milliseconds; the suites never read a clock.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CONTEXT_WINDOW_VERDICTS,
	INFERENCE_MATCHING_VERSION,
	MATCHING_REJECTION_REASONS,
	MATCH_VERDICTS,
	MODALITY_COVERAGE_VERDICTS,
	OUTPUT_CAP_VERDICTS,
	admitMatchCandidate,
	admitMatchMatrix,
	admitMatchRequest,
	isMatchCandidateDescriptor,
	isMatchDecisionRecord,
	isMatchRequestDescriptor,
	serializeMatchCandidate,
	serializeMatchDecision,
} from '../../common/matchingContract.js';
import { INFERENCE_SEMANTICS_CONTRACTS_VERSION, unverifiedProvenance } from '../../../semantics/common/capacityDisclosure.js';
import { ROUTING_SELECTION_RULES } from '../../../routing/common/routingContract.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import { MODEL_MODALITIES } from '../../../catalog/common/capabilityMatrix.js';
import type { CapabilityMatrixRecord } from '../../../catalog/common/capabilityMatrix.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';
import {
	FIXTURE_MATCH_FITS_ID,
	FIXTURE_MATCH_MODALITY_MISSING_ID,
	FIXTURE_MATCH_TOO_SMALL_ID,
} from '../../common/matchingKit.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.matching';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.matching';
const FIXTURE_MATRIX_ID = 'fixture.matrix.matching';
const FIXTURE_PROVIDER_ALPHA = 'fixture.provider.alpha';
const FIXTURE_PROVIDER_BETA = 'fixture.provider.beta';
const FIXTURE_PROVIDER_GAMMA = 'fixture.provider.gamma';
const FIXTURE_PROVIDER_DELTA = 'fixture.provider.delta';
const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_GAMMA = 'fixture.adapter.gamma';
const FIXTURE_ADAPTER_DELTA = 'fixture.adapter.delta';
const FIXTURE_MODEL_ALPHA_MAIN = 'fixture.model.alpha-main';
const FIXTURE_MODEL_BETA_MAIN = 'fixture.model.beta-main';
const FIXTURE_MODEL_GAMMA_MAIN = 'fixture.model.gamma-main';
const FIXTURE_MODEL_DELTA_ALT = 'fixture.model.delta-alt';
const FIXTURE_MODEL_DELTA_MAIN = 'fixture.model.delta-main';
const FIXTURE_CREDENTIAL_ALPHA = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_BETA = 'fixture.credential.handle.beta';
const FIXTURE_CREDENTIAL_GAMMA = 'fixture.credential.handle.gamma';
const FIXTURE_CREDENTIAL_DELTA = 'fixture.credential.handle.delta';
const FIXTURE_NOW_MS = 1_700_000_000_000;

function fixtureCatalogRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			unknownCapacityEntry(FIXTURE_PROVIDER_ALPHA, 'third-party-free-tier', FIXTURE_NOW_MS),
			unknownCapacityEntry(FIXTURE_PROVIDER_BETA, 'user-owned-endpoint', FIXTURE_NOW_MS),
			unknownCapacityEntry(FIXTURE_PROVIDER_GAMMA, 'third-party-free-tier', FIXTURE_NOW_MS),
			unknownCapacityEntry(FIXTURE_PROVIDER_DELTA, 'user-owned-endpoint', FIXTURE_NOW_MS),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function deltaLessCatalog(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			unknownCapacityEntry(FIXTURE_PROVIDER_ALPHA, 'third-party-free-tier', FIXTURE_NOW_MS),
			unknownCapacityEntry(FIXTURE_PROVIDER_BETA, 'user-owned-endpoint', FIXTURE_NOW_MS),
			unknownCapacityEntry(FIXTURE_PROVIDER_GAMMA, 'third-party-free-tier', FIXTURE_NOW_MS),
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

function fixtureMatrixRecord(): CapabilityMatrixRecord {
	return {
		matrixId: FIXTURE_MATRIX_ID,
		descriptors: [
			{
				modelId: FIXTURE_MODEL_ALPHA_MAIN,
				providerEntryId: FIXTURE_PROVIDER_ALPHA,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_BETA_MAIN,
				providerEntryId: FIXTURE_PROVIDER_BETA,
				contextWindow: { minTokens: 1001, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_GAMMA_MAIN,
				providerEntryId: FIXTURE_PROVIDER_GAMMA,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_DELTA_ALT,
				providerEntryId: FIXTURE_PROVIDER_DELTA,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_DELTA_MAIN,
				providerEntryId: FIXTURE_PROVIDER_DELTA,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function deltaLessMatrix(): CapabilityMatrixRecord {
	return {
		matrixId: FIXTURE_MATRIX_ID,
		descriptors: fixtureMatrixRecord().descriptors.filter(
			(descriptor) => descriptor.providerEntryId !== FIXTURE_PROVIDER_DELTA,
		),
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureEntryCandidate(adapterId: string, declaredPriority?: number): Record<string, unknown> {
	const candidate: Record<string, unknown> = {
		id: FIXTURE_MATCH_FITS_ID,
		adapterId,
		contractVersion: INFERENCE_MATCHING_VERSION,
	};
	if (declaredPriority !== undefined) {
		candidate.declaredPriority = declaredPriority;
	}
	return candidate;
}

const fixtureAlphaMainRow = {
	kind: 'candidate',
	entryId: FIXTURE_MATCH_FITS_ID,
	adapterId: FIXTURE_ADAPTER_ALPHA,
	providerEntryId: FIXTURE_PROVIDER_ALPHA,
	modelId: FIXTURE_MODEL_ALPHA_MAIN,
	contextWindowVerdict: 'context-fits',
	modalityCoverageVerdict: 'modalities-covered',
	missingModalities: [],
	outputCapVerdict: 'output-cap-fits',
	admissible: true,
};

function fixtureMatchedDecision(): Record<string, unknown> {
	return {
		kind: 'matched',
		contractVersion: INFERENCE_MATCHING_VERSION,
		request: { contextTokens: 1000 },
		decidedAtEpochMs: FIXTURE_NOW_MS,
		rows: [fixtureAlphaMainRow],
		ranked: [
			{
				rank: 1,
				entryId: FIXTURE_MATCH_FITS_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				providerEntryId: FIXTURE_PROVIDER_ALPHA,
				modelId: FIXTURE_MODEL_ALPHA_MAIN,
				priority: 0,
			},
		],
		selected: {
			entryId: FIXTURE_MATCH_FITS_ID,
			adapterId: FIXTURE_ADAPTER_ALPHA,
			providerEntryId: FIXTURE_PROVIDER_ALPHA,
			modelId: FIXTURE_MODEL_ALPHA_MAIN,
		},
		substitution: 'none',
		provenance: unverifiedProvenance({
			requestedProviderId: FIXTURE_PROVIDER_ALPHA,
			requestedModelId: FIXTURE_MODEL_ALPHA_MAIN,
			actualProviderId: FIXTURE_PROVIDER_ALPHA,
			actualModelId: FIXTURE_MODEL_ALPHA_MAIN,
			recordedAtEpochMs: FIXTURE_NOW_MS,
		}),
		routing: { adapterId: FIXTURE_ADAPTER_ALPHA, selectionRule: 'stable-adapter-id-order' },
	};
}

function fixtureSubstitutedDecision(): Record<string, unknown> {
	return {
		kind: 'matched',
		contractVersion: INFERENCE_MATCHING_VERSION,
		request: { contextTokens: 1000 },
		decidedAtEpochMs: FIXTURE_NOW_MS,
		rows: [
			{
				kind: 'candidate',
				entryId: 'fixture.match.delta',
				adapterId: FIXTURE_ADAPTER_DELTA,
				providerEntryId: FIXTURE_PROVIDER_DELTA,
				modelId: FIXTURE_MODEL_DELTA_ALT,
				contextWindowVerdict: 'context-fits',
				modalityCoverageVerdict: 'modalities-covered',
				missingModalities: [],
				outputCapVerdict: 'output-cap-fits',
				admissible: true,
			},
			fixtureAlphaMainRow,
		],
		ranked: [
			{
				rank: 1,
				entryId: 'fixture.match.delta',
				adapterId: FIXTURE_ADAPTER_DELTA,
				providerEntryId: FIXTURE_PROVIDER_DELTA,
				modelId: FIXTURE_MODEL_DELTA_ALT,
				priority: 0,
			},
			{
				rank: 2,
				entryId: FIXTURE_MATCH_FITS_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				providerEntryId: FIXTURE_PROVIDER_ALPHA,
				modelId: FIXTURE_MODEL_ALPHA_MAIN,
				priority: 0,
			},
		],
		selected: {
			entryId: FIXTURE_MATCH_FITS_ID,
			adapterId: FIXTURE_ADAPTER_ALPHA,
			providerEntryId: FIXTURE_PROVIDER_ALPHA,
			modelId: FIXTURE_MODEL_ALPHA_MAIN,
		},
		substitution: 'disclosed',
		provenance: unverifiedProvenance({
			requestedProviderId: FIXTURE_PROVIDER_DELTA,
			requestedModelId: FIXTURE_MODEL_DELTA_ALT,
			actualProviderId: FIXTURE_PROVIDER_ALPHA,
			actualModelId: FIXTURE_MODEL_ALPHA_MAIN,
			recordedAtEpochMs: FIXTURE_NOW_MS,
		}),
		routing: { adapterId: FIXTURE_ADAPTER_ALPHA, selectionRule: 'stable-adapter-id-order' },
	};
}

function fixtureNoMatchDecision(): Record<string, unknown> {
	return {
		kind: 'no-matching-candidate',
		contractVersion: INFERENCE_MATCHING_VERSION,
		request: { contextTokens: 1000 },
		decidedAtEpochMs: FIXTURE_NOW_MS,
		rows: [
			{
				kind: 'candidate',
				entryId: FIXTURE_MATCH_TOO_SMALL_ID,
				adapterId: FIXTURE_ADAPTER_BETA,
				providerEntryId: FIXTURE_PROVIDER_BETA,
				modelId: FIXTURE_MODEL_BETA_MAIN,
				contextWindowVerdict: 'context-too-small',
				modalityCoverageVerdict: 'modalities-covered',
				missingModalities: [],
				outputCapVerdict: 'output-cap-fits',
				admissible: false,
			},
		],
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

suite('INF-006 matching contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('INFERENCE_MATCHING_VERSION is 1.0.0', () => {
			assert.equal(INFERENCE_MATCHING_VERSION, '1.0.0');
		});

		test('the matching stamp and the landed sub-record stamps are distinct roles', () => {
			const decision = fixtureMatchedDecision();
			assert.equal(decision.contractVersion, INFERENCE_MATCHING_VERSION);
			const provenance = decision.provenance as { contractVersion: string };
			assert.equal(provenance.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});
	});

	suite('MATCHING_REJECTION_REASONS (the frozen list)', () => {
		test('the exact frozen contents and order', () => {
			assert.deepEqual(MATCHING_REJECTION_REASONS, [
				'not-an-object',
				'version-mismatch',
				'invalid-matrix-id',
				'invalid-entries',
				'invalid-entry',
				'invalid-match-entry-id',
				'invalid-adapter-id',
				'invalid-declared-priority',
				'unresolved-adapter-binding',
				'unresolved-catalog-entry',
				'unresolved-capability-descriptor',
				'duplicate-match-entry-id',
				'invalid-context-tokens',
				'invalid-request-modalities',
				'invalid-output-cap',
				'invalid-request-tag',
				'caller-supplied-provenance',
			]);
		});

		test('the list is unique (no reason can fire twice)', () => {
			assert.equal(new Set(MATCHING_REJECTION_REASONS).size, MATCHING_REJECTION_REASONS.length);
		});

		test('the dangling-ref, duplicate, request-shape and provenance members are members', () => {
			const reasons = MATCHING_REJECTION_REASONS as readonly string[];
			assert.equal(reasons.includes('unresolved-adapter-binding'), true);
			assert.equal(reasons.includes('unresolved-catalog-entry'), true);
			assert.equal(reasons.includes('unresolved-capability-descriptor'), true);
			assert.equal(reasons.includes('duplicate-match-entry-id'), true);
			assert.equal(reasons.includes('invalid-context-tokens'), true);
			assert.equal(reasons.includes('invalid-request-modalities'), true);
			assert.equal(reasons.includes('invalid-output-cap'), true);
			assert.equal(reasons.includes('caller-supplied-provenance'), true);
		});
	});

	suite('the derived frozen verdict vocabularies', () => {
		test('MATCH_VERDICTS: exact contents, order, uniqueness', () => {
			assert.deepEqual(MATCH_VERDICTS, [
				'context-fits',
				'context-too-small',
				'context-too-large',
				'modalities-covered',
				'modalities-missing',
				'output-cap-fits',
				'output-cap-exceeded',
				'capability-unknown',
			]);
			assert.equal(new Set(MATCH_VERDICTS).size, MATCH_VERDICTS.length);
		});

		test('the three dimension vocabularies are the closed subsets, in the master order', () => {
			assert.deepEqual(CONTEXT_WINDOW_VERDICTS, ['context-fits', 'context-too-small', 'context-too-large']);
			assert.deepEqual(MODALITY_COVERAGE_VERDICTS, ['modalities-covered', 'modalities-missing']);
			assert.deepEqual(OUTPUT_CAP_VERDICTS, ['output-cap-fits', 'output-cap-exceeded']);
			const verdicts = MATCH_VERDICTS as readonly string[];
			assert.equal(verdicts.indexOf('context-fits') < verdicts.indexOf('context-too-small'), true);
			assert.equal(verdicts.includes('capability-unknown'), true);
		});

		test('the modality set is the landed frozen vocabulary (never a parallel set)', () => {
			assert.deepEqual(MODEL_MODALITIES, ['text-in', 'text-out', 'image-in', 'tool-call']);
		});
	});

	suite('admitMatchRequest (the request walk)', () => {
		test('admits the full request and canonicalizes the modalities into the closed order', () => {
			const admission = admitMatchRequest({
				contextTokens: 1000,
				modalities: ['text-out', 'text-in', 'text-in', 'image-in'],
				outputCapTokens: 512,
				requestTag: 'fixture.match.fits',
			});
			assert.equal(admission.admitted, true);
			if (!admission.admitted) {
				throw new Error('unreachable');
			}
			assert.deepEqual(admission.request.modalities, ['text-in', 'text-out', 'image-in']);
			assert.equal(admission.request.outputCapTokens, 512);
			assert.equal(admission.request.requestTag, 'fixture.match.fits');
		});

		test('admits the minimal request; absent optionals stay absent', () => {
			const admission = admitMatchRequest({ contextTokens: 5 });
			assert.equal(admission.admitted, true);
			if (!admission.admitted) {
				throw new Error('unreachable');
			}
			assert.deepEqual(admission.request, { contextTokens: 5 });
			assert.equal('modalities' in admission.request, false);
			assert.equal('outputCapTokens' in admission.request, false);
			assert.equal('requestTag' in admission.request, false);
		});

		test('rejects non-objects', () => {
			for (const bad of [undefined, null, 'fixture.request', 42, true]) {
				const admission = admitMatchRequest(bad);
				assert.equal(admission.admitted, false);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'not-an-object');
				}
			}
		});

		test('rejects non-integer, zero, negative and non-number context tokens', () => {
			for (const bad of [1.5, 0, -1000, '1000', NaN]) {
				const admission = admitMatchRequest({ contextTokens: bad });
				assert.equal(admission.admitted, false, `expected rejection for ${String(bad)}`);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'invalid-context-tokens');
				}
			}
		});

		test('rejects an empty modalities set when required, non-arrays and unknown members', () => {
			for (const bad of [[], 'text-in', ['text-in', 'vibes'], ['text-in', 42]] as unknown[]) {
				const admission = admitMatchRequest({ contextTokens: 1000, modalities: bad });
				assert.equal(admission.admitted, false, `expected rejection for ${JSON.stringify(bad)}`);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'invalid-request-modalities');
				}
			}
		});

		test('rejects negative, zero, non-integer and non-number output caps', () => {
			for (const bad of [-512, 0, 1.5, '512', NaN]) {
				const admission = admitMatchRequest({ contextTokens: 1000, outputCapTokens: bad });
				assert.equal(admission.admitted, false, `expected rejection for ${String(bad)}`);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'invalid-output-cap');
				}
			}
		});

		test('rejects an empty or non-string request tag', () => {
			for (const bad of ['', 42, null]) {
				const admission = admitMatchRequest({ contextTokens: 1000, requestTag: bad });
				assert.equal(admission.admitted, false, `expected rejection for ${String(bad)}`);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'invalid-request-tag');
				}
			}
		});

		test('rejects a caller-supplied provenance or substitution label (provenance is derived)', () => {
			const withProvenance = admitMatchRequest({
				contextTokens: 1000,
				provenance: { substitution: 'none' },
			} as Record<string, unknown>);
			assert.equal(withProvenance.admitted, false);
			if (!withProvenance.admitted) {
				assert.equal(withProvenance.reason, 'caller-supplied-provenance');
			}
			const withNullProvenance = admitMatchRequest({ contextTokens: 1000, provenance: null } as Record<string, unknown>);
			assert.equal(withNullProvenance.admitted, false);
			if (!withNullProvenance.admitted) {
				assert.equal(withNullProvenance.reason, 'caller-supplied-provenance');
			}
			const withSubstitution = admitMatchRequest({ contextTokens: 1000, substitution: 'none' } as Record<string, unknown>);
			assert.equal(withSubstitution.admitted, false);
			if (!withSubstitution.admitted) {
				assert.equal(withSubstitution.reason, 'caller-supplied-provenance');
			}
		});

		test('the guard is pure: the candidate is untouched', () => {
			const candidate = { contextTokens: 1000, modalities: ['text-in'] };
			const before = JSON.stringify(candidate);
			admitMatchRequest(candidate);
			admitMatchRequest({ contextTokens: -1 });
			assert.equal(JSON.stringify(candidate), before);
		});

		test('isMatchRequestDescriptor: both directions', () => {
			const valid = { contextTokens: 1000, modalities: ['text-in'], requestTag: 'fixture.match.fits' };
			assert.equal(isMatchRequestDescriptor(valid), true);
			assert.equal(isMatchRequestDescriptor(foreign(JSON.stringify(valid))), true);
			assert.equal(isMatchRequestDescriptor(undefined), false);
			assert.equal(isMatchRequestDescriptor({ contextTokens: 0 }), false);
			assert.equal(isMatchRequestDescriptor({ contextTokens: 1000, modalities: [] }), false);
			assert.equal(isMatchRequestDescriptor({ contextTokens: 1000, provenance: {} } as Record<string, unknown>), false);
		});
	});

	suite('admitMatchCandidate (the entry walk)', () => {
		test('admits a well-formed entry with the declared priority preserved verbatim', () => {
			const admission = admitMatchCandidate(
				fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 2),
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true);
			if (!admission.admitted) {
				throw new Error('unreachable');
			}
			assert.equal(admission.entry.id, FIXTURE_MATCH_FITS_ID);
			assert.equal(admission.entry.adapterId, FIXTURE_ADAPTER_ALPHA);
			assert.equal(admission.entry.declaredPriority, 2);
		});

		test('admits without a declared priority; the absent optional stays absent', () => {
			const admission = admitMatchCandidate(
				fixtureEntryCandidate(FIXTURE_ADAPTER_BETA),
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true);
			if (!admission.admitted) {
				throw new Error('unreachable');
			}
			assert.equal('declaredPriority' in admission.entry, false);
		});

		test('rejects non-objects and version mismatches', () => {
			for (const bad of [undefined, null, 'fixture.entry', 42]) {
				const admission = admitMatchCandidate(bad, fixtureAdapterRecord(), fixtureMatrixRecord(), fixtureCatalogRecord());
				assert.equal(admission.admitted, false);
				if (!admission.admitted) {
					assert.equal(admission.reason, 'not-an-object');
				}
			}
			const stale = admitMatchCandidate(
				{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), contractVersion: '0.9.9' },
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(stale.admitted, false);
			if (!stale.admitted) {
				assert.equal(stale.reason, 'version-mismatch');
			}
		});

		test('rejects an empty id, an empty adapter id and a malformed declared priority', () => {
			const badId = admitMatchCandidate(
				{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), id: '' },
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(badId.admitted, false);
			if (!badId.admitted) {
				assert.equal(badId.reason, 'invalid-match-entry-id');
			}
			const badAdapter = admitMatchCandidate(
				{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), adapterId: '' },
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(badAdapter.admitted, false);
			if (!badAdapter.admitted) {
				assert.equal(badAdapter.reason, 'invalid-adapter-id');
			}
			for (const bad of [NaN, Infinity, 'x', null]) {
				const badPriority = admitMatchCandidate(
					{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), declaredPriority: bad },
					fixtureAdapterRecord(),
					fixtureMatrixRecord(),
					fixtureCatalogRecord(),
				);
				assert.equal(badPriority.admitted, false, `expected rejection for ${String(bad)}`);
				if (!badPriority.admitted) {
					assert.equal(badPriority.reason, 'invalid-declared-priority');
				}
			}
		});

		test('rejects an unresolved adapter binding (the no-dangling-ref law, direction one)', () => {
			const admission = admitMatchCandidate(
				fixtureEntryCandidate('fixture.adapter.nowhere'),
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-adapter-binding');
				assert.match(admission.detail, /dangling adapter reference/);
			}
		});

		test('rejects an unresolved catalog entry (the no-dangling-ref law, direction two)', () => {
			const admission = admitMatchCandidate(
				fixtureEntryCandidate(FIXTURE_ADAPTER_DELTA),
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				deltaLessCatalog(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-catalog-entry');
				assert.match(admission.detail, /dangling catalog reference/);
			}
		});

		test('rejects an unresolved capability descriptor (the no-dangling-ref law, direction three)', () => {
			const admission = admitMatchCandidate(
				fixtureEntryCandidate(FIXTURE_ADAPTER_DELTA),
				fixtureAdapterRecord(),
				deltaLessMatrix(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-capability-descriptor');
				assert.match(admission.detail, /dangling capability reference/);
			}
		});

		test('the guard is pure: the candidate is untouched', () => {
			const candidate = fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 3);
			const before = JSON.stringify(candidate);
			admitMatchCandidate(candidate, fixtureAdapterRecord(), fixtureMatrixRecord(), fixtureCatalogRecord());
			admitMatchCandidate({ ...candidate, id: '' }, fixtureAdapterRecord(), fixtureMatrixRecord(), fixtureCatalogRecord());
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('admitMatchMatrix (the matrix walk)', () => {
		test('admits a well-formed matrix with the entries preserved in order', () => {
			const admission = admitMatchMatrix(
				{
					matrixId: 'fixture.match-matrix.alpha',
					entries: [
						{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 1), id: 'fixture.match.matrix-first' },
						{ ...fixtureEntryCandidate(FIXTURE_ADAPTER_BETA), id: 'fixture.match.matrix-second' },
					],
					contractVersion: INFERENCE_MATCHING_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, true);
			if (!admission.admitted) {
				throw new Error('unreachable');
			}
			assert.equal(admission.matrix.matrixId, 'fixture.match-matrix.alpha');
			assert.equal(admission.matrix.entries.length, 2);
			assert.equal(admission.matrix.entries[0].id, 'fixture.match.matrix-first');
			assert.equal(admission.matrix.entries[0].declaredPriority, 1);
			assert.equal('declaredPriority' in admission.matrix.entries[1], false);
		});

		test('rejects non-objects, version mismatches, an empty matrix id and non-array entries', () => {
			const notObject = admitMatchMatrix(null, fixtureAdapterRecord(), fixtureMatrixRecord(), fixtureCatalogRecord());
			assert.equal(notObject.admitted, false);
			if (!notObject.admitted) {
				assert.equal(notObject.reason, 'not-an-object');
			}
			const stale = admitMatchMatrix(
				{
					matrixId: 'fixture.match-matrix.alpha',
					entries: [],
					contractVersion: '0.9.9',
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(stale.admitted, false);
			if (!stale.admitted) {
				assert.equal(stale.reason, 'version-mismatch');
			}
			const badId = admitMatchMatrix(
				{
					matrixId: '',
					entries: [],
					contractVersion: INFERENCE_MATCHING_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(badId.admitted, false);
			if (!badId.admitted) {
				assert.equal(badId.reason, 'invalid-matrix-id');
			}
			const badEntries = admitMatchMatrix(
				{
					matrixId: 'fixture.match-matrix.alpha',
					entries: 'fixture.entries',
					contractVersion: INFERENCE_MATCHING_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(badEntries.admitted, false);
			if (!badEntries.admitted) {
				assert.equal(badEntries.reason, 'invalid-entries');
			}
		});

		test('rejects a malformed entry with the entry walk cited verbatim in the detail', () => {
			const admission = admitMatchMatrix(
				{
					matrixId: 'fixture.match-matrix.alpha',
					entries: [fixtureEntryCandidate('fixture.adapter.nowhere')],
					contractVersion: INFERENCE_MATCHING_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'invalid-entry');
				assert.match(admission.detail, /unresolved-adapter-binding/);
			}
		});

		test('rejects a duplicate entry id (never a silent overwrite)', () => {
			const admission = admitMatchMatrix(
				{
					matrixId: 'fixture.match-matrix.alpha',
					entries: [fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), fixtureEntryCandidate(FIXTURE_ADAPTER_BETA)],
					contractVersion: INFERENCE_MATCHING_VERSION,
				},
				fixtureAdapterRecord(),
				fixtureMatrixRecord(),
				fixtureCatalogRecord(),
			);
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'duplicate-match-entry-id');
				assert.match(admission.detail, /never a silent overwrite/);
			}
		});
	});

	suite('isMatchCandidateDescriptor (the shape guard)', () => {
		test('admits well-formed entries, both directions', () => {
			const valid = fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 1);
			assert.equal(isMatchCandidateDescriptor(valid), true);
			assert.equal(isMatchCandidateDescriptor(foreign(JSON.stringify(valid))), true);
			const noPriority = fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA);
			assert.equal(isMatchCandidateDescriptor(noPriority), true);
		});

		test('rejects non-objects, version mismatches and malformed fields', () => {
			assert.equal(isMatchCandidateDescriptor(undefined), false);
			assert.equal(isMatchCandidateDescriptor(42), false);
			assert.equal(
				isMatchCandidateDescriptor({ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), contractVersion: '0.9.9' }),
				false,
			);
			assert.equal(isMatchCandidateDescriptor({ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), id: '' }), false);
			assert.equal(isMatchCandidateDescriptor({ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), adapterId: '' }), false);
			assert.equal(
				isMatchCandidateDescriptor({ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), declaredPriority: NaN }),
				false,
			);
		});
	});

	suite('serializeMatchCandidate (canonical bytes)', () => {
		test('double-run byte-equal', () => {
			const candidate = fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 2);
			assert.equal(serializeMatchCandidate(candidate), serializeMatchCandidate(candidate));
		});

		test('key-insertion-order independence: scrambled input keys, same bytes', () => {
			const candidate = fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 2);
			const scrambled = {
				contractVersion: candidate.contractVersion,
				declaredPriority: 2,
				adapterId: candidate.adapterId,
				id: candidate.id,
			};
			assert.equal(serializeMatchCandidate(scrambled), serializeMatchCandidate(candidate));
		});

		test('the bytes pin the fixed key order, with and without the declared priority', () => {
			const withPriority = JSON.parse(serializeMatchCandidate(fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA, 2))) as Record<string, unknown>;
			assert.deepEqual(Object.keys(withPriority), ['id', 'adapterId', 'declaredPriority', 'contractVersion']);
			const withoutPriority = JSON.parse(serializeMatchCandidate(fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA))) as Record<string, unknown>;
			assert.deepEqual(Object.keys(withoutPriority), ['id', 'adapterId', 'contractVersion']);
		});

		test('the version stamp rides the bytes', () => {
			const bytes = serializeMatchCandidate(fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA));
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_MATCHING_VERSION}"`), true);
		});

		test('refuses a malformed candidate fail-closed', () => {
			assert.throws(() => serializeMatchCandidate(undefined), TypeError);
			assert.throws(() => serializeMatchCandidate({ id: 'fixture.match.fits' }), TypeError);
			assert.throws(() => serializeMatchCandidate({ ...fixtureEntryCandidate(FIXTURE_ADAPTER_ALPHA), adapterId: '' }), TypeError);
		});
	});

	suite('isMatchDecisionRecord (the decision guard, both directions)', () => {
		test('admits the matched fixture decision (no substitution)', () => {
			assert.equal(isMatchDecisionRecord(fixtureMatchedDecision()), true);
			assert.equal(isMatchDecisionRecord(foreign(JSON.stringify(fixtureMatchedDecision()))), true);
		});

		test('admits the disclosed-substitution fixture decision', () => {
			assert.equal(isMatchDecisionRecord(fixtureSubstitutedDecision()), true);
		});

		test('admits the no-match fixture decision', () => {
			assert.equal(isMatchDecisionRecord(fixtureNoMatchDecision()), true);
			assert.equal(isMatchDecisionRecord(foreign(JSON.stringify(fixtureNoMatchDecision()))), true);
		});

		test('admits a decision carrying an honest-unknown row (the first-class shape)', () => {
			const withUnknown = {
				...fixtureMatchedDecision(),
				rows: [
					{ kind: 'unknown-descriptor', entryId: FIXTURE_MATCH_MODALITY_MISSING_ID, adapterId: FIXTURE_ADAPTER_GAMMA },
					fixtureAlphaMainRow,
				],
			};
			assert.equal(isMatchDecisionRecord(withUnknown), true);
		});

		test('rejects non-objects, bad kinds and version mismatches', () => {
			for (const bad of [undefined, null, 'fixture.decision', 42]) {
				assert.equal(isMatchDecisionRecord(bad), false);
			}
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), kind: 'random' }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), contractVersion: '0.9.9' }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureNoMatchDecision(), contractVersion: '0.9.9' }), false);
		});

		test('rejects a malformed request echo on both sides', () => {
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), request: { contextTokens: 0 } }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), request: { contextTokens: 1000, modalities: [] } }), false);
			assert.equal(
				isMatchDecisionRecord({ ...fixtureMatchedDecision(), request: { contextTokens: 1000, provenance: {} } as Record<string, unknown> }),
				false,
			);
			assert.equal(isMatchDecisionRecord({ ...fixtureNoMatchDecision(), request: { contextTokens: -1 } }), false);
		});

		test('rejects a non-finite decision instant', () => {
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), decidedAtEpochMs: NaN }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureNoMatchDecision(), decidedAtEpochMs: NaN }), false);
		});

		test('rejects malformed verdict rows (bad verdict values, bad missing list, bad kinds)', () => {
			const decision = fixtureMatchedDecision() as { rows: unknown[] };
			decision.rows = [{ ...fixtureAlphaMainRow, contextWindowVerdict: 'context-just-right' }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ ...fixtureAlphaMainRow, modalityCoverageVerdict: 'modalities-partial' }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ ...fixtureAlphaMainRow, outputCapVerdict: 'output-cap-tight' }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ ...fixtureAlphaMainRow, missingModalities: ['vibes'] }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ ...fixtureAlphaMainRow, admissible: 'yes' }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ kind: 'mystery' }];
			assert.equal(isMatchDecisionRecord(decision), false);
			decision.rows = [{ kind: 'unknown-descriptor', entryId: '', adapterId: FIXTURE_ADAPTER_GAMMA }];
			assert.equal(isMatchDecisionRecord(decision), false);
		});

		test('rejects an empty or malformed ranked list', () => {
			const emptyRanked = { ...fixtureMatchedDecision(), ranked: [] };
			assert.equal(isMatchDecisionRecord(emptyRanked), false);
			const brokenSequence = fixtureMatchedDecision() as { ranked: { rank: number }[] };
			brokenSequence.ranked = [{ ...brokenSequence.ranked[0], rank: 2 }];
			assert.equal(isMatchDecisionRecord(brokenSequence), false);
			const malformedMember = fixtureMatchedDecision() as { ranked: Record<string, unknown>[] };
			malformedMember.ranked = [{ ...malformedMember.ranked[0], priority: NaN }];
			assert.equal(isMatchDecisionRecord(malformedMember), false);
			const emptyIdMember = fixtureMatchedDecision() as { ranked: Record<string, unknown>[] };
			emptyIdMember.ranked = [{ ...emptyIdMember.ranked[0], entryId: '' }];
			assert.equal(isMatchDecisionRecord(emptyIdMember), false);
		});

		test('rejects a missing or malformed selected candidate', () => {
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), selected: undefined }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), selected: 'fixture.selected' }), false);
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), selected: { entryId: '' } }), false);
		});

		test('rejects a hidden substitution: selected not the top but labeled none (the structural law)', () => {
			const hidden = {
				...fixtureMatchedDecision(),
				selected: {
					entryId: FIXTURE_MATCH_TOO_SMALL_ID,
					adapterId: FIXTURE_ADAPTER_BETA,
					providerEntryId: FIXTURE_PROVIDER_BETA,
					modelId: FIXTURE_MODEL_BETA_MAIN,
				},
				routing: { adapterId: FIXTURE_ADAPTER_BETA, selectionRule: 'stable-adapter-id-order' },
			};
			assert.equal(isMatchDecisionRecord(hidden), false);
		});

		test('rejects a substitution label mismatch: selected is the top but labeled disclosed', () => {
			const mismatch = { ...fixtureMatchedDecision(), substitution: 'disclosed' };
			assert.equal(isMatchDecisionRecord(mismatch), false);
		});

		test('rejects a malformed provenance (fails the landed admitProvenance)', () => {
			assert.equal(isMatchDecisionRecord({ ...fixtureMatchedDecision(), provenance: 'fixture.provenance' }), false);
			assert.equal(
				isMatchDecisionRecord({ ...fixtureMatchedDecision(), provenance: { contractVersion: '0.0.1' } }),
				false,
			);
		});

		test('rejects a provenance inconsistent with the ranked top and the selected candidate', () => {
			const inconsistent = {
				...fixtureSubstitutedDecision(),
				provenance: unverifiedProvenance({
					requestedProviderId: FIXTURE_PROVIDER_ALPHA,
					requestedModelId: FIXTURE_MODEL_ALPHA_MAIN,
					actualProviderId: FIXTURE_PROVIDER_ALPHA,
					actualModelId: FIXTURE_MODEL_ALPHA_MAIN,
					recordedAtEpochMs: FIXTURE_NOW_MS,
				}),
			};
			assert.equal(isMatchDecisionRecord(inconsistent), false);
		});

		test('rejects a provenance recording instant disagreeing with the decision instant (one decision, one time)', () => {
			const disagreeing = { ...fixtureMatchedDecision(), decidedAtEpochMs: FIXTURE_NOW_MS + 1 };
			assert.equal(isMatchDecisionRecord(disagreeing), false);
		});

		test('rejects a routing binding outside the landed vocabulary or disagreeing with the selection', () => {
			const outsideVocabulary = {
				...fixtureMatchedDecision(),
				routing: { adapterId: FIXTURE_ADAPTER_ALPHA, selectionRule: 'random-lottery' },
			};
			assert.equal(isMatchDecisionRecord(outsideVocabulary), false);
			const wrongAdapter = {
				...fixtureMatchedDecision(),
				routing: { adapterId: FIXTURE_ADAPTER_BETA, selectionRule: 'stable-adapter-id-order' },
			};
			assert.equal(isMatchDecisionRecord(wrongAdapter), false);
			assert.deepEqual(ROUTING_SELECTION_RULES, ['stable-adapter-id-order']);
		});
	});

	suite('serializeMatchDecision (canonical bytes)', () => {
		test('double-run byte-equal', () => {
			const decision = fixtureMatchedDecision();
			assert.equal(serializeMatchDecision(decision), serializeMatchDecision(decision));
		});

		test('key-insertion-order independence: scrambled top-level and nested keys, same bytes', () => {
			const decision = fixtureMatchedDecision() as Record<string, unknown>;
			const scrambled = {
				routing: decision.routing,
				provenance: { ...((decision.provenance as { contractVersion: string }) as Record<string, unknown>) },
				substitution: decision.substitution,
				selected: { ...(decision.selected as Record<string, unknown>) },
				ranked: decision.ranked,
				rows: decision.rows,
				decidedAtEpochMs: decision.decidedAtEpochMs,
				request: { contextTokens: 1000 },
				contractVersion: decision.contractVersion,
				kind: decision.kind,
			};
			assert.equal(serializeMatchDecision(scrambled), serializeMatchDecision(decision));
		});

		test('the matched bytes pin the fixed key order', () => {
			const bytes = serializeMatchDecision(fixtureMatchedDecision());
			const keys = Object.keys(JSON.parse(bytes) as Record<string, unknown>);
			assert.deepEqual(keys, [
				'kind',
				'contractVersion',
				'request',
				'decidedAtEpochMs',
				'rows',
				'ranked',
				'selected',
				'substitution',
				'provenance',
				'routing',
			]);
		});

		test('the no-match bytes pin the fixed key order', () => {
			const bytes = serializeMatchDecision(fixtureNoMatchDecision());
			const keys = Object.keys(JSON.parse(bytes) as Record<string, unknown>);
			assert.deepEqual(keys, ['kind', 'contractVersion', 'request', 'decidedAtEpochMs', 'rows']);
			assert.equal((JSON.parse(bytes) as { kind: string }).kind, 'no-matching-candidate');
		});

		test('the provenance sub-record rides the landed canonical key order', () => {
			const bytes = serializeMatchDecision(fixtureMatchedDecision());
			const parsed = JSON.parse(bytes) as { provenance: Record<string, unknown> };
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

		test('the version stamp and the substitution disclosure ride the bytes', () => {
			const bytes = serializeMatchDecision(fixtureSubstitutedDecision());
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_MATCHING_VERSION}"`), true);
			assert.equal(bytes.includes('"substitution":"disclosed"'), true);
		});

		test('refuses a malformed decision fail-closed (no dishonest decision gets canonical bytes)', () => {
			assert.throws(() => serializeMatchDecision(undefined), TypeError);
			assert.throws(() => serializeMatchDecision({ kind: 'matched' }), TypeError);
			assert.throws(
				() => serializeMatchDecision({ ...fixtureMatchedDecision(), substitution: 'disclosed' }),
				TypeError,
			);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in matchingContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/matchingContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in matchingKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/matchingKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
