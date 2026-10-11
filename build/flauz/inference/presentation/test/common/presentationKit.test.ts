/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-008 presentation kit test suite (mocha tdd style, matching
 * build/flauz/inference/isolation/test/common/isolationKit.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle, scope id, matrix id, catalog id and probe value
 * below is SYNTHETIC (prefixed 'fixture.') and is NOT an authority
 * value. Closed-vocabulary members (the verdicts, the rejection
 * reasons, the substitution states, the reset classes, the version
 * stamps) are the contract's own values under test. The three
 * disclosed fixture view ids (fixture.view.healthy /
 * fixture.view.refused / fixture.view.unknown-reset) are the kit
 * module's own exported constants, bound by this suite in its
 * fixture bound records. The landed decision records the folds
 * project are produced END-TO-END through the LANDED routing /
 * matching / isolation kits over the same fixture records (the
 * real-landed-record evidence chain); the hand-built probes cover
 * the refusal sides. Runtime-boundary probes are injected as
 * JSON-parsed values. All timestamps ride the fixed injected clock;
 * the suites never read a clock. The ledger and audit tests run at
 * caller-injected roots under os.tmpdir(), outside the repo tree,
 * cleaned per suite run (local-real filesystem evidence; the record
 * values themselves stay synthetic fixtures).
 */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_VIEW_HEALTHY_ID,
	FIXTURE_VIEW_REFUSED_ID,
	FIXTURE_VIEW_UNKNOWN_RESET_ID,
	INFERENCE_PRESENTATION_VERSION as KIT_RECARRIED_INFERENCE_PRESENTATION_VERSION,
	PRESENTATION_AUDITS_LEDGER_FILE,
	createPresentationKit,
} from '../../common/presentationKit.js';
import type { PresentationKit } from '../../common/presentationKit.js';
import {
	INFERENCE_PRESENTATION_VERSION as CONTRACT_INFERENCE_PRESENTATION_VERSION,
	serializePresentationRecord,
} from '../../common/presentationContract.js';
import type {
	DecisionView,
	PresentationOutcome,
	PresentationProjected,
	PresentationRefused,
	ProvenanceView,
} from '../../common/presentationContract.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	markProvenanceVerified,
	projectCapacityDisclosure,
	unverifiedProvenance,
} from '../../../semantics/common/capacityDisclosure.js';
import type { InferenceProvenance, ProviderCapacityDisclosure } from '../../../semantics/common/capacityDisclosure.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION, reportAdapterSnapshot } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterDescriptor, ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';
import { ROUTING_PROBE_SCOPE, createRoutingKit } from '../../../routing/common/routingKit.js';
import { serializeRoutingDecision } from '../../../routing/common/routingContract.js';
import type { RoutingOutcome } from '../../../routing/common/routingContract.js';
import type { RoutingKit } from '../../../routing/common/routingKit.js';
import { createMatchingKit } from '../../../matching/common/matchingKit.js';
import { serializeMatchDecision } from '../../../matching/common/matchingContract.js';
import type { MatchingKit } from '../../../matching/common/matchingKit.js';
import { createIsolationKit } from '../../../isolation/common/isolationKit.js';
import { ISOLATION_ELIGIBILITY_PROBE_SCOPE, serializeEligibilityDecision } from '../../../isolation/common/isolationContract.js';
import type { EligibilityDecisionRecord } from '../../../isolation/common/isolationContract.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.presentation';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.presentation';
const FIXTURE_SCOPE_SET_ID = 'fixture.scope-set.presentation';
const FIXTURE_MATRIX_ID = 'fixture.matrix.presentation';
const FIXTURE_PROVIDER_HEALTHY = 'fixture.provider.healthy';
const FIXTURE_PROVIDER_REFUSED = 'fixture.provider.refused';
const FIXTURE_PROVIDER_UNKNOWN_RESET = 'fixture.provider.unknown-reset';
const FIXTURE_CREDENTIAL_HEALTHY = 'fixture.credential.handle.healthy';
const FIXTURE_CREDENTIAL_REFUSED = 'fixture.credential.handle.refused';
const FIXTURE_CREDENTIAL_UNKNOWN_RESET = 'fixture.credential.handle.unknown-reset';
const FIXTURE_MODEL_HEALTHY_MAIN = 'fixture.model.healthy-main';
const FIXTURE_MODEL_REFUSED_MAIN = 'fixture.model.refused-main';
const FIXTURE_MODEL_UNKNOWN_RESET_MAIN = 'fixture.model.unknown-reset-main';
const FIXTURE_SCOPE_HEALTHY_ID = 'fixture.scope.healthy';
const FIXTURE_SCOPE_REFUSED_ID = 'fixture.scope.refused';
const FIXTURE_SCOPE_UNKNOWN_RESET_ID = 'fixture.scope.unknown-reset';
const FIXTURE_MATCH_HEALTHY_ID = 'fixture.match.healthy';
const FIXTURE_MATCH_REFUSED_ID = 'fixture.match.refused';
const FIXTURE_MATCH_UNKNOWN_RESET_ID = 'fixture.match.unknown-reset';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_RESET_AT_MS = 1_700_003_600_000;
const LEDGER_TEST_ROOT = join(tmpdir(), 'flauz-inference-presentation-battery');
const INFERENCE_MATCHING_STAMP = '1.0.0';
const INFERENCE_ISOLATION_STAMP = '1.0.0';

