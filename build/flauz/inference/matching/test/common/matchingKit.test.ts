/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-006 matching kit test suite (mocha tdd style, matching
 * build/flauz/inference/routing/test/common/routingKit.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle, matrix id, catalog id and probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the verdicts, the rejection reasons,
 * the substitution states, the routing selection rules, the version
 * stamps) are the contract's own values under test. The three
 * disclosed fixture match-entry ids (fixture.match.fits /
 * fixture.match.too-small / fixture.match.modality-missing) are the
 * kit module's own exported constants, registered by this suite
 * against its fixture bound records. Runtime-boundary probes are
 * injected as JSON-parsed values. All timestamps ride the fixed
 * injected clock; the suites never read a clock. The ledger tests
 * run at a caller-injected root under os.tmpdir(), outside the repo
 * tree, cleaned per suite run.
 */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_MATCH_FITS_ID,
	FIXTURE_MATCH_MODALITY_MISSING_ID,
	FIXTURE_MATCH_TOO_SMALL_ID,
	INFERENCE_MATCHING_VERSION as KIT_RECARRIED_INFERENCE_MATCHING_VERSION,
	MATCHING_DECISIONS_LEDGER_FILE,
	MATCHING_KIT_REJECTION_REASONS,
	createMatchingKit,
} from '../../common/matchingKit.js';
import type { MatchingKit } from '../../common/matchingKit.js';
import {
	INFERENCE_MATCHING_VERSION as CONTRACT_INFERENCE_MATCHING_VERSION,
	isMatchDecisionRecord,
	serializeMatchDecision,
} from '../../common/matchingContract.js';
import type { MatchOutcome, MatchVerdictRow } from '../../common/matchingContract.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	admitProvenance,
	markProvenanceVerified,
} from '../../../semantics/common/capacityDisclosure.js';
import { contextWindowContains } from '../../../catalog/common/capabilityMatrix.js';
import type { CapabilityMatrixRecord } from '../../../catalog/common/capabilityMatrix.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';
import { ROUTING_SELECTION_RULES } from '../../../routing/common/routingContract.js';

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
const FIXTURE_MATCH_DELTA_ID = 'fixture.match.delta';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const LEDGER_TEST_ROOT = join(tmpdir(), 'flauz-inference-matching-battery');

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

function fixtureMatrixWithNowhereDescriptor(): CapabilityMatrixRecord {
	const descriptors = fixtureMatrixRecord().descriptors.slice();
	descriptors.push({
		modelId: 'fixture.model.nowhere-main',
		providerEntryId: 'fixture.provider.nowhere',
		contextWindow: { minTokens: 256, maxTokens: 8192 },
		maxOutputTokens: 1024,
		modalities: ['text-in'],
		contractVersion: INFERENCE_CATALOG_VERSION,
	});
	return { matrixId: FIXTURE_MATRIX_ID, descriptors, contractVersion: INFERENCE_CATALOG_VERSION };
}

function fixtureMatrixWithOutsideOutput(): CapabilityMatrixRecord {
	const descriptors = fixtureMatrixRecord().descriptors.map((descriptor) =>
		descriptor.modelId === FIXTURE_MODEL_ALPHA_MAIN
			? { ...descriptor, maxOutputTokens: 16384 }
			: descriptor,
	);
	return { matrixId: FIXTURE_MATRIX_ID, descriptors, contractVersion: INFERENCE_CATALOG_VERSION };
}

function fixedClock(): number {
	return FIXTURE_NOW_MS;
}

function makeKit(ledgerRoot: string = LEDGER_TEST_ROOT, now: () => number = fixedClock): MatchingKit {
	return createMatchingKit({
		now,
		adapters: fixtureAdapterRecord(),
		matrix: fixtureMatrixRecord(),
		catalog: fixtureCatalogRecord(),
		ledgerRoot,
	});
}

