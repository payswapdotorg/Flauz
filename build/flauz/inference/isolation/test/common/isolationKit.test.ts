/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-007 isolation kit test suite (mocha tdd style, matching
 * build/flauz/inference/matching/test/common/matchingKit.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, credential
 * handle, scope id, catalog id and probe value below is SYNTHETIC
 * (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the usage classes, the verdicts, the
 * rejection reasons, the resolution reasons, the version stamps) are
 * the contract's own values under test. The three disclosed fixture
 * scope ids (fixture.scope.permitted / fixture.scope.unknown-term /
 * fixture.scope.prohibited) are the kit module's own exported
 * constants, registered by this suite against its fixture bound
 * records. Runtime-boundary probes are injected as JSON-parsed
 * values. All timestamps ride the fixed injected clock; the suites
 * never read a clock. The ledger tests run at a caller-injected root
 * under os.tmpdir(), outside the repo tree, cleaned per suite run.
 */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_SCOPE_PERMITTED_ID,
	FIXTURE_SCOPE_PROHIBITED_ID,
	FIXTURE_SCOPE_UNKNOWN_TERM_ID,
	INFERENCE_ISOLATION_VERSION as KIT_RECARRIED_INFERENCE_ISOLATION_VERSION,
	ISOLATION_DECISIONS_LEDGER_FILE,
	ISOLATION_KIT_REJECTION_REASONS,
	createIsolationKit,
} from '../../common/isolationKit.js';
import type { IsolationKit } from '../../common/isolationKit.js';
import {
	INFERENCE_ISOLATION_VERSION as CONTRACT_INFERENCE_ISOLATION_VERSION,
	ISOLATION_ELIGIBILITY_PROBE_SCOPE,
	USAGE_CLASSES,
	isEligibilityDecisionRecord,
	serializeEligibilityDecision,
} from '../../common/isolationContract.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	markProvenanceVerified,
} from '../../../semantics/common/capacityDisclosure.js';
import { INFERENCE_CATALOG_VERSION, markEntryMetadataVerified, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.isolation';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.isolation';
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
const LEDGER_TEST_ROOT = join(tmpdir(), 'flauz-inference-isolation-battery');

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

/** The catalog whose alpha entry rode the landed one-way metadata promotion. */
function promotedCatalogRecord(): ProviderCatalogRecord {
	return {
		...fixtureCatalogRecord(),
		entries: fixtureCatalogRecord().entries.map((entry) =>
			entry.entryId === FIXTURE_PROVIDER_ALPHA ? markEntryMetadataVerified(entry) : entry,
		),
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

function fixedClock(): number {
	return FIXTURE_NOW_MS;
}

/** The counting clock: pins the kit's one-read-per-decision and zero-read folds. */
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
	catalog: unknown = fixtureCatalogRecord(),
): IsolationKit {
	return createIsolationKit({
		now,
		adapters: fixtureAdapterRecord(),
		catalog,
		ledgerRoot,
	});
}

function dedicatedLedgerRoot(name: string): string {
	const root = join(LEDGER_TEST_ROOT, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	return root;
}

function register(kit: IsolationKit, id: string, adapterId: string, handleRef: string): void {
	const admission = kit.register({ id, adapterId, handleRef });
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
}

function registerStandardScopes(kit: IsolationKit): void {
	register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
	register(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, FIXTURE_ADAPTER_BETA, FIXTURE_CREDENTIAL_BETA);
	register(kit, FIXTURE_SCOPE_PROHIBITED_ID, FIXTURE_ADAPTER_GAMMA, FIXTURE_CREDENTIAL_GAMMA);
}

function decidedOutcome(kit: IsolationKit, scopeId: string, usageClass: string): Extract<
	ReturnType<IsolationKit['checkEligibility']>,
	{ kind: 'decided' }
> {
	const outcome = kit.checkEligibility(scopeId, usageClass);
	assert.equal(outcome.kind, 'decided', `expected a decided record, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome;
}

function ledgerLines(root: string): string[] {
	return readFileSync(join(root, ISOLATION_DECISIONS_LEDGER_FILE), 'utf8')
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

suite('INF-007 isolation kit', () => {

	suiteSetup(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
		mkdirSync(LEDGER_TEST_ROOT, { recursive: true });
	});

	suiteTeardown(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
	});

	suite('version stamping across both module copies (the single declaration)', () => {
		test('the contract copy and the kit re-carried copy are both 1.0.0 and equal', () => {
			assert.equal(CONTRACT_INFERENCE_ISOLATION_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_ISOLATION_VERSION, '1.0.0');
			assert.equal(KIT_RECARRIED_INFERENCE_ISOLATION_VERSION, CONTRACT_INFERENCE_ISOLATION_VERSION);
		});

		test('the kit stamps its records with the re-carried copy (the provenance keeps the semantics stamp)', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.contractVersion, KIT_RECARRIED_INFERENCE_ISOLATION_VERSION);
			assert.equal(decision.contractVersion, CONTRACT_INFERENCE_ISOLATION_VERSION);
			assert.equal(decision.provenance.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
			const refusal = kit.checkEligibility('fixture.scope.nowhere', 'product-inference');
			assert.equal(refusal.kind, 'no-eligible-binding');
			if (refusal.kind === 'no-eligible-binding') {
				assert.equal(refusal.contractVersion, KIT_RECARRIED_INFERENCE_ISOLATION_VERSION);
			}
		});
	});

	suite('ISOLATION_KIT_REJECTION_REASONS (the frozen kit list)', () => {
		test('the contract reasons verbatim, in order, plus the kit-local duplicate', () => {
			assert.equal(ISOLATION_KIT_REJECTION_REASONS.length, 14);
			assert.equal(ISOLATION_KIT_REJECTION_REASONS[13], 'isolation-scope-duplicate');
			assert.deepEqual(ISOLATION_KIT_REJECTION_REASONS.slice(0, 13), [
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
			assert.equal(new Set(ISOLATION_KIT_REJECTION_REASONS).size, ISOLATION_KIT_REJECTION_REASONS.length);
		});
	});

	suite('createIsolationKit (the fail-closed factory)', () => {
		test('options.now must be a function', () => {
			assert.throws(
				() => createIsolationKit({ now: 42, adapters: {}, catalog: {}, ledgerRoot: 'x' } as unknown as Parameters<typeof createIsolationKit>[0]),
				/^TypeError: createIsolationKit: options\.now must be a function/,
			);
		});

		test('ledgerRoot must be a non-empty string', () => {
			assert.throws(
				() => makeKit(''),
				/^TypeError: createIsolationKit: options\.ledgerRoot must be a non-empty string/,
			);
		});

		test('the bound catalog is validated through the landed guard (duplicate entry ids cited)', () => {
			const catalog: ProviderCatalogRecord = {
				...fixtureCatalogRecord(),
				entries: [...fixtureCatalogRecord().entries, { ...fixtureCatalogRecord().entries[0] }],
			};
			assert.throws(() => makeKit(LEDGER_TEST_ROOT, fixedClock, catalog), /duplicate-entry-id/);
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
					createIsolationKit({
						now: fixedClock,
						adapters,
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
					createIsolationKit({
						now: fixedClock,
						adapters,
						catalog: fixtureCatalogRecord(),
						ledgerRoot: LEDGER_TEST_ROOT,
					}),
				/unknown-provider-entry.*dangling provider reference/,
			);
		});

		test('ledgerRoot must be an existing directory (never invented, never a file)', () => {
			const filePath = join(LEDGER_TEST_ROOT, 'not-a-directory');
			writeFileSync(filePath, 'fixture', 'utf8');
			assert.throws(() => makeKit(filePath), /must be an existing directory/);
		});

		test('the injected clock must produce a finite epoch-ms number (one validation read at creation)', () => {
			assert.throws(
				() => makeKit(LEDGER_TEST_ROOT, () => Number.NaN),
				/the injected clock must produce a finite epoch-ms number \(one validation read at creation\)/,
			);
		});

		test('a decision whose clock read is non-finite fails closed (one read per decision)', () => {
			const kit = makeKit(LEDGER_TEST_ROOT, flakyClock());
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			assert.throws(
				() => kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference'),
				/one read per decision/,
			);
		});
	});

	suite('register (the frozen admission walk)', () => {
		test('admits well-formed scopes and stores them verbatim', () => {
			const kit = makeKit();
			const admission = kit.register({
				id: FIXTURE_SCOPE_PERMITTED_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				handleRef: FIXTURE_CREDENTIAL_ALPHA,
			});
			assert.equal(admission.admitted, true);
			if (admission.admitted) {
				assert.deepEqual(admission.scope, {
					id: FIXTURE_SCOPE_PERMITTED_ID,
					adapterId: FIXTURE_ADAPTER_ALPHA,
					handleRef: FIXTURE_CREDENTIAL_ALPHA,
				});
			}
			assert.equal(kit.count(), 1);
		});

		test('a contract rejection surfaces verbatim through register', () => {
			const kit = makeKit();
			const admission = kit.register({ id: 's', adapterId: 'fixture.adapter.nowhere', handleRef: 'x' });
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-adapter-binding');
				assert.match(admission.detail, /dangling adapter reference/);
			}
		});

		test('a repeated scope id is the typed kit-level duplicate, never a silent overwrite', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const admission = kit.register({
				id: FIXTURE_SCOPE_PERMITTED_ID,
				adapterId: FIXTURE_ADAPTER_DELTA,
				handleRef: FIXTURE_CREDENTIAL_DELTA,
			});
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'isolation-scope-duplicate');
				assert.match(admission.detail, /never a silent overwrite/);
			}
			assert.equal(kit.count(), 1);
			const stored = kit.find(FIXTURE_SCOPE_PERMITTED_ID);
			assert.equal(stored?.adapterId, FIXTURE_ADAPTER_ALPHA, 'the first registration stands');
		});

		test('the contract guard runs first: a malformed duplicate reports the contract reason', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const admission = kit.register({
				id: FIXTURE_SCOPE_PERMITTED_ID,
				adapterId: 'fixture.adapter.nowhere',
				handleRef: 'x',
			});
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'unresolved-adapter-binding');
			}
		});

		test('a secret-shaped candidate is the typed no-secret rejection through register', () => {
			const kit = makeKit();
			const admission = kit.register({
				id: FIXTURE_SCOPE_PERMITTED_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				handleRef: FIXTURE_CREDENTIAL_ALPHA,
				apiKey: 'fixture.secret.material',
			});
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'secret-shaped-scope');
			}
			assert.equal(kit.count(), 0);
		});

		test('a caller-invented handle is the typed mismatch rejection through register', () => {
			const kit = makeKit();
			const admission = kit.register({
				id: FIXTURE_SCOPE_PERMITTED_ID,
				adapterId: FIXTURE_ADAPTER_ALPHA,
				handleRef: 'fixture.credential.invented',
			});
			assert.equal(admission.admitted, false);
			if (!admission.admitted) {
				assert.equal(admission.reason, 'credential-handle-mismatch');
				assert.match(admission.detail, /caller-invented handle reference is a typed rejection/);
			}
			assert.equal(kit.count(), 0);
		});

		test('the guard is pure: a rejected candidate is untouched', () => {
			const kit = makeKit();
			const candidate = { id: 's', adapterId: 'fixture.adapter.nowhere', handleRef: 'x' };
			const before = JSON.stringify(candidate);
			kit.register(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('list/find/count (the lookups)', () => {
		test('list is sorted by scope id, stable regardless of registration order', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_PROHIBITED_ID, FIXTURE_ADAPTER_GAMMA, FIXTURE_CREDENTIAL_GAMMA);
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			register(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, FIXTURE_ADAPTER_BETA, FIXTURE_CREDENTIAL_BETA);
			const ids = kit.list().map((scope) => scope.id);
			assert.deepEqual(ids, [
				FIXTURE_SCOPE_PERMITTED_ID,
				FIXTURE_SCOPE_PROHIBITED_ID,
				FIXTURE_SCOPE_UNKNOWN_TERM_ID,
			]);
			assert.equal(kit.count(), 3);
		});

		test('find resolves registered scopes and misses unknown ids', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const found = kit.find(FIXTURE_SCOPE_PERMITTED_ID);
			assert.equal(found?.handleRef, FIXTURE_CREDENTIAL_ALPHA);
			assert.equal(kit.find('fixture.scope.nowhere'), undefined);
		});

		test('count tracks the registered set (zero is honest)', () => {
			const kit = makeKit();
			assert.equal(kit.count(), 0);
			assert.equal(kit.list().length, 0);
		});
	});

	suite('resolveHandle (the typed resolution)', () => {
		test('resolves the scope -> the bound adapter record -> its own credentialHandle', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const resolution = kit.resolveHandle(FIXTURE_SCOPE_PERMITTED_ID);
			assert.equal(resolution.resolved, true);
			if (resolution.resolved) {
				assert.equal(resolution.scopeId, FIXTURE_SCOPE_PERMITTED_ID);
				assert.equal(resolution.adapterId, FIXTURE_ADAPTER_ALPHA);
				assert.equal(resolution.credentialHandle, FIXTURE_CREDENTIAL_ALPHA);
			}
		});

		test('the resolved handle EQUALS the bound adapter record\'s own handle (the handle-equality law end-to-end)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			for (const scope of kit.list()) {
				const resolution = kit.resolveHandle(scope.id);
				assert.equal(resolution.resolved, true);
				if (resolution.resolved) {
					assert.equal(resolution.credentialHandle, scope.handleRef);
				}
			}
		});

		test('an unknown scope is the typed unresolved verdict', () => {
			const kit = makeKit();
			const resolution = kit.resolveHandle('fixture.scope.nowhere');
			assert.equal(resolution.resolved, false);
			if (!resolution.resolved) {
				assert.equal(resolution.reason, 'unknown-scope');
				assert.match(resolution.detail, /no registered credential scope/);
			}
		});

		test('a non-string scope id is the typed unresolved verdict (never an exception)', () => {
			const kit = makeKit();
			for (const garbage of [undefined, null, 42, '', { id: 'x' }]) {
				const resolution = kit.resolveHandle(garbage);
				assert.equal(resolution.resolved, false);
				if (!resolution.resolved) {
					assert.equal(resolution.reason, 'unknown-scope');
				}
			}
		});

		test('every registered scope resolves (the fold)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			register(kit, FIXTURE_SCOPE_DELTA_ID, FIXTURE_ADAPTER_DELTA, FIXTURE_CREDENTIAL_DELTA);
			for (const scope of kit.list()) {
				const resolution = kit.resolveHandle(scope.id);
				assert.equal(resolution.resolved, true, `the scope ${scope.id} must resolve`);
			}
		});

		test('the resolved side carries the typed reference only (no secret material, own keys pinned)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const resolution = kit.resolveHandle(FIXTURE_SCOPE_PERMITTED_ID);
			assert.equal(resolution.resolved, true);
			const keys = Object.keys(resolution).sort();
			assert.deepEqual(keys, ['adapterId', 'credentialHandle', 'resolved', 'scopeId']);
		});

		test('the resolution reads no clock (a pure lookup)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			registerStandardScopes(kit);
			const readsAfterSetup = clock.reads();
			kit.resolveHandle(FIXTURE_SCOPE_PERMITTED_ID);
			kit.resolveHandle('fixture.scope.nowhere');
			assert.equal(clock.reads(), readsAfterSetup);
		});
	});

	suite('checkEligibility (the honest-unknown eligibility fold)', () => {
		test("the permitted fixture: verdict 'eligible', termsState 'permitted' verbatim", () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.termsState, 'permitted');
			assert.equal(decision.verdict, 'eligible');
		});

		test("the unknown-term fixture: verdict 'term-unknown', termsState 'unknown' verbatim", () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, 'routing-failover');
			assert.equal(decision.termsState, 'unknown');
			assert.equal(decision.verdict, 'term-unknown');
		});

		test("the prohibited fixture: verdict 'ineligible', termsState 'prohibited' verbatim", () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PROHIBITED_ID, 'sidecar-report');
			assert.equal(decision.termsState, 'prohibited');
			assert.equal(decision.verdict, 'ineligible');
		});

		test('all three verdicts for all four usage classes (the class is the disclosed context)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			for (const usageClass of USAGE_CLASSES) {
				assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, usageClass).verdict, 'eligible');
				assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, usageClass).verdict, 'term-unknown');
				assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_PROHIBITED_ID, usageClass).verdict, 'ineligible');
			}
		});

		test('the unknown term state is NEVER eligible for any usage class (the honest-unknown law end-to-end)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			for (const usageClass of USAGE_CLASSES) {
				const decision = decidedOutcome(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, usageClass);
				assert.notEqual(decision.verdict, 'eligible');
				assert.equal(decision.verdict, 'term-unknown');
				assert.equal(decision.termsState, 'unknown', 'the disclosure rides the record verbatim');
			}
		});

		test('the binding chain rides the decision (scopeId, adapterId, providerEntryId)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'matching-selection');
			assert.equal(decision.scopeId, FIXTURE_SCOPE_PERMITTED_ID);
			assert.equal(decision.adapterId, FIXTURE_ADAPTER_ALPHA);
			assert.equal(decision.providerEntryId, FIXTURE_PROVIDER_ALPHA);
		});

		test('the derived provenance: unverified by construction, one provider on both sides, the probe scope label', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.provenance.modelVerification, 'unverified');
			assert.equal(decision.provenance.requestedProviderId, FIXTURE_PROVIDER_ALPHA);
			assert.equal(decision.provenance.actualProviderId, FIXTURE_PROVIDER_ALPHA);
			assert.equal(decision.provenance.requestedModelId, ISOLATION_ELIGIBILITY_PROBE_SCOPE);
			assert.equal(decision.provenance.actualModelId, ISOLATION_ELIGIBILITY_PROBE_SCOPE);
			assert.equal(decision.provenance.substitution, 'none');
		});

		test('one decision, one time: decidedAtEpochMs equals the provenance recording instant', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.decidedAtEpochMs, decision.provenance.recordedAtEpochMs);
			assert.equal(decision.decidedAtEpochMs, FIXTURE_NOW_MS);
		});

		test('the metadataVerification rides the bound catalog entry verbatim (the unverified default)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.metadataVerification, 'unverified');
		});

		test('the delegated promotion: a kit over a markEntryMetadataVerified catalog emits verified (never re-stamped)', () => {
			const kit = makeKit(LEDGER_TEST_ROOT, fixedClock, promotedCatalogRecord());
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(decision.metadataVerification, 'verified');
			assert.equal(decision.termsState, 'permitted', 'verification never rewrites provider terms');
		});

		test("the delegated promotion: the caller's markProvenanceVerified on the returned decision still admits (never demoted)", () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const decision = decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			const promoted = { ...decision, provenance: markProvenanceVerified(decision.provenance) };
			assert.equal(promoted.provenance.modelVerification, 'verified');
			assert.equal(isEligibilityDecisionRecord(promoted), true);
			assert.ok(serializeEligibilityDecision(promoted).includes('"modelVerification":"verified"'));
			assert.equal(decision.provenance.modelVerification, 'unverified', 'the kit never re-stamps its own output');
		});

		test('an unknown usage class is the typed no-eligible-binding refusal', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const refusal = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'batch-training');
			assert.equal(refusal.kind, 'no-eligible-binding');
			if (refusal.kind === 'no-eligible-binding') {
				assert.match(refusal.detail, /not a member of the frozen USAGE_CLASSES vocabulary/);
			}
		});

		test('an unknown scope id is the typed no-eligible-binding refusal', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const refusal = kit.checkEligibility('fixture.scope.nowhere', 'product-inference');
			assert.equal(refusal.kind, 'no-eligible-binding');
			if (refusal.kind === 'no-eligible-binding') {
				assert.match(refusal.detail, /no registered credential scope/);
			}
		});

		test('the refusal is a record, never an exception, never a fabricated eligibility', () => {
			const kit = makeKit();
			const refusal = kit.checkEligibility(undefined, undefined);
			assert.equal(refusal.kind, 'no-eligible-binding');
			assert.equal(isEligibilityDecisionRecord(refusal), true);
			if (refusal.kind === 'no-eligible-binding') {
				assert.equal(typeof refusal.detail, 'string');
				assert.ok(refusal.detail.length > 0);
			}
		});

		test('double-run byte-stability at the same clock instant', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			const first = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			const second = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(serializeEligibilityDecision(first), serializeEligibilityDecision(second));
		});

		test('one clock read per decision (the counting clock)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			registerStandardScopes(kit);
			const readsAfterSetup = clock.reads();
			kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.equal(clock.reads(), readsAfterSetup + 1);
			kit.checkEligibility(FIXTURE_SCOPE_UNKNOWN_TERM_ID, 'product-inference');
			kit.checkEligibility('fixture.scope.nowhere', 'product-inference');
			assert.equal(clock.reads(), readsAfterSetup + 3);
		});
	});

	suite('eligibleScopes (the pure fold)', () => {
		test('lists the permitted scopes only, sorted ascending', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			register(kit, FIXTURE_SCOPE_DELTA_ID, FIXTURE_ADAPTER_DELTA, FIXTURE_CREDENTIAL_DELTA);
			const eligible = kit.eligibleScopes('product-inference');
			assert.deepEqual(eligible.map((scope) => scope.id), [
				FIXTURE_SCOPE_DELTA_ID,
				FIXTURE_SCOPE_PERMITTED_ID,
			]);
		});

		test('empty is honest: a kit whose scopes are all unknown/prohibited yields the empty list', () => {
			const kit = makeKit();
			register(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, FIXTURE_ADAPTER_BETA, FIXTURE_CREDENTIAL_BETA);
			register(kit, FIXTURE_SCOPE_PROHIBITED_ID, FIXTURE_ADAPTER_GAMMA, FIXTURE_CREDENTIAL_GAMMA);
			for (const usageClass of USAGE_CLASSES) {
				assert.deepEqual(kit.eligibleScopes(usageClass), []);
			}
		});

		test('an invalid usage class yields the honest empty (nothing can be eligible under a non-member class)', () => {
			const kit = makeKit();
			registerStandardScopes(kit);
			assert.deepEqual(kit.eligibleScopes('batch-training'), []);
			assert.deepEqual(kit.eligibleScopes(undefined), []);
		});

		test('the fold reads no clock (the pure fold)', () => {
			const clock = countingClock();
			const kit = makeKit(LEDGER_TEST_ROOT, clock.now);
			registerStandardScopes(kit);
			const readsAfterSetup = clock.reads();
			kit.eligibleScopes('product-inference');
			kit.eligibleScopes('routing-failover');
			kit.eligibleScopes('batch-training');
			assert.equal(clock.reads(), readsAfterSetup);
		});

		test('the fold lists every eligible scope across a mixed registered set', () => {
			const kit = makeKit();
			register(kit, 'fixture.scope.a-second-permitted', FIXTURE_ADAPTER_DELTA, FIXTURE_CREDENTIAL_DELTA);
			register(kit, FIXTURE_SCOPE_PERMITTED_ID, FIXTURE_ADAPTER_ALPHA, FIXTURE_CREDENTIAL_ALPHA);
			register(kit, FIXTURE_SCOPE_PROHIBITED_ID, FIXTURE_ADAPTER_GAMMA, FIXTURE_CREDENTIAL_GAMMA);
			const eligible = kit.eligibleScopes('matching-selection');
			assert.deepEqual(eligible.map((scope) => scope.id), [
				'fixture.scope.a-second-permitted',
				FIXTURE_SCOPE_PERMITTED_ID,
			]);
		});

		test('the fold appends nothing to the ledger', () => {
			const root = dedicatedLedgerRoot('eligible-fold');
			const kit = makeKit(root);
			registerStandardScopes(kit);
			kit.eligibleScopes('product-inference');
			assert.equal(existsSync(join(root, ISOLATION_DECISIONS_LEDGER_FILE)), false);
		});
	});

	suite('recordDecision (the append-only ledger)', () => {
		test('appends the canonical bytes, one decision per line, in call order', () => {
			const root = dedicatedLedgerRoot('ordering');
			const kit = makeKit(root);
			registerStandardScopes(kit);
			const first = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			const second = kit.checkEligibility(FIXTURE_SCOPE_UNKNOWN_TERM_ID, 'routing-failover');
			const refusal = kit.checkEligibility('fixture.scope.nowhere', 'sidecar-report');
			assert.equal(refusal.kind, 'no-eligible-binding');
			kit.recordDecision(first);
			kit.recordDecision(second);
			kit.recordDecision(refusal);
			const lines = ledgerLines(root);
			assert.equal(lines.length, 3);
			assert.equal(lines[0], serializeEligibilityDecision(first));
			assert.equal(lines[1], serializeEligibilityDecision(second));
			assert.equal(lines[2], serializeEligibilityDecision(refusal));
			const parsed = lines.map((line) => foreign(line) as { kind: string });
			assert.deepEqual(parsed.map((entry) => entry.kind), ['decided', 'decided', 'no-eligible-binding']);
		});

		test('the file grows only: earlier lines never change (append-only ordering)', () => {
			const root = dedicatedLedgerRoot('growth');
			const kit = makeKit(root);
			registerStandardScopes(kit);
			const first = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			kit.recordDecision(first);
			const afterFirst = ledgerLines(root);
			const second = kit.checkEligibility(FIXTURE_SCOPE_PROHIBITED_ID, 'product-inference');
			kit.recordDecision(second);
			const afterSecond = ledgerLines(root);
			assert.equal(afterSecond.length, 2);
			assert.equal(afterSecond[0], afterFirst[0]);
			assert.equal(afterFirst[0].includes('"kind":"decided"'), true);
		});

		test('recordDecision validates through the contract guard and appends foreign-shaped decisions', () => {
			const root = dedicatedLedgerRoot('external');
			const kit = makeKit(root);
			registerStandardScopes(kit);
			const decided = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			const external = foreign(JSON.stringify(decided));
			kit.recordDecision(external);
			const lines = ledgerLines(root);
			assert.equal(lines.length, 1);
			assert.equal(lines[0], serializeEligibilityDecision(external));
		});

		test('a malformed decision never gets ledger bytes (fail-closed TypeError)', () => {
			const root = dedicatedLedgerRoot('malformed');
			const kit = makeKit(root);
			registerStandardScopes(kit);
			assert.throws(() => kit.recordDecision(undefined), TypeError);
			assert.throws(() => kit.recordDecision({ kind: 'decided' }), TypeError);
			const decided = kit.checkEligibility(FIXTURE_SCOPE_PERMITTED_ID, 'product-inference');
			assert.throws(
				() => kit.recordDecision({ ...decided, verdict: 'auto-eligible' }),
				TypeError,
			);
			assert.equal(
				existsSync(join(root, ISOLATION_DECISIONS_LEDGER_FILE)),
				false,
				'the malformed attempts appended nothing',
			);
			assert.ok(decided);
		});

		test('the ledger file name is the disclosed constant', () => {
			assert.equal(ISOLATION_DECISIONS_LEDGER_FILE, 'isolation-decisions.jsonl');
		});
	});

	suite('the disclosed fixture ids', () => {
		test('the three disclosed fixture scope ids are the exported constants and demonstrate their names', () => {
			assert.equal(FIXTURE_SCOPE_PERMITTED_ID, 'fixture.scope.permitted');
			assert.equal(FIXTURE_SCOPE_UNKNOWN_TERM_ID, 'fixture.scope.unknown-term');
			assert.equal(FIXTURE_SCOPE_PROHIBITED_ID, 'fixture.scope.prohibited');
			const kit = makeKit();
			registerStandardScopes(kit);
			assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_PERMITTED_ID, 'product-inference').verdict, 'eligible');
			assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_UNKNOWN_TERM_ID, 'product-inference').verdict, 'term-unknown');
			assert.equal(decidedOutcome(kit, FIXTURE_SCOPE_PROHIBITED_ID, 'product-inference').verdict, 'ineligible');
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in isolationKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/isolationKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in isolationContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/isolationContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