function fixtureCatalogRecord(): ProviderCatalogRecord {
	return {
		catalogId: FIXTURE_CATALOG_ID,
		entries: [
			{
				...unknownCapacityEntry(FIXTURE_PROVIDER_HEALTHY, 'third-party-free-tier', FIXTURE_NOW_MS),
				termsState: 'permitted',
			},
			{
				...unknownCapacityEntry(FIXTURE_PROVIDER_REFUSED, 'user-owned-endpoint', FIXTURE_NOW_MS),
				termsState: 'prohibited',
			},
			unknownCapacityEntry(FIXTURE_PROVIDER_UNKNOWN_RESET, 'third-party-free-tier', FIXTURE_NOW_MS),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureAdapterRecord(): ProviderAdapterRecord {
	return {
		adapterSetId: FIXTURE_ADAPTER_SET_ID,
		adapters: [
			{
				adapterId: FIXTURE_VIEW_HEALTHY_ID,
				displayName: 'Fixture View Adapter Healthy',
				providerEntryId: FIXTURE_PROVIDER_HEALTHY,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_HEALTHY,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_VIEW_REFUSED_ID,
				displayName: 'Fixture View Adapter Refused',
				providerEntryId: FIXTURE_PROVIDER_REFUSED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'user-owned-endpoint',
				credentialHandle: FIXTURE_CREDENTIAL_REFUSED,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_VIEW_UNKNOWN_RESET_ID,
				displayName: 'Fixture View Adapter Unknown Reset',
				providerEntryId: FIXTURE_PROVIDER_UNKNOWN_RESET,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_UNKNOWN_RESET,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
		],
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

function fixtureScopeSetRecord(): Record<string, unknown> {
	return {
		scopeSetId: FIXTURE_SCOPE_SET_ID,
		scopes: [
			{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_VIEW_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
			{ id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_VIEW_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
			{ id: FIXTURE_SCOPE_UNKNOWN_RESET_ID, adapterId: FIXTURE_VIEW_UNKNOWN_RESET_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN_RESET },
		],
		contractVersion: INFERENCE_ISOLATION_STAMP,
	};
}

function fixtureMatrixRecord(): Record<string, unknown> {
	return {
		matrixId: FIXTURE_MATRIX_ID,
		descriptors: [
			{
				modelId: FIXTURE_MODEL_HEALTHY_MAIN,
				providerEntryId: FIXTURE_PROVIDER_HEALTHY,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_REFUSED_MAIN,
				providerEntryId: FIXTURE_PROVIDER_REFUSED,
				contextWindow: { minTokens: 256, maxTokens: 512 },
				maxOutputTokens: 256,
				modalities: ['text-in', 'text-out'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
			{
				modelId: FIXTURE_MODEL_UNKNOWN_RESET_MAIN,
				providerEntryId: FIXTURE_PROVIDER_UNKNOWN_RESET,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in'],
				contractVersion: INFERENCE_CATALOG_VERSION,
			},
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixedClock(): number {
	return FIXTURE_NOW_MS;
}

/** The counting clock: pins the kit's one-read-per-fold laws. */
function countingClock(): { now: () => number; reads: () => number } {
	let reads = 0;
	return {
		now: () => {
			reads += 1;
			return FIXTURE_NOW_MS;
		},
		reads: () => reads,
	};
}

/** The flaky clock: finite once (the creation validation read), non-finite after. */
function flakyClock(): () => number {
	let calls = 0;
	return () => {
		calls += 1;
		return calls === 1 ? FIXTURE_NOW_MS : Number.NaN;
	};
}

function makeKit(
	ledgerRoot: string = LEDGER_TEST_ROOT,
	now: () => number = fixedClock,
	scopes: unknown = fixtureScopeSetRecord(),
	adapters: unknown = fixtureAdapterRecord(),
	catalog: unknown = fixtureCatalogRecord(),
): PresentationKit {
	return createPresentationKit({ now, catalog, adapters, scopes, ledgerRoot });
}

function dedicatedLedgerRoot(name: string): string {
	const root = join(LEDGER_TEST_ROOT, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	return root;
}

/** The landed honest provenance fixture (the unverified default). */
function landedProvenance(): InferenceProvenance {
	return unverifiedProvenance({
		requestedProviderId: FIXTURE_PROVIDER_HEALTHY,
		requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN,
		actualProviderId: FIXTURE_PROVIDER_HEALTHY,
		actualModelId: FIXTURE_MODEL_HEALTHY_MAIN,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	});
}

/** The landed healthy disclosure fixture, produced THROUGH the landed projection. */
function landedHealthyDisclosure(): ProviderCapacityDisclosure {
	const snapshot = {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		providerId: FIXTURE_PROVIDER_HEALTHY,
		verification: 'unverified' as const,
		health: 'healthy' as const,
		quota: {
			state: 'known' as const,
			remaining: 1000,
			limit: 1000,
			window: { kind: 'fixed' as const, windowStartEpochMs: FIXTURE_NOW_MS - 1000, windowLengthMs: 3_600_000 },
		},
		cooldown: { state: 'none' as const },
		resetSchedule: { kind: 'fixed-instant' as const, atEpochMs: FIXTURE_RESET_AT_MS },
		observedAtEpochMs: FIXTURE_NOW_MS,
	};
	const outcome = projectCapacityDisclosure(snapshot, landedProvenance(), FIXTURE_NOW_MS);
	assert.equal(outcome.disclosed, true, 'the fixture disclosure must project');
	return outcome.disclosure;
}

/**
 * The landed cooldown disclosure fixture at the inclusive boundary:
 * the cooldown's untilEpochMs is exactly the probe instant (inclusive
 * on both ends - the landed cooldownActive law).
 */
function landedBoundaryDisclosure(untilEpochMs: number): ProviderCapacityDisclosure {
	const snapshot = {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		providerId: FIXTURE_PROVIDER_HEALTHY,
		verification: 'unverified' as const,
		health: 'healthy' as const,
		quota: {
			state: 'known' as const,
			remaining: 1000,
			limit: 1000,
			window: { kind: 'fixed' as const, windowStartEpochMs: FIXTURE_NOW_MS - 1000, windowLengthMs: 3_600_000 },
		},
		cooldown: {
			state: 'active' as const,
			reason: 'rate-limited' as const,
			sinceEpochMs: FIXTURE_NOW_MS - 1000,
			untilEpochMs,
		},
		resetSchedule: { kind: 'fixed-instant' as const, atEpochMs: FIXTURE_RESET_AT_MS },
		observedAtEpochMs: FIXTURE_NOW_MS,
	};
	const outcome = projectCapacityDisclosure(snapshot, landedProvenance(), FIXTURE_NOW_MS);
	assert.equal(outcome.disclosed, true, 'the fixture disclosure must project');
	return outcome.disclosure;
}

/** The landed routing decision fixture, produced END-TO-END through the landed routing kit. */
function landedRoutingDecision(): Record<string, unknown> {
	const routingKit = createRoutingKit({
		now: fixedClock,
		adapters: fixtureAdapterRecord(),
		catalog: fixtureCatalogRecord(),
	});
	const adapter: ProviderAdapterDescriptor = fixtureAdapterRecord().adapters[0];
	const report = reportAdapterSnapshot(
		adapter,
		{
			observedAtEpochMs: FIXTURE_NOW_MS,
			health: 'healthy',
			quota: {
				state: 'known',
				remaining: 1000,
				limit: 1000,
				window: { kind: 'fixed', windowStartEpochMs: FIXTURE_NOW_MS - 1000, windowLengthMs: 3_600_000 },
			},
			cooldown: { state: 'none' },
			reset: { kind: 'fixed-instant', atEpochMs: FIXTURE_RESET_AT_MS },
		},
		{
			requestedProviderId: FIXTURE_PROVIDER_HEALTHY,
			requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN,
			actualProviderId: FIXTURE_PROVIDER_HEALTHY,
			actualModelId: FIXTURE_MODEL_HEALTHY_MAIN,
			recordedAtEpochMs: FIXTURE_NOW_MS,
		},
	);
	const admission = routingKit.addCandidate({ adapterId: FIXTURE_VIEW_HEALTHY_ID, report });
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	const outcome: RoutingOutcome = routingKit.route({ at: FIXTURE_NOW_MS });
	assert.equal(outcome.kind, 'selected', `expected a selected outcome, got: ${JSON.stringify(outcome).slice(0, 300)}`);
	return outcome.decision as unknown as Record<string, unknown>;
}

/** The landed routing exhausted outcome over ZERO admitted candidates (the honest empty ledger). */
function landedEmptyExhaustedOutcome(): Record<string, unknown> {
	const routingKit: RoutingKit = createRoutingKit({
		now: fixedClock,
		adapters: fixtureAdapterRecord(),
		catalog: fixtureCatalogRecord(),
	});
	return routingKit.route({ at: FIXTURE_NOW_MS }) as unknown as Record<string, unknown>;
}

/** The landed matching decision fixture, produced END-TO-END through the landed matching kit. */
function landedMatchingDecision(request: Record<string, unknown>): Record<string, unknown> {
	const matchingKit: MatchingKit = createMatchingKit({
		now: fixedClock,
		adapters: fixtureAdapterRecord(),
		matrix: fixtureMatrixRecord(),
		catalog: fixtureCatalogRecord(),
		ledgerRoot: dedicatedLedgerRoot('matching'),
	});
	for (const entryId of [FIXTURE_MATCH_HEALTHY_ID, FIXTURE_MATCH_REFUSED_ID, FIXTURE_MATCH_UNKNOWN_RESET_ID]) {
		const adapterId =
			entryId === FIXTURE_MATCH_HEALTHY_ID
				? FIXTURE_VIEW_HEALTHY_ID
				: entryId === FIXTURE_MATCH_REFUSED_ID
					? FIXTURE_VIEW_REFUSED_ID
					: FIXTURE_VIEW_UNKNOWN_RESET_ID;
		const admission = matchingKit.register({ id: entryId, adapterId, contractVersion: INFERENCE_MATCHING_STAMP });
		assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	}
	return matchingKit.match(request) as unknown as Record<string, unknown>;
}

/** The landed eligibility decision fixture, produced END-TO-END through the landed isolation kit. */
function landedEligibilityDecision(scopeId: unknown, usageClass: unknown): EligibilityDecisionRecord {
	const isolationKit = createIsolationKit({
		now: fixedClock,
		adapters: fixtureAdapterRecord(),
		catalog: fixtureCatalogRecord(),
		ledgerRoot: dedicatedLedgerRoot('isolation'),
	});
	for (const scope of [
		{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_VIEW_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
		{ id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_VIEW_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
		{ id: FIXTURE_SCOPE_UNKNOWN_RESET_ID, adapterId: FIXTURE_VIEW_UNKNOWN_RESET_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN_RESET },
	]) {
		const admission = isolationKit.register(scope);
		assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	}
	return isolationKit.checkEligibility(scopeId, usageClass);
}

/** The hand-built routing exhausted fixture with honest ledger entries (the why view). */
function fixtureExhaustedOutcome(): Record<string, unknown> {
	return {
		kind: 'exhausted',
		contractVersion: '1.0.0',
		atEpochMs: FIXTURE_NOW_MS,
		attemptLedger: [
			{ adapterId: FIXTURE_VIEW_HEALTHY_ID, atEpochMs: FIXTURE_NOW_MS, outcome: 'skipped-cooldown', reason: 'rate-limited' },
			{ adapterId: FIXTURE_VIEW_REFUSED_ID, atEpochMs: FIXTURE_NOW_MS, outcome: 'skipped-quota', reason: 'quota-exhausted' },
		],
	};
}

/** The seven-line ledger fixture: landed canonical bytes, malformed lines, and dangling bindings. */
function ledgerFixtureLines(): string[] {
	const decided = landedEligibilityDecision(FIXTURE_SCOPE_HEALTHY_ID, 'product-inference');
	const matched = landedMatchingDecision({ contextTokens: 1000 });
	const routingDecision = landedRoutingDecision();
	const danglingScope: Record<string, unknown> = { ...decided, scopeId: 'fixture.scope.nowhere' };
	const danglingAdapter: Record<string, unknown> = { ...routingDecision, adapterId: 'fixture.adapter.nowhere' };
	const parsed = JSON.parse(serializeEligibilityDecision(decided)) as Record<string, unknown>;
	const shuffled: Record<string, unknown> = {};
	for (const key of Object.keys(parsed).reverse()) {
		shuffled[key] = parsed[key];
	}
	return [
		serializeEligibilityDecision(decided),
		serializeMatchDecision(matched),
		serializeRoutingDecision(routingDecision),
		'{"kind":"decided",',
		JSON.stringify(shuffled),
		serializeEligibilityDecision(danglingScope),
		serializeRoutingDecision(danglingAdapter),
	];
}

function writeLedgerFile(name: string, lines: readonly string[]): string {
	const root = dedicatedLedgerRoot(name);
	const path = join(root, 'fixture-decisions.jsonl');
	writeFileSync(path, lines.join('\n') + '\n', 'utf8');
	return path;
}

function projectedView<TView>(outcome: PresentationOutcome<TView>): PresentationProjected<TView> {
	assert.equal(outcome.projected, true, `expected a projected view, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome as PresentationProjected<TView>;
}

function refusedOutcome(outcome: PresentationOutcome<unknown>): PresentationRefused {
	assert.equal(outcome.projected, false, `expected a typed refusal, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome as PresentationRefused;
}

/** The selected side's provenance view (the nothing-is-fabricated law: every selected view carries one). */
function selectedProvenance(view: DecisionView): ProvenanceView {
	assert.equal(view.side, 'selected');
	assert.notEqual(view.provenance, 'none', 'the selected side carries a real provenance view');
	return view.provenance as ProvenanceView;
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-008 presentation kit', () => {

	suiteSetup(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
		mkdirSync(LEDGER_TEST_ROOT, { recursive: true });
	});

	suiteTeardown(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
	});

	suite('version stamping across both module copies (the single declaration)', () => {
		test('the contract copy and the kit re-carried copy are both 1.0.0 and equal', () => {
			assert.equal(CONTRACT_INFERENCE_PRESENTATION_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_PRESENTATION_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_PRESENTATION_VERSION, CONTRACT_INFERENCE_PRESENTATION_VERSION);
		});

		test('the kit stamps its views with the re-carried copy while the landed record keeps its own stamp', () => {
			const kit = makeKit();
			const landed = landedProvenance();
			assert.equal(landed.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			const view = projectedView(kit.projectProvenance(landed)).view;
			assert.equal(view.contractVersion, KIT_RECARRIED_INFERENCE_PRESENTATION_VERSION);
			assert.equal(view.contractVersion, CONTRACT_INFERENCE_PRESENTATION_VERSION);
		});
	});

	suite('createPresentationKit (the fail-closed factory)', () => {
		test('options.now must be a function', () => {
			assert.throws(
				() => createPresentationKit({ now: 42, catalog: {}, adapters: {}, scopes: {}, ledgerRoot: 'x' } as unknown as Parameters<typeof createPresentationKit>[0]),
				/^TypeError: createPresentationKit: options\.now must be a function/,
			);
		});

		test('ledgerRoot must be a non-empty string', () => {
			assert.throws(
				() => makeKit(''),
				/^TypeError: createPresentationKit: options\.ledgerRoot must be a non-empty string/,
			);
		});

		test('the bound catalog is validated through the landed guard (duplicate entry ids cited)', () => {
			const catalog: ProviderCatalogRecord = {
				...fixtureCatalogRecord(),
				entries: [...fixtureCatalogRecord().entries, { ...fixtureCatalogRecord().entries[0] }],
			};
			assert.throws(() => makeKit(LEDGER_TEST_ROOT, fixedClock, fixtureScopeSetRecord(), fixtureAdapterRecord(), catalog), /duplicate-entry-id/);
		});

		test('the bound adapter record is validated through the landed guard (the direct-adapter law cited)', () => {
			const adapters: ProviderAdapterRecord = {
				...fixtureAdapterRecord(),
				adapters: fixtureAdapterRecord().adapters.map((adapter) =>
					adapter.adapterId === FIXTURE_VIEW_HEALTHY_ID
						? { ...adapter, capacityProvenance: 'flauz-provisioned' as const }
						: adapter,
				),
			};
			assert.throws(
				() => makeKit(LEDGER_TEST_ROOT, fixedClock, fixtureScopeSetRecord(), adapters, fixtureCatalogRecord()),
				/flauz-provisioned-adapter/,
			);
		});

		test('the bound scope set is validated through the landed guard (the handle-equality law cited)', () => {
			const scopes = {
				...fixtureScopeSetRecord(),
				scopes: [
					{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_VIEW_HEALTHY_ID, handleRef: 'fixture.credential.invented' },
				],
			};
			assert.throws(() => makeKit(LEDGER_TEST_ROOT, fixedClock, scopes), /credential-handle-mismatch/);
		});

		test('the bound scope set is validated through the landed guard (the no-dangling adapter binding cited)', () => {
			const scopes = {
				...fixtureScopeSetRecord(),
				scopes: [{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: 'fixture.adapter.nowhere', handleRef: FIXTURE_CREDENTIAL_HEALTHY }],
			};
			assert.throws(() => makeKit(LEDGER_TEST_ROOT, fixedClock, scopes), /unresolved-adapter-binding/);
		});

		test('the ledger root must be an existing directory', () => {
			const filePath = join(LEDGER_TEST_ROOT, 'not-a-directory.txt');
			writeFileSync(filePath, 'fixture', 'utf8');
			assert.throws(() => makeKit(filePath), /must be an existing directory/);
		});

		test('the injected clock must produce a finite epoch-ms number (one validation read)', () => {
			const clock = countingClock();
			makeKit(LEDGER_TEST_ROOT, clock.now);
			assert.equal(clock.reads(), 1);
			assert.throws(() => makeKit(LEDGER_TEST_ROOT, () => Number.NaN), /must produce a finite epoch-ms number/);
		});

		test('the honest EMPTY scope set is a legal binding', () => {
			const scopes = { scopeSetId: 'fixture.scope-set.empty', scopes: [], contractVersion: INFERENCE_ISOLATION_STAMP };
			const kit = makeKit(dedicatedLedgerRoot('empty-scopes'), fixedClock, scopes);
			assert.deepEqual(kit.snapshot().boundScopeIds, []);
		});
	});

	suite('projectProvenance (the never-re-derive fold)', () => {
		test('the landed provenance projects with every field verbatim and the scope label equal to the actual model field', () => {
			const kit = makeKit();
			const view = projectedView(kit.projectProvenance(landedProvenance())).view;
			assert.equal(view.verification, 'unverified');
			assert.equal(view.substitution, 'none');
			assert.equal(view.scopeLabel, FIXTURE_MODEL_HEALTHY_MAIN);
			assert.equal(view.requestedProviderId, FIXTURE_PROVIDER_HEALTHY);
			assert.equal(view.requestedModelId, FIXTURE_MODEL_HEALTHY_MAIN);
			assert.equal(view.actualProviderId, FIXTURE_PROVIDER_HEALTHY);
			assert.equal(view.actualModelId, FIXTURE_MODEL_HEALTHY_MAIN);
			assert.equal(view.recordedAtEpochMs, FIXTURE_NOW_MS);
		});

		test('the substituted landed provenance projects the disclosed label verbatim', () => {
			const kit = makeKit();
			const substituted = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_HEALTHY,
				requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN,
				actualProviderId: FIXTURE_PROVIDER_REFUSED,
				actualModelId: FIXTURE_MODEL_REFUSED_MAIN,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			const view = projectedView(kit.projectProvenance(substituted)).view;
			assert.equal(view.substitution, 'disclosed');
			assert.equal(view.scopeLabel, FIXTURE_MODEL_REFUSED_MAIN);
		});

		test('the verified landed provenance projects the verified state verbatim (never re-stamped)', () => {
			const kit = makeKit();
			const view = projectedView(kit.projectProvenance(markProvenanceVerified(landedProvenance()))).view;
			assert.equal(view.verification, 'verified');
		});

		test('the landed probe-scope conventions ride the actual model field verbatim', () => {
			const kit = makeKit();
			const routingScope = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_HEALTHY,
				requestedModelId: ROUTING_PROBE_SCOPE,
				actualProviderId: FIXTURE_PROVIDER_HEALTHY,
				actualModelId: ROUTING_PROBE_SCOPE,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			assert.equal(projectedView(kit.projectProvenance(routingScope)).view.scopeLabel, ROUTING_PROBE_SCOPE);
			const isolationScope = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_HEALTHY,
				requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				actualProviderId: FIXTURE_PROVIDER_HEALTHY,
				actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			assert.equal(projectedView(kit.projectProvenance(isolationScope)).view.scopeLabel, ISOLATION_ELIGIBILITY_PROBE_SCOPE);
		});

		test('a non-object is the typed not-an-object refusal', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectProvenance(null)).reason, 'not-an-object');
			assert.equal(refusedOutcome(kit.projectProvenance('fixture')).reason, 'not-an-object');
		});

		test('a caller-supplied label field is the typed rejection (the never-re-derive law)', () => {
			const kit = makeKit();
			for (const extra of [{ substitutionLabel: 'none' }, { provenanceLabel: 'x' }, { scopeLabel: 'fixture.display-label' }, { verificationLabel: 'ok' }]) {
				const refusal = refusedOutcome(kit.projectProvenance({ ...landedProvenance(), ...extra }));
				assert.equal(refusal.reason, 'caller-supplied-label');
				assert.match(refusal.detail, /never-re-derive law/);
			}
		});

		test('a provenance failing the landed admitProvenance is the shape-law violation with the landed reason cited', () => {
			const kit = makeKit();
			const hidden = { ...landedProvenance(), actualModelId: FIXTURE_MODEL_REFUSED_MAIN };
			const hiddenRefusal = refusedOutcome(kit.projectProvenance(hidden));
			assert.equal(hiddenRefusal.reason, 'shape-law-violation');
			assert.match(hiddenRefusal.detail, /hidden-substitution/);
			const versioned = { ...landedProvenance(), contractVersion: '0.9.0' };
			const versionRefusal = refusedOutcome(kit.projectProvenance(versioned));
			assert.equal(versionRefusal.reason, 'shape-law-violation');
			assert.match(versionRefusal.detail, /version-mismatch/);
		});

		test('purity: the same candidate twice, the same verdict and view; the input never mutated', () => {
			const kit = makeKit();
			const landed = landedProvenance();
			const before = JSON.stringify(landed);
			const first = kit.projectProvenance(landed);
			const second = kit.projectProvenance(landed);
			assert.deepEqual(first, second);
			assert.equal(JSON.stringify(landed), before);
		});

		test('zero clock reads (the pure fold)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.projectProvenance(landedProvenance());
			kit.projectProvenance(null);
			assert.equal(clock.reads(), 1);
		});
	});

	suite('projectCapacity (the projection over the landed disclosure)', () => {
		test('the landed disclosure projects with every field verbatim and the nested provenance view', () => {
			const kit = makeKit();
			const disclosure = landedHealthyDisclosure();
			const view = projectedView(kit.projectCapacity(disclosure)).view;
			assert.equal(view.providerId, FIXTURE_PROVIDER_HEALTHY);
			assert.equal(view.health, 'healthy');
			assert.equal(view.verification, 'unverified');
			assert.equal(view.capacityState, 'available');
			assert.equal(view.cooldown, false);
			assert.equal(view.quotaRemaining, 1000);
			assert.deepEqual(view.resetExpectation, { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' });
			assert.equal(view.generatedAtEpochMs, FIXTURE_NOW_MS);
			assert.equal(view.provenance.scopeLabel, FIXTURE_MODEL_HEALTHY_MAIN);
		});

		test('the cooldown verdict rides the landed capacity state through the INCLUSIVE boundary (exactly at untilEpochMs)', () => {
			const kit = makeKit();
			const disclosure = landedBoundaryDisclosure(FIXTURE_NOW_MS);
			assert.equal(disclosure.capacityState, 'cooldown');
			const view = projectedView(kit.projectCapacity(disclosure)).view;
			assert.equal(view.capacityState, 'cooldown');
			assert.equal(view.cooldown, true);
		});

		test('the cooldown verdict flips one instant past the boundary (the landed fold, end-to-end)', () => {
			const kit = makeKit();
			const disclosure = landedBoundaryDisclosure(FIXTURE_NOW_MS - 1);
			assert.equal(disclosure.capacityState, 'available');
			const view = projectedView(kit.projectCapacity(disclosure)).view;
			assert.equal(view.capacityState, 'available');
			assert.equal(view.cooldown, false);
		});

		test('the unknown-quota disclosure projects the honest unknown quota verbatim', () => {
			const kit = makeKit();
			const disclosure = landedHealthyDisclosure();
			const unknownQuota = {
				...disclosure,
				capacityState: 'unknown' as const,
				quotaRemaining: 'unknown' as const,
			};
			const view = projectedView(kit.projectCapacity(unknownQuota)).view;
			assert.equal(view.capacityState, 'unknown');
			assert.equal(view.quotaRemaining, 'unknown');
		});

		test('a non-object is the typed not-an-object refusal', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectCapacity(null)).reason, 'not-an-object');
		});

		test('a caller-supplied label field on the disclosure is the typed rejection', () => {
			const kit = makeKit();
			const refusal = refusedOutcome(kit.projectCapacity({ ...landedHealthyDisclosure(), capacityLabel: 'green' }));
			assert.equal(refusal.reason, 'caller-supplied-label');
		});

		test('a caller-supplied label field on the nested provenance is the typed rejection', () => {
			const kit = makeKit();
			const disclosure = landedHealthyDisclosure();
			const refusal = refusedOutcome(
				kit.projectCapacity({ ...disclosure, provenance: { ...disclosure.provenance, substitutionLabel: 'none' } }),
			);
			assert.equal(refusal.reason, 'caller-supplied-label');
		});

		test('a disclosure failing the landed guard is the shape-law violation', () => {
			const kit = makeKit();
			const refusal = refusedOutcome(kit.projectCapacity({ ...landedHealthyDisclosure(), capacityState: 'plenty' }));
			assert.equal(refusal.reason, 'shape-law-violation');
			assert.match(refusal.detail, /isProviderCapacityDisclosure/);
		});

		test('zero clock reads (the pure fold)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.projectCapacity(landedHealthyDisclosure());
			kit.projectCapacity(null);
			assert.equal(clock.reads(), 1);
		});
	});

	suite('projectReset (the pure fold of schedule and injected now)', () => {
		test('a future fixed-instant reset projects the known expectation with the fixed-instant basis', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_RESET_AT_MS });
			assert.equal(view.resetClass, 'fixed-instant');
			assert.deepEqual(view.expectation, { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' });
			assert.equal(view.projectedAtEpochMs, FIXTURE_NOW_MS);
		});

		test('a probe exactly at the fixed instant names that instant (the inclusive boundary law)', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS });
			assert.deepEqual(view.expectation, { kind: 'known', nextResetEpochMs: FIXTURE_NOW_MS, basis: 'fixed-instant' });
		});

		test('a stale fixed-instant reset projects the honest unknown expectation - never a fabricated future', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS - 1 });
			assert.equal(view.resetClass, 'fixed-instant');
			assert.deepEqual(view.expectation, { kind: 'unknown' });
		});

		test('an interval-aligned reset mid-window projects the next boundary', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'interval-aligned', anchorEpochMs: FIXTURE_NOW_MS - 1000, intervalMs: 3_600_000 });
			assert.equal(view.resetClass, 'interval-aligned');
			assert.deepEqual(view.expectation, { kind: 'known', nextResetEpochMs: FIXTURE_NOW_MS + 3_599_000, basis: 'interval-aligned' });
		});

		test('a probe exactly on the interval boundary names that boundary (inclusive)', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'interval-aligned', anchorEpochMs: FIXTURE_NOW_MS, intervalMs: 3_600_000 });
			assert.deepEqual(view.expectation, { kind: 'known', nextResetEpochMs: FIXTURE_NOW_MS, basis: 'interval-aligned' });
		});

		test('a probe before the anchor names the anchor', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'interval-aligned', anchorEpochMs: FIXTURE_NOW_MS + 1000, intervalMs: 3_600_000 });
			assert.deepEqual(view.expectation, { kind: 'known', nextResetEpochMs: FIXTURE_NOW_MS + 1000, basis: 'interval-aligned' });
		});

		test('the provider-discretion and unknown schedules project the honest unknown expectation', () => {
			const kit = makeKit();
			for (const schedule of [{ kind: 'provider-discretion' }, { kind: 'unknown' }]) {
				const view = kit.projectReset(schedule);
				assert.equal(view.resetClass, schedule.kind);
				assert.deepEqual(view.expectation, { kind: 'unknown' });
			}
		});

		test('a malformed schedule (not an object) projects the honest unknown class and expectation', () => {
			const kit = makeKit();
			const view = kit.projectReset(null);
			assert.equal(view.resetClass, 'unknown');
			assert.deepEqual(view.expectation, { kind: 'unknown' });
		});

		test('a malformed schedule (a non-member kind) projects the honest unknown class', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'rolling' });
			assert.equal(view.resetClass, 'unknown');
			assert.deepEqual(view.expectation, { kind: 'unknown' });
		});

		test('a malformed fixed-instant payload projects the claimed class with the honest unknown expectation', () => {
			const kit = makeKit();
			const view = kit.projectReset({ kind: 'fixed-instant', atEpochMs: Number.NaN });
			assert.equal(view.resetClass, 'fixed-instant');
			assert.deepEqual(view.expectation, { kind: 'unknown' });
		});

		test('one clock read per projection (the counting clock)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.projectReset({ kind: 'unknown' });
			kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_RESET_AT_MS });
			assert.equal(clock.reads(), 3);
		});

		test('a non-finite clock read fails closed (TypeError)', () => {
			const kit = makeKit(LEDGER_TEST_ROOT, flakyClock());
			assert.throws(() => kit.projectReset({ kind: 'unknown' }), /^TypeError: projectReset: the injected clock/);
		});

		test('purity and double-run view equality', () => {
			const kit = makeKit();
			const schedule = { kind: 'fixed-instant', atEpochMs: FIXTURE_RESET_AT_MS };
			assert.deepEqual(kit.projectReset(schedule), kit.projectReset(schedule));
			const before = JSON.stringify(schedule);
			kit.projectReset(schedule);
			assert.equal(JSON.stringify(schedule), before);
		});
	});

	suite('projectDecision (the unified selected/refused fold)', () => {
		test('the landed routing decision projects the selected side with the disclosed capacity state and the provenance view', () => {
			const kit = makeKit();
			const decision = landedRoutingDecision();
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.family, 'routing');
			assert.equal(view.side, 'selected');
			assert.equal(view.adapterId, FIXTURE_VIEW_HEALTHY_ID);
			assert.equal(view.decidedAtEpochMs, FIXTURE_NOW_MS);
			assert.deepEqual(view.reasons, ['available']);
			assert.equal(selectedProvenance(view).scopeLabel, FIXTURE_MODEL_HEALTHY_MAIN);
			assert.equal(selectedProvenance(view).substitution, 'none');
		});

		test('the routing exhausted outcome projects the refused side with the ledger reasons verbatim in order', () => {
			const kit = makeKit();
			const view = projectedView(kit.projectDecision(fixtureExhaustedOutcome())).view;
			assert.equal(view.family, 'routing');
			assert.equal(view.side, 'refused');
			assert.equal(view.adapterId, 'none');
			assert.deepEqual(view.reasons, ['rate-limited', 'quota-exhausted']);
			assert.equal(view.provenance, 'none');
		});

		test('the routing exhausted outcome over zero admitted candidates projects the honest empty reasons (never a silent empty)', () => {
			const kit = makeKit();
			const view = projectedView(kit.projectDecision(landedEmptyExhaustedOutcome())).view;
			assert.equal(view.side, 'refused');
			assert.deepEqual(view.reasons, []);
			assert.equal(view.provenance, 'none');
		});

		test('the matched decision projects the selected side with the substitution label verbatim', () => {
			const kit = makeKit();
			const decision = landedMatchingDecision({ contextTokens: 1000 });
			assert.equal(decision.kind, 'matched');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.family, 'matching');
			assert.equal(view.side, 'selected');
			assert.equal(view.adapterId, FIXTURE_VIEW_HEALTHY_ID);
			assert.deepEqual(view.reasons, ['none']);
			assert.equal(selectedProvenance(view).scopeLabel, FIXTURE_MODEL_HEALTHY_MAIN);
		});

		test('the no-matching-candidate decision projects the refused side with the verdict rows verbatim in row order', () => {
			const kit = makeKit();
			const decision = landedMatchingDecision({ contextTokens: 100000 });
			assert.equal(decision.kind, 'no-matching-candidate');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.family, 'matching');
			assert.equal(view.side, 'refused');
			assert.equal(view.adapterId, 'none');
			assert.deepEqual(view.reasons, [
				'context-too-large',
				'modalities-covered',
				'output-cap-fits',
				'context-too-large',
				'modalities-covered',
				'output-cap-fits',
				'context-too-large',
				'modalities-covered',
				'output-cap-fits',
			]);
			assert.equal(view.provenance, 'none');
		});

		test('the decided eligibility decision projects the selected side with the verdict verbatim', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_HEALTHY_ID, 'product-inference');
			assert.equal(decision.kind, 'decided');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.family, 'isolation');
			assert.equal(view.side, 'selected');
			assert.equal(view.adapterId, FIXTURE_VIEW_HEALTHY_ID);
			assert.deepEqual(view.reasons, ['eligible']);
			assert.equal(selectedProvenance(view).scopeLabel, ISOLATION_ELIGIBILITY_PROBE_SCOPE);
		});

		test('the term-unknown verdict projects as the honest unknown (never fabricated eligible)', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_UNKNOWN_RESET_ID, 'product-inference');
			assert.equal(decision.kind, 'decided');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.side, 'selected');
			assert.deepEqual(view.reasons, ['term-unknown']);
		});

		test('the ineligible verdict projects as decided (the verdict verbatim, never a fabricated eligibility)', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_REFUSED_ID, 'product-inference');
			assert.equal(decision.kind, 'decided');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.side, 'selected');
			assert.deepEqual(view.reasons, ['ineligible']);
		});

		test('the no-eligible-binding refusal projects the why view with the landed detail verbatim', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision('fixture.scope.nowhere', 'product-inference');
			assert.equal(decision.kind, 'no-eligible-binding');
			const view = projectedView(kit.projectDecision(decision)).view;
			assert.equal(view.family, 'isolation');
			assert.equal(view.side, 'refused');
			assert.equal(view.adapterId, 'none');
			assert.deepEqual(view.reasons, [decision.detail]);
			assert.equal(view.provenance, 'none');
		});

		test('a non-object is the typed not-an-object refusal', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectDecision(null)).reason, 'not-an-object');
		});

		test('a record of no landed decision family is the typed unknown-decision-family rejection', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectDecision({})).reason, 'unknown-decision-family');
			assert.equal(refusedOutcome(kit.projectDecision({ kind: 'weird' })).reason, 'unknown-decision-family');
			assert.equal(refusedOutcome(kit.projectDecision({ adapterId: 'fixture.view.healthy' })).reason, 'unknown-decision-family');
		});

		test('a caller-supplied provenance on the routing exhausted outcome is the typed rejection', () => {
			const kit = makeKit();
			const refusal = refusedOutcome(kit.projectDecision({ ...fixtureExhaustedOutcome(), provenance: landedProvenance() }));
			assert.equal(refusal.reason, 'caller-supplied-label');
		});

		test('a caller-supplied substitution on the no-eligible-binding refusal is the typed rejection', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision('fixture.scope.nowhere', 'product-inference');
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, substitution: 'none' }));
			assert.equal(refusal.reason, 'caller-supplied-label');
		});

		test('a caller-supplied label on the routing decision shape is the typed rejection', () => {
			const kit = makeKit();
			const decision = landedRoutingDecision();
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, substitution: 'disclosed' }));
			assert.equal(refusal.reason, 'caller-supplied-label');
		});

		test('a routing decision failing the landed guard is the shape-law violation', () => {
			const kit = makeKit();
			const decision = landedRoutingDecision();
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, decidedAtEpochMs: FIXTURE_NOW_MS + 1 }));
			assert.equal(refusal.reason, 'shape-law-violation');
			assert.match(refusal.detail, /isRoutingDecision/);
		});

		test('an exhausted outcome failing the landed shape mirror is the shape-law violation', () => {
			const kit = makeKit();
			const badOutcome = {
				...fixtureExhaustedOutcome(),
				attemptLedger: [
					{ adapterId: FIXTURE_VIEW_HEALTHY_ID, atEpochMs: FIXTURE_NOW_MS, outcome: 'skipped', reason: 'none' },
				],
			};
			const refusal = refusedOutcome(kit.projectDecision(badOutcome));
			assert.equal(refusal.reason, 'shape-law-violation');
			const badStamp = { ...fixtureExhaustedOutcome(), contractVersion: '0.9.0' };
			assert.equal(refusedOutcome(kit.projectDecision(badStamp)).reason, 'shape-law-violation');
		});

		test('an eligibility decision violating the landed honest-unknown law is the shape-law violation', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_UNKNOWN_RESET_ID, 'product-inference');
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, termsState: 'unknown', verdict: 'eligible' }));
			assert.equal(refusal.reason, 'shape-law-violation');
		});

		test('a routing decision whose adapterId resolves nowhere is the unresolved-adapter-binding rejection', () => {
			const kit = makeKit();
			const decision = landedRoutingDecision();
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, adapterId: 'fixture.adapter.nowhere' }));
			assert.equal(refusal.reason, 'unresolved-adapter-binding');
			assert.match(refusal.detail, /never a silent dangling ref/);
		});

		test('an exhausted ledger entry whose adapterId resolves nowhere is the unresolved-adapter-binding rejection', () => {
			const kit = makeKit();
			const refusal = refusedOutcome(
				kit.projectDecision({
					...fixtureExhaustedOutcome(),
					attemptLedger: [
						{ adapterId: 'fixture.adapter.nowhere', atEpochMs: FIXTURE_NOW_MS, outcome: 'skipped-cooldown', reason: 'rate-limited' },
					],
				}),
			);
			assert.equal(refusal.reason, 'unresolved-adapter-binding');
		});

		test('a no-match verdict row whose adapterId resolves nowhere is the unresolved-adapter-binding rejection', () => {
			const kit = makeKit();
			const decision = landedMatchingDecision({ contextTokens: 100000 });
			const rows = (decision as { rows: Record<string, unknown>[] }).rows.map((row) => ({
				...row,
				adapterId: 'fixture.adapter.nowhere',
			}));
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, rows }));
			assert.equal(refusal.reason, 'unresolved-adapter-binding');
		});

		test('a decided eligibility record whose scopeId resolves nowhere is the unresolved-decision-record rejection', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_HEALTHY_ID, 'product-inference');
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, scopeId: 'fixture.scope.nowhere' }));
			assert.equal(refusal.reason, 'unresolved-decision-record');
			assert.match(refusal.detail, /never a silent dangling ref/);
		});

		test('a decided eligibility record whose scope binding is cross-inconsistent is the unresolved-decision-record rejection', () => {
			const kit = makeKit();
			const decision = landedEligibilityDecision(FIXTURE_SCOPE_HEALTHY_ID, 'product-inference');
			const refusal = refusedOutcome(kit.projectDecision({ ...decision, adapterId: FIXTURE_VIEW_REFUSED_ID }));
			assert.equal(refusal.reason, 'unresolved-decision-record');
			assert.match(refusal.detail, /cross-inconsistent/);
		});

		test('zero clock reads (the pure fold)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.projectDecision(landedRoutingDecision());
			kit.projectDecision(null);
			assert.equal(clock.reads(), 1);
		});
	});

	suite('readLedger (the canonical-bytes parse)', () => {
		test('a landed isolation ledger line parses to the ledger line view with the canonical bytes verbatim', () => {
			const path = writeLedgerFile('read-ledger', ledgerFixtureLines());
			const kit = makeKit();
			const view = projectedView(kit.readLedger(path, 1)).view;
			assert.equal(view.line, 1);
			assert.equal(view.family, 'isolation');
			assert.equal(view.canonicalBytes, ledgerFixtureLines()[0]);
			assert.equal(view.decision.family, 'isolation');
			assert.equal(view.decision.side, 'selected');
			assert.deepEqual(view.decision.reasons, ['eligible']);
		});

		test('a landed matching ledger line parses to the matching family view', () => {
			const path = writeLedgerFile('read-ledger-matching', ledgerFixtureLines());
			const kit = makeKit();
			const view = projectedView(kit.readLedger(path, 2)).view;
			assert.equal(view.family, 'matching');
			assert.equal(view.canonicalBytes, ledgerFixtureLines()[1]);
			assert.equal(view.decision.side, 'selected');
		});

		test('a landed routing decision line parses to the routing family view', () => {
			const path = writeLedgerFile('read-ledger-routing', ledgerFixtureLines());
			const kit = makeKit();
			const view = projectedView(kit.readLedger(path, 3)).view;
			assert.equal(view.family, 'routing');
			assert.equal(view.canonicalBytes, ledgerFixtureLines()[2]);
			assert.equal(view.decision.side, 'selected');
			assert.deepEqual(view.decision.reasons, ['available']);
		});

		test('a non-canonical line (shuffled keys) is the malformed-ledger-line rejection - the round-trip law', () => {
			const path = writeLedgerFile('read-ledger-noncanonical', ledgerFixtureLines());
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(path, 5));
			assert.equal(refusal.reason, 'malformed-ledger-line');
			assert.match(refusal.detail, /serializeEligibilityDecision/);
			assert.match(refusal.detail, /never re-derived/);
		});

		test('an unparseable line is the malformed-ledger-line rejection', () => {
			const path = writeLedgerFile('read-ledger-unparseable', ledgerFixtureLines());
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.readLedger(path, 4)).reason, 'malformed-ledger-line');
		});

		test('a line no landed guard admits is the malformed-ledger-line rejection', () => {
			const path = join(dedicatedLedgerRoot('read-ledger-noguard'), 'fixture-decisions.jsonl');
			writeFileSync(path, '{"kind":"weird","contractVersion":"1.0.0"}\n', 'utf8');
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(path, 1));
			assert.equal(refusal.reason, 'malformed-ledger-line');
			assert.match(refusal.detail, /no landed decision guard/);
		});

		test('an out-of-range line index is the unresolved-ledger-line rejection', () => {
			const path = writeLedgerFile('read-ledger-range', ledgerFixtureLines());
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(path, 8));
			assert.equal(refusal.reason, 'unresolved-ledger-line');
			assert.match(refusal.detail, /out of range/);
		});

		test('a missing ledger file is the unresolved-ledger-line rejection', () => {
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(join(LEDGER_TEST_ROOT, 'nowhere-ledger.jsonl'), 1));
			assert.equal(refusal.reason, 'unresolved-ledger-line');
			assert.match(refusal.detail, /resolves to no ledger file/);
		});

		test('a directory path is the unresolved-ledger-line rejection', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.readLedger(LEDGER_TEST_ROOT, 1)).reason, 'unresolved-ledger-line');
		});

		test('a malformed path/line input shape is the shape-law violation', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.readLedger('', 1)).reason, 'shape-law-violation');
			assert.equal(refusedOutcome(kit.readLedger(42, 1)).reason, 'shape-law-violation');
			assert.equal(refusedOutcome(kit.readLedger('x', 0)).reason, 'shape-law-violation');
			assert.equal(refusedOutcome(kit.readLedger('x', 1.5)).reason, 'shape-law-violation');
		});

		test('a ledger line whose decision binding dangles is the unresolved-decision-record rejection', () => {
			const path = writeLedgerFile('read-ledger-dangling-scope', ledgerFixtureLines());
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(path, 6));
			assert.equal(refusal.reason, 'unresolved-decision-record');
		});

		test('a ledger line whose adapter binding dangles is the unresolved-adapter-binding rejection', () => {
			const path = writeLedgerFile('read-ledger-dangling-adapter', ledgerFixtureLines());
			const kit = makeKit();
			const refusal = refusedOutcome(kit.readLedger(path, 7));
			assert.equal(refusal.reason, 'unresolved-adapter-binding');
		});

		test('zero clock reads (the pure read)', () => {
			const clock = countingClock();
			const path = writeLedgerFile('read-ledger-clock', ledgerFixtureLines());
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.readLedger(path, 1);
			kit.readLedger(path, 8);
			assert.equal(clock.reads(), 1);
		});
	});

	suite('projectLedger (the full stream projection)', () => {
		test('every line projects exactly once - the projected and the refused in call order', () => {
			const kit = makeKit();
			const outcomes = projectedView(kit.projectLedger(ledgerFixtureLines())).view;
			assert.equal(outcomes.length, 7);
			assert.deepEqual(
				outcomes.map((outcome) => outcome.line),
				[1, 2, 3, 4, 5, 6, 7],
			);
			assert.deepEqual(
				outcomes.map((outcome) => outcome.projected),
				[true, true, true, false, false, false, false],
			);
			assert.equal(outcomes[0].projected && outcomes[0].view.family, 'isolation');
			assert.equal(outcomes[1].projected && outcomes[1].view.family, 'matching');
			assert.equal(outcomes[2].projected && outcomes[2].view.family, 'routing');
			assert.equal(!outcomes[3].projected && outcomes[3].reason, 'malformed-ledger-line');
			assert.equal(!outcomes[4].projected && outcomes[4].reason, 'malformed-ledger-line');
			assert.equal(!outcomes[5].projected && outcomes[5].reason, 'unresolved-decision-record');
			assert.equal(!outcomes[6].projected && outcomes[6].reason, 'unresolved-adapter-binding');
		});

		test('an empty line in the stream is the malformed refusal outcome (never a silent drop)', () => {
			const kit = makeKit();
			const outcomes = projectedView(kit.projectLedger(['', ...ledgerFixtureLines()])).view;
			assert.equal(outcomes.length, 8);
			assert.equal(!outcomes[0].projected && outcomes[0].line, 1);
			assert.equal(!outcomes[0].projected && outcomes[0].reason, 'malformed-ledger-line');
			assert.equal(outcomes[1].projected && outcomes[1].line, 2);
		});

		test('a non-array stream is the shape-law violation', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectLedger('fixture')).reason, 'shape-law-violation');
			assert.equal(refusedOutcome(kit.projectLedger(null)).reason, 'shape-law-violation');
		});

		test('a non-string entry is the shape-law violation', () => {
			const kit = makeKit();
			assert.equal(refusedOutcome(kit.projectLedger([ledgerFixtureLines()[0], 42])).reason, 'shape-law-violation');
		});

		test('zero clock reads (the pure fold)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.projectLedger(ledgerFixtureLines());
			kit.projectLedger('fixture');
			assert.equal(clock.reads(), 1);
		});
	});

	suite('snapshot (the kit state fold)', () => {
		test('the initial fold: zero counters, the sorted bound ids, the injected fold time', () => {
			const kit = makeKit();
			const snapshot = kit.snapshot();
			assert.equal(snapshot.contractVersion, CONTRACT_INFERENCE_PRESENTATION_VERSION);
			assert.equal(snapshot.foldedAtEpochMs, FIXTURE_NOW_MS);
			assert.equal(snapshot.projectionsPerformed, 0);
			assert.equal(snapshot.refusalsEmitted, 0);
			assert.equal(snapshot.viewAuditsRecorded, 0);
			assert.deepEqual(snapshot.boundAdapterIds, [FIXTURE_VIEW_HEALTHY_ID, FIXTURE_VIEW_REFUSED_ID, FIXTURE_VIEW_UNKNOWN_RESET_ID]);
			assert.deepEqual(snapshot.boundScopeIds, [FIXTURE_SCOPE_HEALTHY_ID, FIXTURE_SCOPE_REFUSED_ID, FIXTURE_SCOPE_UNKNOWN_RESET_ID]);
		});

		test('the counters advance with projections and refusals', () => {
			const kit = makeKit();
			kit.projectProvenance(landedProvenance());
			let snapshot = kit.snapshot();
			assert.equal(snapshot.projectionsPerformed, 1);
			assert.equal(snapshot.refusalsEmitted, 0);
			kit.projectProvenance(null);
			kit.projectReset({ kind: 'unknown' });
			kit.projectDecision(landedRoutingDecision());
			kit.projectDecision(null);
			snapshot = kit.snapshot();
			assert.equal(snapshot.projectionsPerformed, 3);
			assert.equal(snapshot.refusalsEmitted, 2);
			assert.equal(snapshot.viewAuditsRecorded, 0);
		});

		test('the ledger folds advance the counters per line outcome', () => {
			const kit = makeKit();
			const path = writeLedgerFile('snapshot-ledger', ledgerFixtureLines());
			kit.readLedger(path, 1);
			kit.readLedger(path, 4);
			const stream = projectedView(kit.projectLedger(ledgerFixtureLines())).view;
			assert.equal(stream.length, 7);
			const snapshot = kit.snapshot();
			assert.equal(snapshot.projectionsPerformed, 1 + 3);
			assert.equal(snapshot.refusalsEmitted, 1 + 4);
		});

		test('the view audit counter advances with recordViewAudit', () => {
			const kit = makeKit();
			const view = projectedView(kit.projectProvenance(landedProvenance())).view;
			kit.recordViewAudit(view);
			kit.recordViewAudit(view);
			const snapshot = kit.snapshot();
			assert.equal(snapshot.viewAuditsRecorded, 2);
			assert.equal(snapshot.projectionsPerformed, 1);
		});

		test('one clock read per snapshot (the counting clock)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			kit.snapshot();
			kit.snapshot();
			assert.equal(clock.reads(), 3);
		});

		test('a non-finite clock read fails closed (TypeError)', () => {
			const kit = makeKit(LEDGER_TEST_ROOT, flakyClock());
			assert.throws(() => kit.snapshot(), /^TypeError: snapshot: the injected clock/);
		});
	});

	suite('recordViewAudit (the append-only view-audit ledger)', () => {
		test('the audit ledger appends canonical bytes per view, in call order', () => {
			const root = dedicatedLedgerRoot('audits');
			const kit = makeKit(root);
			const provenanceView = projectedView(kit.projectProvenance(landedProvenance())).view;
			const resetView = kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_RESET_AT_MS });
			kit.recordViewAudit(provenanceView);
			kit.recordViewAudit(resetView);
			const lines = readFileSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE), 'utf8')
				.split('\n')
				.filter((line) => line.length > 0);
			assert.equal(lines.length, 2);
			assert.equal(lines[0], serializePresentationRecord(provenanceView));
			assert.equal(lines[1], serializePresentationRecord(resetView));
		});

		test('every view kind is auditable', () => {
			const root = dedicatedLedgerRoot('audits-kinds');
			const kit = makeKit(root);
			const provenanceView = projectedView(kit.projectProvenance(landedProvenance())).view;
			const capacityView = projectedView(kit.projectCapacity(landedHealthyDisclosure())).view;
			const resetView = kit.projectReset({ kind: 'unknown' });
			const decisionView = projectedView(kit.projectDecision(landedRoutingDecision())).view;
			const path = writeLedgerFile('audits-kinds-ledger', ledgerFixtureLines());
			const lineView = projectedView(kit.readLedger(path, 1)).view;
			for (const view of [provenanceView, capacityView, resetView, decisionView, lineView]) {
				kit.recordViewAudit(view);
			}
			const lines = readFileSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE), 'utf8')
				.split('\n')
				.filter((line) => line.length > 0);
			assert.equal(lines.length, 5);
		});

		test('a non-view is refused fail-closed (TypeError) and appends nothing', () => {
			const root = dedicatedLedgerRoot('audits-refusal');
			const kit = makeKit(root);
			assert.throws(() => kit.recordViewAudit({ ...projectedView(kit.projectProvenance(landedProvenance())).view, scopeLabel: 're-derived' }), /^TypeError: serializePresentationRecord:/);
			assert.throws(() => kit.recordViewAudit('fixture'), /^TypeError: serializePresentationRecord:/);
			assert.equal(existsSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE)), false);
			assert.equal(kit.snapshot().viewAuditsRecorded, 0);
		});

		test('the audit file grows only - earlier lines never change (append-only)', () => {
			const root = dedicatedLedgerRoot('audits-append-only');
			const kit = makeKit(root);
			const view = projectedView(kit.projectProvenance(landedProvenance())).view;
			kit.recordViewAudit(view);
			const firstLine = readFileSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE), 'utf8');
			const secondView = projectedView(kit.projectProvenance(markProvenanceVerified(landedProvenance()))).view;
			kit.recordViewAudit(secondView);
			const secondRead = readFileSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE), 'utf8');
			assert.equal(secondRead.startsWith(firstLine), true);
			assert.equal(secondRead.split('\n').filter((line) => line.length > 0).length, 2);
		});

		test('the disclosed file name constant is presentation-audits.jsonl', () => {
			assert.equal(PRESENTATION_AUDITS_LEDGER_FILE, 'presentation-audits.jsonl');
		});
	});

	suite('the disclosed fixture ids (evidence label fixture)', () => {
		test('the three fixture view ids are the disclosed constants and bind as adapter bindings', () => {
			assert.equal(FIXTURE_VIEW_HEALTHY_ID, 'fixture.view.healthy');
			assert.equal(FIXTURE_VIEW_REFUSED_ID, 'fixture.view.refused');
			assert.equal(FIXTURE_VIEW_UNKNOWN_RESET_ID, 'fixture.view.unknown-reset');
			const snapshot = makeKit().snapshot();
			assert.deepEqual(snapshot.boundAdapterIds, [
				FIXTURE_VIEW_HEALTHY_ID,
				FIXTURE_VIEW_REFUSED_ID,
				FIXTURE_VIEW_UNKNOWN_RESET_ID,
			]);
		});

		test('the healthy fixture binds the available view, the refused fixture binds the refusal sides, the unknown-reset fixture binds the honest unknown reset', () => {
			const kit = makeKit();
			const healthy = projectedView(kit.projectCapacity(landedHealthyDisclosure())).view;
			assert.equal(healthy.capacityState, 'available');
			const refusal = landedEligibilityDecision('fixture.scope.nowhere', 'product-inference');
			assert.equal(projectedView(kit.projectDecision(refusal)).view.side, 'refused');
			const stale = kit.projectReset({ kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS - 1 });
			assert.deepEqual(stale.expectation, { kind: 'unknown' });
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in presentationKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/presentationKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in presentationContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/presentationContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