function dedicatedLedgerRoot(name: string): string {
	const root = join(LEDGER_TEST_ROOT, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	return root;
}

function register(kit: MatchingKit, id: string, adapterId: string, declaredPriority?: number): void {
	const candidate: Record<string, unknown> = {
		id,
		adapterId,
		contractVersion: CONTRACT_INFERENCE_MATCHING_VERSION,
	};
	if (declaredPriority !== undefined) {
		candidate.declaredPriority = declaredPriority;
	}
	const admission = kit.register(candidate);
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
}

function registerStandardEntries(kit: MatchingKit): void {
	register(kit, FIXTURE_MATCH_FITS_ID, FIXTURE_ADAPTER_ALPHA);
	register(kit, FIXTURE_MATCH_TOO_SMALL_ID, FIXTURE_ADAPTER_BETA);
	register(kit, FIXTURE_MATCH_MODALITY_MISSING_ID, FIXTURE_ADAPTER_GAMMA);
	register(kit, FIXTURE_MATCH_DELTA_ID, FIXTURE_ADAPTER_DELTA);
}

function standardRequest(): Record<string, unknown> {
	return { contextTokens: 1000, modalities: ['text-in', 'text-out'], outputCapTokens: 512 };
}

function matchedOutcome(kit: MatchingKit, request: unknown): Extract<MatchOutcome, { kind: 'matched' }> {
	const outcome = kit.match(request);
	assert.equal(outcome.kind, 'matched', `expected a match, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome;
}

function ledgerLines(root: string): string[] {
	return readFileSync(join(root, MATCHING_DECISIONS_LEDGER_FILE), 'utf8')
		.split('\n')
		.filter((line) => line.length > 0);
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

suite('INF-006 matching kit', () => {

	suiteSetup(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
		mkdirSync(LEDGER_TEST_ROOT, { recursive: true });
	});

	suiteTeardown(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
	});

	suite('version stamping across both module copies (the single declaration)', () => {
		test('the contract copy and the kit re-carried copy are both 1.0.0 and equal', () => {
			assert.equal(CONTRACT_INFERENCE_MATCHING_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_MATCHING_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_MATCHING_VERSION, CONTRACT_INFERENCE_MATCHING_VERSION);
		});

		test('the kit stamps its records with the re-carried copy', () => {
			const kit = makeKit();
			register(kit, FIXTURE_MATCH_FITS_ID, FIXTURE_ADAPTER_ALPHA);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.contractVersion, KIT_RECARRIED_INFERENCE_MATCHING_VERSION);
			assert.equal(decision.contractVersion, CONTRACT_INFERENCE_MATCHING_VERSION);
			assert.equal(decision.provenance.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
		});
	});

	suite('MATCHING_KIT_REJECTION_REASONS (the frozen kit list)', () => {
		test('the contract reasons verbatim, in order, plus the kit-local duplicate', () => {
			assert.equal(MATCHING_KIT_REJECTION_REASONS.length, 18);
			assert.equal(MATCHING_KIT_REJECTION_REASONS[17], 'matching-entry-duplicate');
			assert.deepEqual(MATCHING_KIT_REJECTION_REASONS.slice(0, 17), [
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
			assert.equal(new Set(MATCHING_KIT_REJECTION_REASONS).size, MATCHING_KIT_REJECTION_REASONS.length);
		});
	});

	suite('createMatchingKit (the fail-closed factory)', () => {
		test('options.now must be a function', () => {
			assert.throws(
				() => createMatchingKit({ now: 42, adapters: {}, matrix: {}, catalog: {}, ledgerRoot: 'x' } as unknown as Parameters<typeof createMatchingKit>[0]),
				/^TypeError: createMatchingKit: options\.now must be a function/,
			);
		});

		test('ledgerRoot must be a non-empty string', () => {
			assert.throws(
				() => makeKit(''),
				/^TypeError: createMatchingKit: options\.ledgerRoot must be a non-empty string/,
			);
		});

		test('the bound catalog is validated through the landed guard (duplicate entry ids cited)', () => {
			const catalog: ProviderCatalogRecord = {
				...fixtureCatalogRecord(),
				entries: [...fixtureCatalogRecord().entries, { ...fixtureCatalogRecord().entries[0] }],
			};
			assert.throws(
				() =>
					createMatchingKit({
						now: fixedClock,
						adapters: fixtureAdapterRecord(),
						matrix: fixtureMatrixRecord(),
						catalog,
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/duplicate-entry-id/,
			);
		});

		test('the bound adapter record is validated through the landed guard (the direct-adapter law cited)', () => {
			const adapters: ProviderAdapterRecord = {
				...fixtureAdapterRecord(),
				adapters: fixtureAdapterRecord().adapters.map((adapter) =>
					adapter.adapterId === FIXTURE_ADAPTER_ALPHA
						? { ...adapter, capacityProvenance: 'flauz-provisioned' as const }
						: adapter,
				),
			};
			assert.throws(
				() =>
					createMatchingKit({
						now: fixedClock,
						adapters,
						matrix: fixtureMatrixRecord(),
						catalog: fixtureCatalogRecord(),
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/flauz-provisioned-adapter/,
			);
		});

		test('an adapter record dangling against the catalog is the landed no-dangling-ref rejection', () => {
			const adapters: ProviderAdapterRecord = {
				...fixtureAdapterRecord(),
				adapters: fixtureAdapterRecord().adapters.map((adapter) =>
					adapter.adapterId === FIXTURE_ADAPTER_DELTA
						? { ...adapter, providerEntryId: 'fixture.provider.nowhere' }
						: adapter,
				),
			};
			assert.throws(
				() =>
					createMatchingKit({
						now: fixedClock,
						adapters,
						matrix: fixtureMatrixRecord(),
						catalog: fixtureCatalogRecord(),
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/unknown-provider-entry.*dangling provider reference/,
			);
		});

		test('the bound capability matrix is validated through the landed guard (output outside the window cited)', () => {
			assert.throws(
				() =>
					createMatchingKit({
						now: fixedClock,
						adapters: fixtureAdapterRecord(),
						matrix: fixtureMatrixWithOutsideOutput(),
						catalog: fixtureCatalogRecord(),
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/max-output-outside-window/,
			);
		});

		test('a matrix dangling against the catalog is the landed no-dangling-ref rejection', () => {
			assert.throws(
				() =>
					createMatchingKit({
						now: fixedClock,
						adapters: fixtureAdapterRecord(),
						matrix: fixtureMatrixWithNowhereDescriptor(),
						catalog: fixtureCatalogRecord(),
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/unknown-provider-entry.*dangling provider reference/,
			);
		});

		test('ledgerRoot must be an existing directory (never invented, never a file)', () => {
			const missing = join(LEDGER_TEST_ROOT, 'no-such-directory');
			assert.throws(() => makeKit(missing), /^TypeError: createMatchingKit: options\.ledgerRoot/);
			const filePath = dedicatedLedgerRoot('factory-file');
			const fileTarget = join(filePath, 'not-a-directory');
			writeFileSync(fileTarget, 'fixture.file', 'utf8');
			assert.throws(() => makeKit(fileTarget), /^TypeError: createMatchingKit: options\.ledgerRoot/);
		});

		test('the injected clock must produce a finite epoch-ms number (one validation read at creation)', () => {
			let reads = 0;
			const counting: () => number = () => {
				reads += 1;
				return FIXTURE_NOW_MS;
			};
			const kit = makeKit(LEDGER_TEST_ROOT, counting);
			assert.equal(reads, 1);
			registerStandardEntries(kit);
			assert.equal(kit.count(), 4);
			assert.throws(
				() => makeKit(LEDGER_TEST_ROOT, () => NaN),
				/finite epoch-ms number/,
			);
		});

		test('a decision whose clock read is non-finite fails closed (one read per decision)', () => {
			let reads = 0;
			const counting: () => number = () => {
				reads += 1;
				return reads === 1 ? FIXTURE_NOW_MS : NaN;
			};
			const kit = makeKit(LEDGER_TEST_ROOT, counting);
			registerStandardEntries(kit);
			assert.throws(() => kit.match(standardRequest()), /finite epoch-ms decision instant/);
			assert.equal(reads, 2);
		});
	});

	suite('register (the frozen admission walk)', () => {
		test('admits well-formed entries and stores them verbatim', () => {
			const kit = makeKit();
			const admission = kit.register({
				id: FIXTURE_MATCH_FITS_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				declaredPriority: 3,
				contractVersion: CONTRACT_INFERENCE_MATCHING_VERSION,
			});
			assert.equal(admission.admitted, true);
			if (admission.admitted) {
				assert.equal(admission.entry.id, FIXTURE_MATCH_FITS_ID);
				assert.equal(admission.entry.declaredPriority, 3);
			}
			assert.equal(kit.find(FIXTURE_MATCH_FITS_ID)?.declaredPriority, 3);
		});

		test('a contract rejection surfaces verbatim through register', () => {
			const kit = makeKit();
			const stale = kit.register({
				id: FIXTURE_MATCH_FITS_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				contractVersion: '0.9.9',
			});
			assert.equal(stale.admitted, false);
			if (!stale.admitted) {
				assert.equal(stale.reason, 'version-mismatch');
			}
			const dangling = kit.register({
				id: FIXTURE_MATCH_FITS_ID,
				adapterId: 'fixture.adapter.nowhere',
				contractVersion: CONTRACT_INFERENCE_MATCHING_VERSION,
			});
			assert.equal(dangling.admitted, false);
			if (!dangling.admitted) {
				assert.equal(dangling.reason, 'unresolved-adapter-binding');
			}
			assert.equal(kit.count(), 0);
		});

		test('a repeated entry id is the typed kit-level duplicate, never a silent overwrite', () => {
			const kit = makeKit();
			register(kit, FIXTURE_MATCH_FITS_ID, FIXTURE_ADAPTER_ALPHA, 1);
			const duplicate = kit.register({
				id: FIXTURE_MATCH_FITS_ID,
				adapterId: FIXTURE_ADAPTER_BETA,
				contractVersion: CONTRACT_INFERENCE_MATCHING_VERSION,
			});
			assert.equal(duplicate.admitted, false);
			if (!duplicate.admitted) {
				assert.equal(duplicate.reason, 'matching-entry-duplicate');
				assert.match(duplicate.detail, /never a silent overwrite/);
			}
			assert.equal(kit.count(), 1);
			assert.equal(kit.find(FIXTURE_MATCH_FITS_ID)?.adapterId, FIXTURE_ADAPTER_ALPHA);
		});

		test('the contract guard runs first: a malformed duplicate reports the contract reason', () => {
			const kit = makeKit();
			register(kit, FIXTURE_MATCH_FITS_ID, FIXTURE_ADAPTER_ALPHA);
			const malformedDuplicate = kit.register({
				id: FIXTURE_MATCH_FITS_ID,
				adapterId: '',
				contractVersion: '0.9.9',
			});
			assert.equal(malformedDuplicate.admitted, false);
			if (!malformedDuplicate.admitted) {
				assert.equal(malformedDuplicate.reason, 'version-mismatch');
			}
		});

		test('the guard is pure: a rejected candidate is untouched', () => {
			const kit = makeKit();
			const candidate = { id: FIXTURE_MATCH_FITS_ID, adapterId: 'fixture.adapter.nowhere', contractVersion: '1.0.0' };
			const before = JSON.stringify(candidate);
			kit.register(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('list/find/count (the lookups)', () => {
		test('list is sorted by entry id, stable regardless of registration order', () => {
			const kit = makeKit();
			register(kit, FIXTURE_MATCH_TOO_SMALL_ID, FIXTURE_ADAPTER_BETA);
			register(kit, FIXTURE_MATCH_FITS_ID, FIXTURE_ADAPTER_ALPHA);
			register(kit, FIXTURE_MATCH_DELTA_ID, FIXTURE_ADAPTER_DELTA);
			register(kit, FIXTURE_MATCH_MODALITY_MISSING_ID, FIXTURE_ADAPTER_GAMMA);
			assert.deepEqual(
				kit.list().map((entry) => entry.id),
				[FIXTURE_MATCH_DELTA_ID, FIXTURE_MATCH_FITS_ID, FIXTURE_MATCH_MODALITY_MISSING_ID, FIXTURE_MATCH_TOO_SMALL_ID],
			);
			assert.equal(kit.find(FIXTURE_MATCH_FITS_ID)?.adapterId, FIXTURE_ADAPTER_ALPHA);
			assert.equal(kit.find('fixture.match.unknown'), undefined);
			assert.equal(kit.count(), 4);
		});
	});

	suite('match (the request validation)', () => {
		test('every request reason surfaces as the typed request-rejected outcome', () => {
			const kit = makeKit();
			const notAnObject = kit.match(null);
			assert.equal(notAnObject.kind, 'request-rejected');
			if (notAnObject.kind === 'request-rejected') {
				assert.equal(notAnObject.reason, 'not-an-object');
				assert.equal(typeof notAnObject.detail, 'string');
			}
			const cases: [unknown, string][] = [
				[{ contextTokens: 1.5 }, 'invalid-context-tokens'],
				[{ contextTokens: 0, modalities: ['text-in'] }, 'invalid-context-tokens'],
				[{ contextTokens: 1000, modalities: [] }, 'invalid-request-modalities'],
				[{ contextTokens: 1000, modalities: ['vibes'] }, 'invalid-request-modalities'],
				[{ contextTokens: 1000, outputCapTokens: -1 }, 'invalid-output-cap'],
				[{ contextTokens: 1000, requestTag: '' }, 'invalid-request-tag'],
				[{ contextTokens: 1000, provenance: {} }, 'caller-supplied-provenance'],
				[{ contextTokens: 1000, substitution: 'none' }, 'caller-supplied-provenance'],
			];
			for (const [request, reason] of cases) {
				const outcome = kit.match(request);
				assert.equal(outcome.kind, 'request-rejected', `expected rejection for ${JSON.stringify(request)}`);
				if (outcome.kind === 'request-rejected') {
					assert.equal(outcome.reason, reason);
				}
			}
		});

		test('a request rejection is never appended to the ledger (a rejection is not a decision)', () => {
			const root = dedicatedLedgerRoot('rejections');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			kit.match({ contextTokens: 0 });
			kit.match({ contextTokens: 1000, provenance: {} });
			assert.equal(existsSync(join(root, MATCHING_DECISIONS_LEDGER_FILE)), false);
		});
	});

	suite('match (the per-candidate verdict rows)', () => {
		test('a row per walked (entry, model) pair: five rows for the four fixture entries', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.rows.length, 5);
			assert.deepEqual(
				decision.rows.map((row) => (row.kind === 'candidate' ? `${row.entryId}:${row.modelId}` : row.kind)),
				[
					`${FIXTURE_MATCH_DELTA_ID}:${FIXTURE_MODEL_DELTA_ALT}`,
					`${FIXTURE_MATCH_DELTA_ID}:${FIXTURE_MODEL_DELTA_MAIN}`,
					`${FIXTURE_MATCH_FITS_ID}:${FIXTURE_MODEL_ALPHA_MAIN}`,
					`${FIXTURE_MATCH_MODALITY_MISSING_ID}:${FIXTURE_MODEL_GAMMA_MAIN}`,
					`${FIXTURE_MATCH_TOO_SMALL_ID}:${FIXTURE_MODEL_BETA_MAIN}`,
				],
			);
		});

		test('the row bindings name the entry, the adapter, the provider and the model', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			const fitsRow = decision.rows.find(
				(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_FITS_ID,
			);
			assert.ok(fitsRow && fitsRow.kind === 'candidate');
			assert.equal(fitsRow.adapterId, FIXTURE_ADAPTER_ALPHA);
			assert.equal(fitsRow.providerEntryId, FIXTURE_PROVIDER_ALPHA);
			assert.equal(fitsRow.modelId, FIXTURE_MODEL_ALPHA_MAIN);
		});

		test('the fits fixture row: all three verdicts fit and the pair is admissible', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			const fitsRow = decision.rows.find(
				(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_FITS_ID,
			);
			assert.ok(fitsRow && fitsRow.kind === 'candidate');
			assert.equal(fitsRow.contextWindowVerdict, 'context-fits');
			assert.equal(fitsRow.modalityCoverageVerdict, 'modalities-covered');
			assert.deepEqual(fitsRow.missingModalities, []);
			assert.equal(fitsRow.outputCapVerdict, 'output-cap-fits');
			assert.equal(fitsRow.admissible, true);
		});

		test('the too-small fixture row: the honest context-too-small verdict at one off the window min', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			const tooSmallRow = decision.rows.find(
				(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID,
			);
			assert.ok(tooSmallRow && tooSmallRow.kind === 'candidate');
			assert.equal(tooSmallRow.contextWindowVerdict, 'context-too-small');
			assert.equal(tooSmallRow.admissible, false);
		});

		test('the modality-missing fixture row: the missing list in the closed order', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			const missingRow = decision.rows.find(
				(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_MODALITY_MISSING_ID,
			);
			assert.ok(missingRow && missingRow.kind === 'candidate');
			assert.equal(missingRow.modalityCoverageVerdict, 'modalities-missing');
			assert.deepEqual(missingRow.missingModalities, ['text-out']);
			assert.equal(missingRow.admissible, false);
		});

		test('the output-cap verdict: a cap beyond the descriptor max is the honest exceeded verdict', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const outcome = kit.match({ contextTokens: 1000, outputCapTokens: 4096 });
			assert.equal(outcome.kind, 'no-matching-candidate');
			if (outcome.kind === 'no-matching-candidate') {
				for (const row of outcome.rows) {
					assert.ok(row.kind === 'candidate');
					assert.equal(row.outputCapVerdict, 'output-cap-exceeded');
					assert.equal(row.admissible, false);
				}
			}
			const fitsAt512 = matchedOutcome(kit, standardRequest());
			const fitsRow = fitsAt512.rows.find(
				(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_FITS_ID,
			);
			assert.ok(fitsRow && fitsRow.kind === 'candidate');
			assert.equal(fitsRow.outputCapVerdict, 'output-cap-fits');
		});

		test('inadmissible pairs ride the rows honestly - never silently dropped', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.rows.some((row) => row.kind === 'candidate' && !row.admissible), true);
			assert.equal(decision.rows.length, 5);
		});
	});

	suite('match (the inclusive-boundary law)', () => {
		test('a boundary-exact request at the window min and max FITS', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const atMin = matchedOutcome(kit, { contextTokens: 1001 });
			const minRow = atMin.rows.find((row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID);
			assert.ok(minRow && minRow.kind === 'candidate');
			assert.equal(minRow.contextWindowVerdict, 'context-fits');
			assert.equal(minRow.admissible, true);
			const atMax = matchedOutcome(kit, { contextTokens: 8192 });
			const maxRow = atMax.rows.find((row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID);
			assert.ok(maxRow && maxRow.kind === 'candidate');
			assert.equal(maxRow.contextWindowVerdict, 'context-fits');
			assert.equal(maxRow.admissible, true);
		});

		test('one off each side is the honest too-small / too-large verdict', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const below = matchedOutcome(kit, { contextTokens: 1000 });
			const belowRow = below.rows.find((row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID);
			assert.ok(belowRow && belowRow.kind === 'candidate');
			assert.equal(belowRow.contextWindowVerdict, 'context-too-small');
			const above = kit.match({ contextTokens: 8193 });
			assert.equal(above.kind, 'no-matching-candidate');
			if (above.kind === 'no-matching-candidate') {
				const aboveRow = above.rows.find(
					(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID,
				);
				assert.ok(aboveRow && aboveRow.kind === 'candidate');
				assert.equal(aboveRow.contextWindowVerdict, 'context-too-large');
				assert.equal(aboveRow.admissible, false);
				assert.equal(
					above.rows.every((row) => row.kind === 'candidate' && row.contextWindowVerdict === 'context-too-large'),
					true,
				);
			}
		});

		test('the landed contextWindowContains is the authority at every boundary probe', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const betaDescriptor = fixtureMatrixRecord().descriptors.find(
				(descriptor) => descriptor.modelId === FIXTURE_MODEL_BETA_MAIN,
			);
			assert.ok(betaDescriptor);
			for (const probe of [1000, 1001, 8192, 8193]) {
				const outcome = kit.match({ contextTokens: probe });
				assert.ok(
					outcome.kind === 'matched' || outcome.kind === 'no-matching-candidate',
					`probe ${probe}: expected a decision record`,
				);
				const rows = (outcome as { rows: readonly MatchVerdictRow[] }).rows;
				const row = rows.find(
					(row) => row.kind === 'candidate' && row.entryId === FIXTURE_MATCH_TOO_SMALL_ID,
				);
				assert.ok(row && row.kind === 'candidate');
				assert.equal(
					row.contextWindowVerdict === 'context-fits',
					contextWindowContains(betaDescriptor, probe),
					`probe ${probe}: the verdict must agree with the landed inclusive predicate`,
				);
			}
		});
	});

	suite('match (the disclosed ranking)', () => {
		test('the standard ranking: priority tie broken by entry id, then by model id', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.deepEqual(
				decision.ranked.map((candidate) => `${candidate.rank}:${candidate.entryId}:${candidate.modelId}`),
				[
					`1:${FIXTURE_MATCH_DELTA_ID}:${FIXTURE_MODEL_DELTA_ALT}`,
					`2:${FIXTURE_MATCH_DELTA_ID}:${FIXTURE_MODEL_DELTA_MAIN}`,
					`3:${FIXTURE_MATCH_FITS_ID}:${FIXTURE_MODEL_ALPHA_MAIN}`,
				],
			);
			assert.equal(decision.ranked.every((candidate) => candidate.priority === 0), true);
		});

		test('declaredPriority ascending overrides the entry id order', () => {
			const kit = makeKit();
			register(kit, 'fixture.match.zulu', FIXTURE_ADAPTER_ALPHA, 1);
			register(kit, 'fixture.match.alpha', FIXTURE_ADAPTER_DELTA, 2);
			const decision = matchedOutcome(kit, { contextTokens: 1000 });
			assert.equal(decision.ranked[0].entryId, 'fixture.match.zulu');
			assert.equal(decision.ranked[0].priority, 1);
			assert.equal(decision.ranked[1].entryId, 'fixture.match.alpha');
			assert.equal(decision.ranked[1].priority, 2);
			assert.equal(decision.ranked[2].entryId, 'fixture.match.alpha');
		});

		test('an undeclared priority rides the honest 0 default (after -1, before +1)', () => {
			const kit = makeKit();
			register(kit, 'fixture.match.undeclared', FIXTURE_ADAPTER_ALPHA);
			register(kit, 'fixture.match.negative', FIXTURE_ADAPTER_DELTA, -1);
			register(kit, 'fixture.match.positive', FIXTURE_ADAPTER_GAMMA, 1);
			const decision = matchedOutcome(kit, { contextTokens: 1000 });
			assert.deepEqual(
				decision.ranked.map((candidate) => candidate.entryId),
				['fixture.match.negative', 'fixture.match.negative', 'fixture.match.undeclared', 'fixture.match.positive'],
			);
		});

		test('double-run byte-stability at the same clock instant', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const first = matchedOutcome(kit, standardRequest());
			const second = matchedOutcome(kit, standardRequest());
			assert.equal(serializeMatchDecision(first), serializeMatchDecision(second));
			assert.equal(isMatchDecisionRecord(first), true);
		});
	});

	suite('match (the substitution-disclosure law)', () => {
		test('no tag: the selection is the ranked top, the substitution is none, never silent', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.substitution, 'none');
			assert.equal(decision.selected.entryId, decision.ranked[0].entryId);
			assert.equal(decision.selected.modelId, decision.ranked[0].modelId);
			assert.equal(decision.provenance.substitution, 'none');
			assert.equal(decision.provenance.requestedProviderId, decision.ranked[0].providerEntryId);
			assert.equal(decision.provenance.requestedModelId, decision.ranked[0].modelId);
			assert.equal(decision.provenance.actualProviderId, decision.selected.providerEntryId);
			assert.equal(decision.provenance.actualModelId, decision.selected.modelId);
		});

		test('the tag preference honored on a non-top admissible entry IS a disclosed substitution', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, {
				contextTokens: 1000,
				modalities: ['text-in', 'text-out'],
				outputCapTokens: 512,
				requestTag: FIXTURE_MATCH_FITS_ID,
			});
			assert.equal(decision.substitution, 'disclosed');
			assert.equal(decision.selected.entryId, FIXTURE_MATCH_FITS_ID);
			assert.equal(decision.selected.modelId, FIXTURE_MODEL_ALPHA_MAIN);
			assert.notEqual(decision.selected.entryId, decision.ranked[0].entryId);
			assert.equal(decision.provenance.substitution, 'disclosed');
			assert.equal(decision.provenance.requestedProviderId, decision.ranked[0].providerEntryId);
			assert.equal(decision.provenance.requestedModelId, decision.ranked[0].modelId);
			assert.equal(decision.provenance.actualProviderId, FIXTURE_PROVIDER_ALPHA);
			assert.equal(decision.provenance.actualModelId, FIXTURE_MODEL_ALPHA_MAIN);
			const provenanceAdmission = admitProvenance(decision.provenance);
			assert.equal(provenanceAdmission.admitted, true, 'the landed guard must admit the derived provenance');
			assert.equal(isMatchDecisionRecord(decision), true);
		});

		test('a tag naming the ranked top entry stays none', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, { ...standardRequest(), requestTag: FIXTURE_MATCH_DELTA_ID });
			assert.equal(decision.substitution, 'none');
			assert.equal(decision.selected.entryId, FIXTURE_MATCH_DELTA_ID);
			assert.equal(decision.selected.modelId, FIXTURE_MODEL_DELTA_ALT);
		});

		test('a tag naming an inadmissible entry is honestly ignored (the pure ranking stands)', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, { ...standardRequest(), requestTag: FIXTURE_MATCH_TOO_SMALL_ID });
			assert.equal(decision.substitution, 'none');
			assert.equal(decision.selected.entryId, decision.ranked[0].entryId);
			assert.equal(decision.selected.modelId, decision.ranked[0].modelId);
		});

		test('an unknown tag is honestly ignored', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, { ...standardRequest(), requestTag: 'fixture.match.unknown' });
			assert.equal(decision.substitution, 'none');
			assert.equal(decision.selected.entryId, decision.ranked[0].entryId);
		});

		test('the derived provenance is unverified by construction; the promotion is the caller\'s one-way copy', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.provenance.modelVerification, 'unverified');
			assert.equal(decision.provenance.recordedAtEpochMs, decision.decidedAtEpochMs);
			const promoted = markProvenanceVerified(decision.provenance);
			assert.equal(promoted.modelVerification, 'verified');
			assert.equal(decision.provenance.modelVerification, 'unverified', 'the kit never self-promotes');
			const fresh = matchedOutcome(kit, standardRequest());
			assert.equal(fresh.provenance.modelVerification, 'unverified');
			assert.equal(fresh.provenance.recordedAtEpochMs, fresh.decidedAtEpochMs);
		});
	});

	suite('match (the routing binding)', () => {
		test('the binding names the selected candidate\'s adapter with the landed selection rule', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, standardRequest());
			assert.equal(decision.routing.adapterId, decision.selected.adapterId);
			assert.equal(decision.routing.adapterId, FIXTURE_ADAPTER_DELTA);
			assert.equal(decision.routing.selectionRule, 'stable-adapter-id-order');
			assert.equal((ROUTING_SELECTION_RULES as readonly string[]).includes(decision.routing.selectionRule), true);
		});

		test('the binding follows the tag preference onto the substituted adapter', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const decision = matchedOutcome(kit, { ...standardRequest(), requestTag: FIXTURE_MATCH_FITS_ID });
			assert.equal(decision.substitution, 'disclosed');
			assert.equal(decision.routing.adapterId, FIXTURE_ADAPTER_ALPHA);
			assert.equal(decision.routing.adapterId, decision.selected.adapterId);
		});
	});

	suite('match (the no-match typed refusal)', () => {
		test('zero admissible candidates: the typed refusal carrying the FULL honest rows', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const outcome = kit.match({ contextTokens: 1000, outputCapTokens: 4096 });
			assert.equal(outcome.kind, 'no-matching-candidate');
			if (outcome.kind === 'no-matching-candidate') {
				assert.equal(outcome.rows.length, 5);
				assert.equal(outcome.rows.every((row) => row.kind === 'candidate'), true);
				assert.equal(
					outcome.rows.every((row) => row.kind === 'candidate' && row.outputCapVerdict === 'output-cap-exceeded'),
					true,
				);
				assert.equal('selected' in outcome, false);
				assert.equal('provenance' in outcome, false);
				assert.equal('routing' in outcome, false);
				assert.equal(isMatchDecisionRecord(outcome), true);
			}
		});

		test('zero registered entries: the typed refusal with the honest empty rows', () => {
			const kit = makeKit();
			const outcome = kit.match(standardRequest());
			assert.equal(outcome.kind, 'no-matching-candidate');
			if (outcome.kind === 'no-matching-candidate') {
				assert.deepEqual(outcome.rows, []);
				assert.equal(outcome.request.contextTokens, 1000);
			}
		});

		test('the refusal is a record, never an exception, never a fabricated match', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const outcome = kit.match({ contextTokens: 1000, outputCapTokens: 4096 });
			assert.equal(outcome.kind, 'no-matching-candidate');
			assert.equal(isMatchDecisionRecord(outcome), true);
		});
	});

	suite('rankPreview (the pure preview)', () => {
		test('identical outcome to match at the same clock, without the ledger append', () => {
			const root = dedicatedLedgerRoot('preview');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			const preview = kit.rankPreview(standardRequest());
			assert.equal(existsSync(join(root, MATCHING_DECISIONS_LEDGER_FILE)), false);
			assert.equal(preview.kind, 'matched');
			const decided = kit.match(standardRequest());
			assert.equal(decided.kind, 'matched');
			assert.equal(serializeMatchDecision(preview), serializeMatchDecision(decided));
			const lines = ledgerLines(root);
			assert.equal(lines.length, 1);
			assert.equal(lines[0], serializeMatchDecision(decided));
			const previewTwo = kit.rankPreview(standardRequest());
			assert.equal(previewTwo.kind, 'matched');
			assert.equal(ledgerLines(root).length, 1);
		});

		test('the preview walks the same engine paths (verdict rows, ranking, refusal)', () => {
			const kit = makeKit();
			registerStandardEntries(kit);
			const preview = kit.rankPreview({ contextTokens: 1000, outputCapTokens: 4096 });
			assert.equal(preview.kind, 'no-matching-candidate');
			const taggedPreview = kit.rankPreview({ ...standardRequest(), requestTag: FIXTURE_MATCH_FITS_ID });
			assert.equal(taggedPreview.kind, 'matched');
			if (taggedPreview.kind === 'matched') {
				assert.equal(taggedPreview.substitution, 'disclosed');
			}
		});
	});

	suite('recordDecision (the append-only ledger)', () => {
		test('appends the canonical bytes, one decision per line, in call order', () => {
			const root = dedicatedLedgerRoot('ordering');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			const first = matchedOutcome(kit, standardRequest());
			const second = matchedOutcome(kit, { ...standardRequest(), requestTag: FIXTURE_MATCH_FITS_ID });
			const refusal = kit.match({ contextTokens: 1000, outputCapTokens: 4096 });
			assert.equal(refusal.kind, 'no-matching-candidate');
			const lines = ledgerLines(root);
			assert.equal(lines.length, 3);
			assert.equal(lines[0], serializeMatchDecision(first));
			assert.equal(lines[1], serializeMatchDecision(second));
			assert.equal(lines[2], serializeMatchDecision(refusal));
			const parsed = lines.map((line) => JSON.parse(line) as { kind: string });
			assert.deepEqual(parsed.map((entry) => entry.kind), ['matched', 'matched', 'no-matching-candidate']);
		});

		test('the file grows only: earlier lines never change (append-only ordering)', () => {
			const root = dedicatedLedgerRoot('growth');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			matchedOutcome(kit, standardRequest());
			const afterFirst = ledgerLines(root);
			matchedOutcome(kit, { contextTokens: 1001 });
			const afterSecond = ledgerLines(root);
			assert.equal(afterSecond.length, 2);
			assert.equal(afterSecond[0], afterFirst[0]);
			assert.equal(afterSecond[0].includes('"kind":"matched"'), true);
		});

		test('recordDecision validates through the contract guard and appends foreign-shaped decisions', () => {
			const root = dedicatedLedgerRoot('external');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			const decided = matchedOutcome(kit, standardRequest());
			const external = foreign(JSON.stringify(decided));
			kit.recordDecision(external);
			const lines = ledgerLines(root);
			assert.equal(lines.length, 2);
			assert.equal(lines[1], serializeMatchDecision(external));
		});

		test('a malformed decision never gets ledger bytes (fail-closed TypeError)', () => {
			const root = dedicatedLedgerRoot('malformed');
			const kit = makeKit(root);
			registerStandardEntries(kit);
			assert.throws(() => kit.recordDecision(undefined), TypeError);
			assert.throws(() => kit.recordDecision({ kind: 'matched' }), TypeError);
			const decided = matchedOutcome(kit, standardRequest());
			assert.equal(
				ledgerLines(root).length,
				1,
				'only the kit\'s own decision was appended - the malformed attempts appended nothing',
			);
			assert.throws(
				() => kit.recordDecision({ ...decided, substitution: 'disclosed' }),
				TypeError,
			);
			assert.equal(ledgerLines(root).length, 1);
			assert.ok(decided);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in matchingKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/matchingKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in matchingContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/matchingContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
