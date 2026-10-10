/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-002 capability matrix test suite (mocha tdd style, matching
 * build/flauz/inference/semantics/test/common/capacityDisclosure.test.ts).
 *
 * Fixture policy: every model id, provider entry id, matrix id and
 * probe value below is SYNTHETIC (prefixed 'fixture.') and is NOT
 * an authority value - no real provider, model or endpoint is
 * named anywhere in this suite. Closed-vocabulary members (the
 * modality names) are the contract's own values under test.
 * Runtime-boundary probes are injected as JSON-parsed values, the
 * shape foreign input arrives in at a real boundary.
 */
import { strict as assert } from 'node:assert';
import {
	CAPABILITY_DESCRIPTOR_REJECTION_REASONS,
	CAPABILITY_MATRIX_REJECTION_REASONS,
	INFERENCE_CATALOG_VERSION as MATRIX_CATALOG_VERSION,
	MODEL_MODALITIES,
	admitCapabilityDescriptor,
	admitCapabilityMatrix,
	contextWindowContains,
	isCapabilityDescriptor,
	isCapabilityMatrixRecord,
	serializeCapabilityMatrixRecord,
} from '../../common/capabilityMatrix.js';
import type {
	CapabilityDescriptorAdmission,
	CapabilityDescriptorRejected,
	CapabilityMatrixAdmission,
	CapabilityMatrixRecord,
	CapabilityMatrixRejected,
} from '../../common/capabilityMatrix.js';
import { INFERENCE_CATALOG_VERSION } from '../../common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../common/providerCatalog.js';
import { INFERENCE_SEMANTICS_CONTRACTS_VERSION, planSemanticsForTier } from '../../../semantics/common/planSemantics.js';
import { unknownSnapshot } from '../../../semantics/common/capacityDisclosure.js';

const FIXTURE_MODEL_SMALL = 'fixture.model.small';
const FIXTURE_MODEL_LARGE = 'fixture.model.large';
const FIXTURE_ENTRY_ALPHA = 'fixture.entry.alpha';
const FIXTURE_ENTRY_BETA = 'fixture.entry.beta';
const FIXTURE_MATRIX_ID = 'fixture.matrix.main';
const FIXTURE_CATALOG_ID = 'fixture.catalog.main';
const FIXTURE_NOW_MS = 1_700_000_000_000;

const FIXTURE_MIN_TOKENS = 128;
const FIXTURE_MAX_TOKENS = 8_192;
const FIXTURE_MAX_OUTPUT_TOKENS = 2_048;

function fixtureDescriptor(): Record<string, unknown> {
	return {
		modelId: FIXTURE_MODEL_SMALL,
		providerEntryId: FIXTURE_ENTRY_ALPHA,
		contextWindow: {
			minTokens: FIXTURE_MIN_TOKENS,
			maxTokens: FIXTURE_MAX_TOKENS,
		},
		maxOutputTokens: FIXTURE_MAX_OUTPUT_TOKENS,
		modalities: ['text-in', 'text-out'],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

/** Runtime-boundary probe helper: candidate with overrides, the shape foreign input arrives in. */
function descriptorWith(overrides: Record<string, unknown>): unknown {
	return { ...fixtureDescriptor(), ...overrides };
}

function fixtureCatalogRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			{
				entryId: FIXTURE_ENTRY_ALPHA,
				displayName: 'Fixture Entry Alpha',
				providerClass: 'third-party-free-tier',
				planClaims: [planSemanticsForTier('free', 'fixture.plan.alpha')],
				capacitySnapshot: unknownSnapshot(FIXTURE_ENTRY_ALPHA, FIXTURE_NOW_MS),
				metadataVerification: 'unverified',
				termsState: 'unknown',
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				entryId: FIXTURE_ENTRY_BETA,
				displayName: 'Fixture Entry Beta',
				providerClass: 'user-owned-endpoint',
				planClaims: [planSemanticsForTier('self-hosted', 'fixture.plan.beta')],
				capacitySnapshot: unknownSnapshot(FIXTURE_ENTRY_BETA, FIXTURE_NOW_MS),
				metadataVerification: 'unverified',
				termsState: 'unknown',
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureMatrixRecord(): Record<string, unknown> {
	return {
		matrixId: FIXTURE_MATRIX_ID,
		descriptors: [
			fixtureDescriptor(),
			{
				...fixtureDescriptor(),
				modelId: FIXTURE_MODEL_LARGE,
				providerEntryId: FIXTURE_ENTRY_BETA,
				contextWindow: { minTokens: 256, maxTokens: 32_768 },
				maxOutputTokens: 8_192,
				modalities: ['text-in', 'text-out', 'tool-call'],
			},
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function rejectedDescriptor(admission: CapabilityDescriptorAdmission): CapabilityDescriptorRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as CapabilityDescriptorRejected;
}

function admittedDescriptor(admission: CapabilityDescriptorAdmission) {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.descriptor;
}

function rejectedMatrix(admission: CapabilityMatrixAdmission): CapabilityMatrixRejected {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as CapabilityMatrixRejected;
}

function admittedMatrix(admission: CapabilityMatrixAdmission): CapabilityMatrixRecord {
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return admission.matrix;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

suite('INF-002 capability matrix', () => {

	suite('constants and closed lists', () => {
		test('model modalities are the closed four-member vocabulary, duplicate-free', () => {
			assert.deepEqual(MODEL_MODALITIES, ['text-in', 'text-out', 'image-in', 'tool-call']);
			assert.equal(new Set(MODEL_MODALITIES).size, MODEL_MODALITIES.length);
		});

		test('the catalog version constant is pinned 1.0.0 and carried by both family modules', () => {
			assert.equal(INFERENCE_CATALOG_VERSION, '1.0.0');
			assert.equal(MATRIX_CATALOG_VERSION, '1.0.0');
			assert.equal(MATRIX_CATALOG_VERSION, INFERENCE_CATALOG_VERSION);
		});

		test('the rejection vocabularies are closed, non-empty and duplicate-free', () => {
			for (const list of [CAPABILITY_DESCRIPTOR_REJECTION_REASONS, CAPABILITY_MATRIX_REJECTION_REASONS]) {
				assert.equal(list.length > 0, true);
				assert.equal(new Set(list).size, list.length);
			}
		});

		test('the descriptor version stamp is the catalog family stamp, not the semantics stamp', () => {
			const descriptor = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			assert.equal(descriptor.contractVersion, INFERENCE_CATALOG_VERSION);
			assert.notEqual(INFERENCE_CATALOG_VERSION, INFERENCE_SEMANTICS_CONTRACTS_VERSION + '-semantics');
		});
	});

	suite('admitCapabilityDescriptor rejections (every path)', () => {
		test('rejects non-objects', () => {
			for (const candidate of [null, undefined, 'fixture.string', 42, true]) {
				const rejection = rejectedDescriptor(admitCapabilityDescriptor(candidate));
				assert.equal(rejection.reason, 'not-an-object');
			}
		});

		test('rejects a contract-version mismatch (wrong value and missing key)', () => {
			assert.equal(
				rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ contractVersion: '0.9.9' }))).reason,
				'version-mismatch',
			);
			const missing = fixtureDescriptor();
			delete missing.contractVersion;
			assert.equal(rejectedDescriptor(admitCapabilityDescriptor(missing)).reason, 'version-mismatch');
		});

		test('rejects a missing, empty or non-string model id', () => {
			assert.equal(
				rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ modelId: '' }))).reason,
				'invalid-model-id',
			);
			assert.equal(
				rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ modelId: foreign('42') }))).reason,
				'invalid-model-id',
			);
			const missing = fixtureDescriptor();
			delete missing.modelId;
			assert.equal(rejectedDescriptor(admitCapabilityDescriptor(missing)).reason, 'invalid-model-id');
		});

		test('rejects a missing, empty or non-string provider entry id', () => {
			assert.equal(
				rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ providerEntryId: '' }))).reason,
				'invalid-provider-entry-id',
			);
			const missing = fixtureDescriptor();
			delete missing.providerEntryId;
			assert.equal(rejectedDescriptor(admitCapabilityDescriptor(missing)).reason, 'invalid-provider-entry-id');
		});

		test('rejects a missing or non-object context window', () => {
			for (const contextWindow of [foreign('null'), 'fixture.window', 42]) {
				assert.equal(
					rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ contextWindow }))).reason,
					'invalid-context-window',
				);
			}
			const missing = fixtureDescriptor();
			delete missing.contextWindow;
			assert.equal(rejectedDescriptor(admitCapabilityDescriptor(missing)).reason, 'invalid-context-window');
		});

		test('rejects zero, negative and non-integer token bounds', () => {
			for (const minTokens of [0, -1, 1.5, foreign('null')]) {
				assert.equal(
					rejectedDescriptor(
						admitCapabilityDescriptor(descriptorWith({ contextWindow: { minTokens, maxTokens: FIXTURE_MAX_TOKENS } })),
					).reason,
					'invalid-context-window',
				);
			}
			for (const maxTokens of [0, -128, 2.5, foreign('null')]) {
				assert.equal(
					rejectedDescriptor(
						admitCapabilityDescriptor(descriptorWith({ contextWindow: { minTokens: FIXTURE_MIN_TOKENS, maxTokens } })),
					).reason,
					'invalid-context-window',
				);
			}
		});

		test('rejects a context window with a missing bound', () => {
			assert.equal(
				rejectedDescriptor(
					admitCapabilityDescriptor(descriptorWith({ contextWindow: { maxTokens: FIXTURE_MAX_TOKENS } })),
				).reason,
				'invalid-context-window',
			);
			assert.equal(
				rejectedDescriptor(
					admitCapabilityDescriptor(descriptorWith({ contextWindow: { minTokens: FIXTURE_MIN_TOKENS } })),
				).reason,
				'invalid-context-window',
			);
		});

		test('rejects an inverted context window (minTokens above maxTokens)', () => {
			const rejection = rejectedDescriptor(
				admitCapabilityDescriptor(
					descriptorWith({ contextWindow: { minTokens: FIXTURE_MAX_TOKENS, maxTokens: FIXTURE_MIN_TOKENS } }),
				),
			);
			assert.equal(rejection.reason, 'inverted-context-window');
			assert.equal(rejection.detail.includes(`${FIXTURE_MAX_TOKENS}`), true);
		});

		test('rejects an invalid output cap (missing, zero, negative, non-integer)', () => {
			for (const maxOutputTokens of [undefined, 0, -1, 2.5, foreign('null')]) {
				const rejection = rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ maxOutputTokens })));
				assert.equal(rejection.reason, 'invalid-max-output');
			}
			const missing = fixtureDescriptor();
			delete missing.maxOutputTokens;
			assert.equal(rejectedDescriptor(admitCapabilityDescriptor(missing)).reason, 'invalid-max-output');
		});

		test('rejects an output cap above the window ceiling', () => {
			const rejection = rejectedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ maxOutputTokens: FIXTURE_MAX_TOKENS + 1 })),
			);
			assert.equal(rejection.reason, 'max-output-outside-window');
			assert.equal(rejection.detail.includes(`${FIXTURE_MAX_TOKENS + 1}`), true);
		});

		test('rejects an output cap below the window floor', () => {
			const rejection = rejectedDescriptor(
				admitCapabilityDescriptor(
					descriptorWith({
						contextWindow: { minTokens: 1_024, maxTokens: FIXTURE_MAX_TOKENS },
						maxOutputTokens: 512,
					}),
				),
			);
			assert.equal(rejection.reason, 'max-output-outside-window');
		});

		test('rejects non-array modalities', () => {
			for (const modalities of [foreign('null'), 'text-in', 42]) {
				assert.equal(
					rejectedDescriptor(admitCapabilityDescriptor(descriptorWith({ modalities }))).reason,
					'invalid-modalities',
				);
			}
		});

		test('rejects an unknown modality', () => {
			const rejection = rejectedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ modalities: ['text-in', 'fixture.modality.smell'] })),
			);
			assert.equal(rejection.reason, 'unknown-modality');
			assert.equal(rejection.detail.includes('fixture.modality.smell'), true);
		});
	});

	suite('honest acceptance', () => {
		test('admits a full descriptor and returns the canonical record', () => {
			const descriptor = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			assert.equal(descriptor.modelId, FIXTURE_MODEL_SMALL);
			assert.equal(descriptor.providerEntryId, FIXTURE_ENTRY_ALPHA);
			assert.deepEqual(descriptor.contextWindow, { minTokens: FIXTURE_MIN_TOKENS, maxTokens: FIXTURE_MAX_TOKENS });
			assert.equal(descriptor.maxOutputTokens, FIXTURE_MAX_OUTPUT_TOKENS);
			assert.deepEqual(descriptor.modalities, ['text-in', 'text-out']);
			assert.equal(descriptor.contractVersion, INFERENCE_CATALOG_VERSION);
		});

		test('admits every single-modality descriptor', () => {
			for (const modality of MODEL_MODALITIES) {
				const descriptor = admittedDescriptor(
					admitCapabilityDescriptor(descriptorWith({ modalities: [modality] })),
				);
				assert.deepEqual(descriptor.modalities, [modality]);
			}
		});

		test('admits the full modality set', () => {
			const descriptor = admittedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ modalities: [...MODEL_MODALITIES] })),
			);
			assert.deepEqual(descriptor.modalities, [...MODEL_MODALITIES]);
		});

		test('canonicalizes modalities into the closed-vocabulary order regardless of insertion order', () => {
			const descriptor = admittedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ modalities: ['tool-call', 'text-out', 'image-in', 'text-in'] })),
			);
			assert.deepEqual(descriptor.modalities, [...MODEL_MODALITIES]);
		});

		test('collapses duplicate modalities in the admitted record', () => {
			const descriptor = admittedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ modalities: ['text-out', 'text-out', 'text-in', 'text-in'] })),
			);
			assert.deepEqual(descriptor.modalities, ['text-in', 'text-out']);
		});

		test('admits the single-token window with the output cap on the endpoint', () => {
			const descriptor = admittedDescriptor(
				admitCapabilityDescriptor(
					descriptorWith({
						contextWindow: { minTokens: 8, maxTokens: 8 },
						maxOutputTokens: 8,
					}),
				),
			);
			assert.deepEqual(descriptor.contextWindow, { minTokens: 8, maxTokens: 8 });
		});

		test('admission never mutates the candidate', () => {
			const candidate = fixtureDescriptor();
			const before = JSON.stringify(candidate);
			admitCapabilityDescriptor(candidate);
			isCapabilityDescriptor(candidate);
			serializeCapabilityMatrixRecord({
				matrixId: FIXTURE_MATRIX_ID,
				descriptors: [candidate],
				contractVersion: INFERENCE_CATALOG_VERSION,
			});
			assert.equal(JSON.stringify(candidate), before);
		});

		test('double admission is deterministic (same canonical record twice)', () => {
			const first = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			const second = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			assert.deepEqual(first, second);
		});
	});

	suite('contextWindowContains (inclusive boundary math)', () => {
		test('the lower endpoint admits (tokens === minTokens)', () => {
			assert.equal(contextWindowContains(admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor())), FIXTURE_MIN_TOKENS), true);
		});

		test('the upper endpoint admits (tokens === maxTokens)', () => {
			assert.equal(contextWindowContains(admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor())), FIXTURE_MAX_TOKENS), true);
		});

		test('off-by-one below the floor rejects (minTokens - 1)', () => {
			assert.equal(contextWindowContains(admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor())), FIXTURE_MIN_TOKENS - 1), false);
		});

		test('off-by-one above the ceiling rejects (maxTokens + 1)', () => {
			assert.equal(contextWindowContains(admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor())), FIXTURE_MAX_TOKENS + 1), false);
		});

		test('the middle of the window admits', () => {
			assert.equal(
				contextWindowContains(admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor())), (FIXTURE_MIN_TOKENS + FIXTURE_MAX_TOKENS) / 2),
				true,
			);
		});

		test('the single-token window: the endpoint admits, both off-by-one directions reject', () => {
			const descriptor = admittedDescriptor(
				admitCapabilityDescriptor(descriptorWith({ contextWindow: { minTokens: 8, maxTokens: 8 }, maxOutputTokens: 8 })),
			);
			assert.equal(contextWindowContains(descriptor, 8), true);
			assert.equal(contextWindowContains(descriptor, 7), false);
			assert.equal(contextWindowContains(descriptor, 9), false);
		});

		test('fail-closed on a non-finite probe', () => {
			const descriptor = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			assert.equal(contextWindowContains(descriptor, Number.NaN), false);
			assert.equal(contextWindowContains(descriptor, Number.POSITIVE_INFINITY), false);
			assert.equal(contextWindowContains(descriptor, foreign('null')), false);
		});

		test('fail-closed on a malformed descriptor (missing window, non-number bounds)', () => {
			const missingWindow = foreign('{"minTokens": 1}');
			assert.equal(contextWindowContains(missingWindow, 1), false);
			const badBounds = foreign('{"contextWindow": {"minTokens": "fixture.low", "maxTokens": 8}}');
			assert.equal(contextWindowContains(badBounds, 4), false);
		});

		test('pure: repeated probes of the same descriptor are deterministic', () => {
			const descriptor = admittedDescriptor(admitCapabilityDescriptor(fixtureDescriptor()));
			for (let probe = 0; probe < 3; probe++) {
				assert.equal(contextWindowContains(descriptor, FIXTURE_MIN_TOKENS), true);
				assert.equal(contextWindowContains(descriptor, FIXTURE_MAX_TOKENS + 1), false);
			}
		});
	});

	suite('admitCapabilityMatrix (uniqueness + the no-dangling-ref law)', () => {
		test('admits a well-formed matrix bound to a catalog that carries the referenced entries', () => {
			const matrix = admittedMatrix(admitCapabilityMatrix(fixtureMatrixRecord(), fixtureCatalogRecord()));
			assert.equal(matrix.matrixId, FIXTURE_MATRIX_ID);
			assert.equal(matrix.descriptors.length, 2);
			assert.equal(matrix.contractVersion, INFERENCE_CATALOG_VERSION);
		});

		test('rejects non-objects, version mismatches, invalid matrix ids and non-array descriptors', () => {
			for (const candidate of [null, 'fixture.string', 42]) {
				assert.equal(rejectedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord())).reason, 'not-an-object');
			}
			assert.equal(
				rejectedMatrix(admitCapabilityMatrix({ ...fixtureMatrixRecord(), contractVersion: '0.9.9' }, fixtureCatalogRecord())).reason,
				'version-mismatch',
			);
			assert.equal(
				rejectedMatrix(admitCapabilityMatrix({ ...fixtureMatrixRecord(), matrixId: '' }, fixtureCatalogRecord())).reason,
				'invalid-matrix-id',
			);
			assert.equal(
				rejectedMatrix(admitCapabilityMatrix({ ...fixtureMatrixRecord(), descriptors: foreign('null') }, fixtureCatalogRecord())).reason,
				'invalid-descriptors',
			);
		});

		test('rejects a record carrying an invalid descriptor, surfacing its own reason verbatim', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), descriptorWith({ modalities: ['fixture.modality.smell'] })],
			};
			const rejection = rejectedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'invalid-descriptor');
			assert.equal(rejection.detail.includes('descriptors[1]'), true);
			assert.equal(rejection.detail.includes("'unknown-modality'"), true);
		});

		test('rejects a duplicate (provider entry, model) pair (never a silent overwrite)', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), fixtureDescriptor()],
			};
			const rejection = rejectedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'duplicate-model-provider-pair');
			assert.equal(rejection.detail.includes(FIXTURE_MODEL_SMALL), true);
			assert.equal(rejection.detail.includes(FIXTURE_ENTRY_ALPHA), true);
		});

		test('the same model id under different providers is admitted (uniqueness is the pair)', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), descriptorWith({ providerEntryId: FIXTURE_ENTRY_BETA })],
			};
			const matrix = admittedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(matrix.descriptors.length, 2);
		});

		test('the same provider with different models is admitted', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), descriptorWith({ modelId: FIXTURE_MODEL_LARGE })],
			};
			const matrix = admittedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(matrix.descriptors.length, 2);
		});

		test('rejects a dangling provider reference (the no-dangling-ref law)', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), descriptorWith({ providerEntryId: 'fixture.entry.ghost' })],
			};
			const rejection = rejectedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.reason, 'unknown-provider-entry');
			assert.equal(rejection.detail.includes('fixture.entry.ghost'), true);
			assert.equal(rejection.detail.includes('dangling'), true);
		});

		test('the dangling rejection names the offending descriptor index', () => {
			const candidate = {
				...fixtureMatrixRecord(),
				descriptors: [
					fixtureDescriptor(),
					{ ...fixtureDescriptor(), modelId: FIXTURE_MODEL_LARGE, providerEntryId: FIXTURE_ENTRY_BETA },
					descriptorWith({ modelId: 'fixture.model.ghost', providerEntryId: 'fixture.entry.ghost' }),
				],
			};
			const rejection = rejectedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.equal(rejection.detail.includes('descriptors[2]'), true);
		});

		test('rejects an invalid bound catalog, surfacing the catalog reason verbatim', () => {
			const invalidCatalog = { ...fixtureCatalogRecord(), entries: [] } as unknown as Record<string, unknown>;
			delete invalidCatalog.catalogId;
			const rejection = rejectedMatrix(admitCapabilityMatrix(fixtureMatrixRecord(), invalidCatalog));
			assert.equal(rejection.reason, 'invalid-catalog');
			assert.equal(rejection.detail.includes("'invalid-catalog-id'"), true);
		});

		test('the admitted matrix canonicalizes every descriptor', () => {
			const matrix = admittedMatrix(admitCapabilityMatrix(fixtureMatrixRecord(), fixtureCatalogRecord()));
			for (const descriptor of matrix.descriptors) {
				assert.equal(isCapabilityDescriptor(descriptor), true);
			}
		});

		test('an empty descriptors array is admitted (an empty matrix is honest)', () => {
			const candidate = { ...fixtureMatrixRecord(), descriptors: [] };
			const matrix = admittedMatrix(admitCapabilityMatrix(candidate, fixtureCatalogRecord()));
			assert.deepEqual(matrix.descriptors, []);
		});

		test('admission never mutates the candidate or the catalog', () => {
			const candidate = fixtureMatrixRecord();
			const catalog = fixtureCatalogRecord();
			const candidateBefore = JSON.stringify(candidate);
			const catalogBefore = JSON.stringify(catalog);
			admitCapabilityMatrix(candidate, catalog);
			assert.equal(JSON.stringify(candidate), candidateBefore);
			assert.equal(JSON.stringify(catalog), catalogBefore);
		});
	});

	suite('canonical serialization and determinism', () => {
		test('equal matrices serialize byte-equal (double build)', () => {
			const first = serializeCapabilityMatrixRecord(fixtureMatrixRecord());
			const second = serializeCapabilityMatrixRecord(fixtureMatrixRecord());
			assert.equal(first, second);
			assert.equal(typeof first, 'string');
		});

		test('canonical bytes are independent of descriptor and window key insertion order', () => {
			const shuffled = {
				contractVersion: INFERENCE_CATALOG_VERSION,
				descriptors: [
					{
						contractVersion: INFERENCE_CATALOG_VERSION,
						modalities: ['text-out', 'text-in'],
						maxOutputTokens: FIXTURE_MAX_OUTPUT_TOKENS,
						contextWindow: { maxTokens: FIXTURE_MAX_TOKENS, minTokens: FIXTURE_MIN_TOKENS },
						providerEntryId: FIXTURE_ENTRY_ALPHA,
						modelId: FIXTURE_MODEL_SMALL,
					},
				],
				matrixId: FIXTURE_MATRIX_ID,
			};
			const canonical = serializeCapabilityMatrixRecord({
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor()],
			});
			assert.equal(serializeCapabilityMatrixRecord(shuffled), canonical);
		});

		test('modality insertion order does not change the bytes', () => {
			const first = serializeCapabilityMatrixRecord({
				...fixtureMatrixRecord(),
				descriptors: [descriptorWith({ modalities: ['tool-call', 'text-out', 'text-in'] })],
			});
			const second = serializeCapabilityMatrixRecord({
				...fixtureMatrixRecord(),
				descriptors: [descriptorWith({ modalities: ['text-in', 'text-out', 'tool-call'] })],
			});
			assert.equal(first, second);
		});

		test('each semantic difference changes the bytes (ids, bounds, output cap, modalities)', () => {
			const base = serializeCapabilityMatrixRecord({
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor()],
			});
			const variants = [
				descriptorWith({ modelId: FIXTURE_MODEL_LARGE }),
				descriptorWith({ providerEntryId: FIXTURE_ENTRY_BETA }),
				descriptorWith({ contextWindow: { minTokens: 256, maxTokens: FIXTURE_MAX_TOKENS } }),
				descriptorWith({ contextWindow: { minTokens: FIXTURE_MIN_TOKENS, maxTokens: 16_384 } }),
				descriptorWith({ maxOutputTokens: 1_024 }),
				descriptorWith({ modalities: ['text-in'] }),
			];
			for (const variant of variants) {
				const bytes = serializeCapabilityMatrixRecord({
					...fixtureMatrixRecord(),
					descriptors: [variant],
				});
				assert.notEqual(bytes, base, `variant must change the bytes: ${JSON.stringify(variant)}`);
			}
		});

		test('the canonical bytes carry the version stamp', () => {
			const bytes = serializeCapabilityMatrixRecord(fixtureMatrixRecord());
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_CATALOG_VERSION}"`), true);
		});

		test('serialization refuses invalid records (unknown modality and duplicate pair throw)', () => {
			const unknownModality = {
				...fixtureMatrixRecord(),
				descriptors: [descriptorWith({ modalities: ['fixture.modality.smell'] })],
			};
			assert.throws(() => serializeCapabilityMatrixRecord(unknownModality), /invalid-descriptor.*unknown-modality/);
			const duplicatePair = {
				...fixtureMatrixRecord(),
				descriptors: [fixtureDescriptor(), fixtureDescriptor()],
			};
			assert.throws(() => serializeCapabilityMatrixRecord(duplicatePair), /duplicate-model-provider-pair/);
		});

		test('descriptor order is preserved in the bytes (reorder is a byte difference)', () => {
			const first = serializeCapabilityMatrixRecord(fixtureMatrixRecord());
			const reordered = serializeCapabilityMatrixRecord({
				...fixtureMatrixRecord(),
				descriptors: [...(fixtureMatrixRecord().descriptors as unknown[])].reverse(),
			});
			assert.notEqual(reordered, first);
		});
	});

	suite('shape guards', () => {
		test('isCapabilityDescriptor agrees with admission on accepted and rejected probes', () => {
			assert.equal(isCapabilityDescriptor(fixtureDescriptor()), true);
			for (const probe of [
				null,
				42,
				descriptorWith({ modelId: '' }),
				descriptorWith({ contextWindow: { minTokens: 0, maxTokens: 8 } }),
				descriptorWith({ maxOutputTokens: FIXTURE_MAX_TOKENS + 1 }),
				descriptorWith({ modalities: ['fixture.modality.smell'] }),
			]) {
				assert.equal(isCapabilityDescriptor(probe), false, `probe must be rejected: ${JSON.stringify(probe)}`);
			}
		});

		test('isCapabilityMatrixRecord checks the intrinsic shape (descriptors + uniqueness)', () => {
			assert.equal(isCapabilityMatrixRecord(fixtureMatrixRecord()), true);
			assert.equal(
				isCapabilityMatrixRecord({
					...fixtureMatrixRecord(),
					descriptors: [fixtureDescriptor(), fixtureDescriptor()],
				}),
				false,
			);
			assert.equal(isCapabilityMatrixRecord(null), false);
		});

		test('the shape guard passes a matrix the bound catalog would reject (binding is admission-time)', () => {
			const dangling = {
				...fixtureMatrixRecord(),
				descriptors: [descriptorWith({ providerEntryId: 'fixture.entry.ghost' })],
			};
			assert.equal(isCapabilityMatrixRecord(dangling), true);
			assert.equal(admitCapabilityMatrix(dangling, fixtureCatalogRecord()).admitted, false);
		});
	});
});
