/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 acceptance kit test suite (mocha tdd style, matching
 * build/flauz/inference/presentation/test/common/presentationKit.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle, scope id, catalog id and probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value and
 * NOT credential material (the typed handle reference is the landed
 * triple shape only). Closed-vocabulary members (the evidence
 * labels, the drill classes, the rejection reasons, the verdicts,
 * the version stamps) are the contract's own values under test. The
 * three disclosed fixture adapter ids (fixture.acceptance.healthy /
 * fixture.acceptance.refused / fixture.acceptance.unknown) are the
 * kit module's own exported constants, bound by this suite in its
 * fixture bound records. Every drill's payload is produced
 * END-TO-END through the LANDED folds (the adapter report fold, the
 * capacity disclosure fold, the landed isolation and presentation
 * kits over the same fixture records - the real-landed-record
 * evidence chain); the byte-citation tests reproduce the landed
 * serializers' own bytes over the same inputs. The LIVE-configured
 * drills ride a test-double fetchLike standing in for the wire:
 * what is pinned is the DERIVATION switch (the evidence label
 * follows the port class) and the read-boundary no-live-port law -
 * the real 'live-real' claim belongs to the canary's real exchange
 * over the env-activated live port, never this battery. All
 * timestamps ride the fixed injected clock; the suites never read a
 * clock. The ledger and audit tests run at caller-injected roots
 * under os.tmpdir(), outside the repo tree, cleaned per suite run
 * (local-real filesystem evidence; the record values themselves stay
 * synthetic fixtures).
 */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ACCEPTANCE_DRILLS_LEDGER_FILE,
	ACCEPTANCE_FAILURE_PROBE_SCOPE,
	FIXTURE_ACCEPTANCE_HEALTHY_ID,
	FIXTURE_ACCEPTANCE_REFUSED_ID,
	FIXTURE_ACCEPTANCE_UNKNOWN_ID,
	INFERENCE_ACCEPTANCE_VERSION as KIT_RECARRIED_INFERENCE_ACCEPTANCE_VERSION,
	createAcceptanceKit,
} from '../../common/acceptanceKit.js';
import type { AcceptanceKit } from '../../common/acceptanceKit.js';
import {
	ACCEPTANCE_REJECTION_REASONS,
	INFERENCE_ACCEPTANCE_VERSION as CONTRACT_INFERENCE_ACCEPTANCE_VERSION,
	isDrillRecord,
	isFailureEvidence,
	serializeAcceptanceRecord,
} from '../../common/acceptanceContract.js';
import type {
	AcceptanceDrillOutcome,
	AcceptanceDrillRefused,
	AcceptanceLedgerLine,
	AcceptanceLedgerLineOutcome,
} from '../../common/acceptanceContract.js';
import {
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	projectCapacityDisclosure,
	unverifiedProvenance,
} from '../../../semantics/common/capacityDisclosure.js';
import type { ProviderCapacityDisclosure } from '../../../semantics/common/capacityDisclosure.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import {
	INFERENCE_ADAPTER_VERSION,
	reportAdapterSnapshot,
	serializeAdapterReport,
} from '../../../adapters/common/providerAdapter.js';
import type { AdapterObservation, ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';
import {
	ISOLATION_ELIGIBILITY_PROBE_SCOPE,
	serializeEligibilityDecision,
} from '../../../isolation/common/isolationContract.js';
import { ISOLATION_DECISIONS_LEDGER_FILE, createIsolationKit } from '../../../isolation/common/isolationKit.js';
import type { EligibilityDecisionRecord } from '../../../isolation/common/isolationContract.js';
import { serializeCapacityDisclosure } from '../../../semantics/common/capacityDisclosure.js';
import { serializeCredentialScope } from '../../../isolation/common/isolationContract.js';
import { serializePresentationRecord } from '../../../presentation/common/presentationContract.js';
import { PRESENTATION_AUDITS_LEDGER_FILE } from '../../../presentation/common/presentationKit.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.acceptance';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.acceptance';
const FIXTURE_SCOPE_SET_ID = 'fixture.scope-set.acceptance';
const FIXTURE_PROVIDER_HEALTHY = 'fixture.provider.healthy';
const FIXTURE_PROVIDER_REFUSED = 'fixture.provider.refused';
const FIXTURE_PROVIDER_UNKNOWN = 'fixture.provider.unknown-terms';
const FIXTURE_CREDENTIAL_HEALTHY = 'fixture.credential.handle.healthy';
const FIXTURE_CREDENTIAL_REFUSED = 'fixture.credential.handle.refused';
const FIXTURE_CREDENTIAL_UNKNOWN = 'fixture.credential.handle.unknown-terms';
const FIXTURE_MODEL_HEALTHY_MAIN = 'fixture.model.healthy-main';
const FIXTURE_SCOPE_HEALTHY_ID = 'fixture.scope.acceptance-healthy';
const FIXTURE_SCOPE_REFUSED_ID = 'fixture.scope.acceptance-refused';
const FIXTURE_SCOPE_UNKNOWN_ID = 'fixture.scope.acceptance-unknown';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_RESET_AT_MS = 1_700_003_600_000;
const FIXTURE_REFUSAL_REASON = 'rate limited by the fixture port';
const FIXTURE_LIVE_ENDPOINT = 'https://fixture.invalid/live-probe';
const LEDGER_TEST_ROOT = join(tmpdir(), 'flauz-inference-acceptance-battery');
const INFERENCE_ISOLATION_STAMP = '1.0.0';

/** Every frozen rejection reason observed firing across this battery. */
const firedReasons = new Set<string>();

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
			unknownCapacityEntry(FIXTURE_PROVIDER_UNKNOWN, 'third-party-free-tier', FIXTURE_NOW_MS),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureAdapterRecord(): ProviderAdapterRecord {
	return {
		adapterSetId: FIXTURE_ADAPTER_SET_ID,
		adapters: [
			{
				adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
				displayName: 'Fixture Acceptance Adapter Healthy',
				providerEntryId: FIXTURE_PROVIDER_HEALTHY,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_HEALTHY,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID,
				displayName: 'Fixture Acceptance Adapter Refused',
				providerEntryId: FIXTURE_PROVIDER_REFUSED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'user-owned-endpoint',
				credentialHandle: FIXTURE_CREDENTIAL_REFUSED,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID,
				displayName: 'Fixture Acceptance Adapter Unknown Terms',
				providerEntryId: FIXTURE_PROVIDER_UNKNOWN,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_UNKNOWN,
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
			{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
			{ id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
			{ id: FIXTURE_SCOPE_UNKNOWN_ID, adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN },
		],
		contractVersion: INFERENCE_ISOLATION_STAMP,
	};
}

/** A scope-set whose shared scope id binds the REFUSED adapter (the cross-inconsistency fixture). */
function crossBoundScopeSetRecord(): Record<string, unknown> {
	return {
		scopeSetId: 'fixture.scope-set.cross-bound',
		scopes: [
			{ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
			{ id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
			{ id: FIXTURE_SCOPE_UNKNOWN_ID, adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN },
		],
		contractVersion: INFERENCE_ISOLATION_STAMP,
	};
}

function fixedClock(): number {
	return FIXTURE_NOW_MS;
}

/** The counting clock: pins the kit's read discipline. */
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

/** The flaky clock: finite for the first N reads (the creation validation reads), non-finite after. */
function flakyClock(finiteReads: number): () => number {
	let calls = 0;
	return () => {
		calls += 1;
		return calls <= finiteReads ? FIXTURE_NOW_MS : Number.NaN;
	};
}

function healthyCredentialPort(): Record<string, unknown> {
	return {
		kind: 'handle',
		scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
		resolve: async () => ({
			resolved: true,
			scopeId: FIXTURE_SCOPE_HEALTHY_ID,
			adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
			credentialHandle: FIXTURE_CREDENTIAL_HEALTHY,
		}),
	};
}

function refusedCredentialPort(): Record<string, unknown> {
	return {
		kind: 'handle',
		scope: { id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED },
		resolve: async () => ({
			resolved: true,
			scopeId: FIXTURE_SCOPE_REFUSED_ID,
			adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID,
			credentialHandle: FIXTURE_CREDENTIAL_REFUSED,
		}),
	};
}

function unknownTermCredentialPort(): Record<string, unknown> {
	return {
		kind: 'handle',
		scope: { id: FIXTURE_SCOPE_UNKNOWN_ID, adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN },
		resolve: async () => ({
			resolved: true,
			scopeId: FIXTURE_SCOPE_UNKNOWN_ID,
			adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID,
			credentialHandle: FIXTURE_CREDENTIAL_UNKNOWN,
		}),
	};
}

/** A caller-invented handle reference: the secret-shape law fires at the fold. */
function inventedHandleCredentialPort(): Record<string, unknown> {
	return {
		kind: 'handle',
		scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
		resolve: async () => ({
			resolved: true,
			scopeId: FIXTURE_SCOPE_HEALTHY_ID,
			adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
			credentialHandle: 'fixture.credential.caller-invented',
		}),
	};
}

function healthyObservation(): AdapterObservation {
	return {
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
	};
}

function exhaustedObservation(): AdapterObservation {
	return {
		...healthyObservation(),
		quota: {
			state: 'known',
			remaining: 0,
			limit: 1000,
			window: { kind: 'fixed', windowStartEpochMs: FIXTURE_NOW_MS - 1000, windowLengthMs: 3_600_000 },
		},
	};
}

function cooldownObservation(): AdapterObservation {
	return {
		...healthyObservation(),
		cooldown: {
			state: 'active',
			reason: 'rate-limited',
			sinceEpochMs: FIXTURE_NOW_MS - 1000,
			untilEpochMs: FIXTURE_NOW_MS + 60_000,
		},
	};
}

/** The stale fixed-instant reset: atEpochMs in the past (the honest 'unknown' expectation). */
function staleResetObservation(): AdapterObservation {
	return {
		...healthyObservation(),
		reset: { kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS - 3_600_000 },
	};
}

function unknownCapacityObservation(): AdapterObservation {
	return {
		...healthyObservation(),
		health: 'unknown',
	};
}

function fixturePort(observation: AdapterObservation): Record<string, unknown> {
	return {
		kind: 'fixture',
		respond: () => ({ completed: true, observation }),
	};
}

function refusingFixturePort(refusalReason: string = FIXTURE_REFUSAL_REASON): Record<string, unknown> {
	return {
		kind: 'fixture',
		respond: () => ({ completed: false, refusalReason }),
	};
}

/** The counting fixture port: pins the never-retried law (one call per drill, never more). */
function countingFixturePort(observation: AdapterObservation): { port: Record<string, unknown>; calls: () => number } {
	let calls = 0;
	return {
		port: {
			kind: 'fixture',
			respond: () => {
				calls += 1;
				return { completed: true, observation };
			},
		},
		calls: () => calls,
	};
}

function countingRefusingFixturePort(refusalReason: string = FIXTURE_REFUSAL_REASON): { port: Record<string, unknown>; calls: () => number } {
	let calls = 0;
	return {
		port: {
			kind: 'fixture',
			respond: () => {
				calls += 1;
				return { completed: false, refusalReason };
			},
		},
		calls: () => calls,
	};
}

/**
 * The live-configured network port with a TEST-DOUBLE fetchLike
 * standing in for the wire (the derivation-switch fixture: the label
 * follows the port class; the real live-real claim belongs to the
 * canary's real exchange, never this battery).
 */
function liveDoublePort(observation: AdapterObservation): Record<string, unknown> {
	return {
		kind: 'live',
		endpoint: FIXTURE_LIVE_ENDPOINT,
		fetchLike: async () => ({ completed: true, observation }),
	};
}

function liveRefusingDoublePort(refusalReason: string = FIXTURE_REFUSAL_REASON): Record<string, unknown> {
	return {
		kind: 'live',
		endpoint: FIXTURE_LIVE_ENDPOINT,
		fetchLike: async () => ({ completed: false, refusalReason }),
	};
}

function makeKit(
	ledgerRoot: string = LEDGER_TEST_ROOT,
	networkPort: unknown = fixturePort(healthyObservation()),
	credentialPort: unknown = healthyCredentialPort(),
	scopes: unknown = fixtureScopeSetRecord(),
	now: () => number = fixedClock,
): AcceptanceKit {
	return createAcceptanceKit({
		now,
		catalog: fixtureCatalogRecord(),
		adapters: fixtureAdapterRecord(),
		scopes,
		networkPort,
		credentialPort,
		ledgerRoot,
	});
}

function dedicatedLedgerRoot(name: string): string {
	const root = join(LEDGER_TEST_ROOT, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	return root;
}

function drillLedgerPath(root: string): string {
	return join(root, ACCEPTANCE_DRILLS_LEDGER_FILE);
}

function readLedgerLines(path: string): string[] {
	return readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0);
}

/** The landed healthy report + disclosure the kit's drill rides, reproduced through the landed folds. */
function landedHealthyReportAndDisclosure(modelId: string): { reportBytes: string; disclosureBytes: string } {
	const adapter = fixtureAdapterRecord().adapters[0];
	const provenance = unverifiedProvenance({
		requestedProviderId: adapter.providerEntryId,
		requestedModelId: modelId,
		actualProviderId: adapter.providerEntryId,
		actualModelId: modelId,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	});
	const report = reportAdapterSnapshot(adapter, healthyObservation(), provenance);
	const disclosureOutcome = projectCapacityDisclosure(report.snapshot, report.provenance, FIXTURE_NOW_MS);
	assert.equal(disclosureOutcome.disclosed, true, 'the fixture disclosure must project');
	const disclosure = (disclosureOutcome as { disclosed: true; disclosure: ProviderCapacityDisclosure }).disclosure;
	return {
		reportBytes: serializeAdapterReport(report),
		disclosureBytes: serializeCapacityDisclosure(disclosure),
	};
}

/** The landed eligibility decision the kit's drill rides, reproduced end-to-end through the landed isolation kit. */
function landedEligibilityDecision(scopeId: string, usageClass: string): EligibilityDecisionRecord {
	const isolationKit = createIsolationKit({
		now: fixedClock,
		adapters: fixtureAdapterRecord(),
		catalog: fixtureCatalogRecord(),
		ledgerRoot: dedicatedLedgerRoot('landed-isolation'),
	});
	const admission = isolationKit.register(
		scopeId === FIXTURE_SCOPE_HEALTHY_ID
			? { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY }
			: scopeId === FIXTURE_SCOPE_REFUSED_ID
				? { id: FIXTURE_SCOPE_REFUSED_ID, adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID, handleRef: FIXTURE_CREDENTIAL_REFUSED }
				: { id: FIXTURE_SCOPE_UNKNOWN_ID, adapterId: FIXTURE_ACCEPTANCE_UNKNOWN_ID, handleRef: FIXTURE_CREDENTIAL_UNKNOWN },
	);
	assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
	return isolationKit.checkEligibility(scopeId, usageClass);
}

/** The drilled side of an outcome (asserts, then narrows). */
function drilledOutcome(outcome: AcceptanceDrillOutcome): { drilled: true; evidence: { kind: string } } {
	assert.equal(outcome.drilled, true, `expected a drilled outcome, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome as unknown as { drilled: true; evidence: { kind: string } };
}

/** The refused side of an outcome (asserts, narrows, and records the fired reason). */
function refusedOutcome(outcome: AcceptanceDrillOutcome): AcceptanceDrillRefused {
	assert.equal(outcome.drilled, false, `expected a typed refusal, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	const refused = outcome as AcceptanceDrillRefused;
	firedReasons.add(refused.reason);
	return refused;
}

function projectedLedgerLine(outcome: { projected: boolean; reason?: string; detail?: string; view?: AcceptanceLedgerLine }): AcceptanceLedgerLine {
	assert.equal(outcome.projected, true, `expected a projected ledger line, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	return outcome.view as AcceptanceLedgerLine;
}

function refusedLedgerRead(outcome: { projected: boolean; reason?: string; detail?: string }): { reason: string; detail: string } {
	assert.equal(outcome.projected, false, `expected a typed ledger refusal, got: ${JSON.stringify(outcome).slice(0, 400)}`);
	const refused = outcome as { projected: false; reason: string; detail: string };
	firedReasons.add(refused.reason);
	return refused;
}

/** Writes a line fixture to a dedicated ledger file and returns its path. */
function writeLedgerFixture(name: string, lines: readonly string[]): string {
	const root = dedicatedLedgerRoot(name);
	const path = join(root, 'fixture-drills.jsonl');
	writeFileSync(path, lines.join('\n') + '\n', 'utf8');
	return path;
}

/** Deep key shuffle for the non-canonical byte form fixture. */
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

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-009 acceptance kit', () => {

	suiteSetup(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
		mkdirSync(LEDGER_TEST_ROOT, { recursive: true });
	});

	suiteTeardown(() => {
		rmSync(LEDGER_TEST_ROOT, { recursive: true, force: true });
	});

	suite('createAcceptanceKit (the fail-closed factory)', () => {
		test('rejects a non-function clock', () => {
			assert.throws(() => createAcceptanceKit({
				now: 42 as unknown as () => number,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: dedicatedLedgerRoot('factory-1'),
			}), TypeError);
		});

		test('rejects an empty ledger root', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: '',
			}), TypeError);
		});

		test('rejects an unadmitted catalog', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: { catalogId: FIXTURE_CATALOG_ID },
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: dedicatedLedgerRoot('factory-2'),
			}), TypeError);
		});

		test('rejects an unadmitted adapter record', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: { adapterSetId: FIXTURE_ADAPTER_SET_ID },
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: dedicatedLedgerRoot('factory-3'),
			}), TypeError);
		});

		test('rejects an unadmitted scope set', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: { scopeSetId: FIXTURE_SCOPE_SET_ID },
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: dedicatedLedgerRoot('factory-4'),
			}), TypeError);
		});

		test('rejects a missing network port', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: undefined,
				ledgerRoot: dedicatedLedgerRoot('factory-5'),
			}), TypeError);
		});

		test('rejects a non-object network port', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: 'https://fixture.invalid/global-fetch',
				ledgerRoot: dedicatedLedgerRoot('factory-6'),
			}), TypeError);
		});

		test('rejects a wrong-kind network port (the frozen port vocabulary)', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'global-fetch' },
				ledgerRoot: dedicatedLedgerRoot('factory-7'),
			}), TypeError);
		});

		test('rejects a fixture port without a respond fold', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'fixture' },
				ledgerRoot: dedicatedLedgerRoot('factory-8'),
			}), TypeError);
		});

		test('rejects a fixture port with extra fields', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'fixture', respond: () => ({ completed: true, observation: healthyObservation() }), endpoint: FIXTURE_LIVE_ENDPOINT },
				ledgerRoot: dedicatedLedgerRoot('factory-9'),
			}), TypeError);
		});

		test('rejects a live port without an endpoint', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'live', fetchLike: async () => ({ completed: true, observation: healthyObservation() }) },
				ledgerRoot: dedicatedLedgerRoot('factory-10'),
			}), TypeError);
		});

		test('rejects a live port without a fetchLike fold', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'live', endpoint: FIXTURE_LIVE_ENDPOINT },
				ledgerRoot: dedicatedLedgerRoot('factory-11'),
			}), TypeError);
		});

		test('rejects a live port with extra fields', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: { kind: 'live', endpoint: FIXTURE_LIVE_ENDPOINT, fetchLike: async () => ({ completed: true, observation: healthyObservation() }), respond: () => ({ completed: true, observation: healthyObservation() }) },
				ledgerRoot: dedicatedLedgerRoot('factory-12'),
			}), TypeError);
		});

		test('rejects a secret-shaped credential port (wrong kind)', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				credentialPort: { kind: 'raw-key', apiKey: 'fixture.secret-shaped-value' },
				ledgerRoot: dedicatedLedgerRoot('factory-13'),
			}), TypeError);
		});

		test('rejects a credential port with extra fields', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				credentialPort: { ...healthyCredentialPort(), apiKey: 'fixture.secret-shaped-value' },
				ledgerRoot: dedicatedLedgerRoot('factory-14'),
			}), TypeError);
		});

		test('rejects a credential port whose scope fails the landed admitCredentialScope (the handle-equality law)', () => {
			assert.throws(() => createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				credentialPort: {
					kind: 'handle',
					scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: 'fixture.credential.caller-invented' },
					resolve: async () => ({ resolved: true, scopeId: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, credentialHandle: FIXTURE_CREDENTIAL_HEALTHY }),
				},
				ledgerRoot: dedicatedLedgerRoot('factory-15'),
			}), TypeError);
		});

		test('rejects a non-directory ledger root', () => {
			const root = join(LEDGER_TEST_ROOT, 'factory-not-a-directory');
			rmSync(root, { recursive: true, force: true });
			writeFileSync(root, 'not a directory', 'utf8');
			assert.throws(() => makeKit(root), TypeError);
		});

		test('rejects a non-finite clock (fails at the creation validation read)', () => {
			assert.throws(() => makeKit(dedicatedLedgerRoot('factory-16'), undefined, undefined, undefined, () => Number.NaN), TypeError);
		});
		test('the kit starts at zero drills, refusals and ledger reads', () => {
			const kit = makeKit(dedicatedLedgerRoot('factory-zero'));
			const snapshot = kit.snapshot();
			assert.equal(snapshot.acceptanceDrillsPerformed, 0);
			assert.equal(snapshot.failureDrillsPerformed, 0);
			assert.equal(snapshot.refusalsEmitted, 0);
			assert.equal(snapshot.ledgerLinesProjected, 0);
		});

		test('the kit re-carried stamp equals the contract declaration (the single version declaration law)', () => {
			assert.equal(KIT_RECARRIED_INFERENCE_ACCEPTANCE_VERSION, CONTRACT_INFERENCE_ACCEPTANCE_VERSION);
			assert.equal(KIT_RECARRIED_INFERENCE_ACCEPTANCE_VERSION, '1.0.0');
		});

		test('the bound surfaces are disclosed sorted ascending', () => {
			const snapshot = makeKit(dedicatedLedgerRoot('factory-bound')).snapshot();
			assert.deepEqual([...snapshot.boundAdapterIds], [FIXTURE_ACCEPTANCE_HEALTHY_ID, FIXTURE_ACCEPTANCE_REFUSED_ID, FIXTURE_ACCEPTANCE_UNKNOWN_ID]);
			assert.deepEqual([...snapshot.boundScopeIds], [FIXTURE_SCOPE_HEALTHY_ID, FIXTURE_SCOPE_REFUSED_ID, FIXTURE_SCOPE_UNKNOWN_ID]);
		});

		test('the network port kind is disclosed (the evidence-label source)', () => {
			assert.equal(makeKit(dedicatedLedgerRoot('factory-kind-fixture')).snapshot().networkPortKind, 'fixture');
			assert.equal(makeKit(dedicatedLedgerRoot('factory-kind-live'), liveDoublePort(healthyObservation())).snapshot().networkPortKind, 'live');
		});
	});

	suite('runAcceptanceDrill (the acceptance fold)', () => {
		test('the happy path drills: label fixture, class acceptance-exchange, verdict eligible', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-happy'));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-1', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const drilled = drilledOutcome(outcome);
			assert.equal(drilled.evidence.kind, 'drill');
			const record = outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord };
			assert.equal(record.evidence.evidenceLabel, 'fixture');
			assert.equal(record.evidence.drillClass, 'acceptance-exchange');
			assert.equal(record.evidence.drillId, 'fixture.drill.healthy-1');
			assert.equal(record.evidence.adapterId, FIXTURE_ACCEPTANCE_HEALTHY_ID);
			assert.equal(record.evidence.providerEntryId, FIXTURE_PROVIDER_HEALTHY);
			assert.equal(record.evidence.transportKind, 'http-generic-json');
			assert.equal(record.evidence.capacityProvenance, 'third-party-free-tier');
			assert.equal(record.evidence.credentialHandle, FIXTURE_CREDENTIAL_HEALTHY);
			assert.equal(record.evidence.payload.eligibilityVerdict, 'eligible');
			assert.equal(record.evidence.failureReason, 'none');
		});

		test('the payload carries the five landed projections (the never-re-derive law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-payload'));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-2', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			assert.equal(outcome.drilled, true);
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			assert.deepEqual(Object.keys(record.payload), ['provenanceView', 'capacityView', 'resetExpectationView', 'decisionView', 'eligibilityVerdict']);
			assert.equal(record.payload.provenanceView.contractVersion, '1.0.0');
			assert.equal(record.payload.provenanceView.verification, 'unverified');
			assert.equal(record.payload.provenanceView.substitution, 'none');
			assert.equal(record.payload.provenanceView.actualProviderId, FIXTURE_PROVIDER_HEALTHY);
			assert.equal(record.payload.provenanceView.actualModelId, FIXTURE_MODEL_HEALTHY_MAIN);
			assert.equal(record.payload.capacityView.capacityState, 'available');
			assert.equal(record.payload.capacityView.cooldown, false);
			assert.equal(record.payload.resetExpectationView.resetClass, 'fixed-instant');
			assert.equal(record.payload.resetExpectationView.expectation.kind, 'known');
		});

		test('the decision view is the isolation decided-side projection', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-decision'));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-3', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			assert.equal(record.payload.decisionView.family, 'isolation');
			assert.equal(record.payload.decisionView.side, 'selected');
			assert.deepEqual([...record.payload.decisionView.reasons], ['eligible']);
		});

		test('the byte citations are the landed serializers own bytes (cited, never re-implemented)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-citations'));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-4', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			const landed = landedHealthyReportAndDisclosure(FIXTURE_MODEL_HEALTHY_MAIN);
			const landedDecision = landedEligibilityDecision(FIXTURE_SCOPE_HEALTHY_ID, 'product-inference');
			assert.equal(record.byteCitations.length, 8);
			assert.equal(record.byteCitations[0].serializer, 'serializeCredentialScope');
			assert.equal(record.byteCitations[0].bytes, serializeCredentialScope({ id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY }));
			assert.equal(record.byteCitations[1].serializer, 'serializeAdapterReport');
			assert.equal(record.byteCitations[1].bytes, landed.reportBytes);
			assert.equal(record.byteCitations[2].serializer, 'serializeCapacityDisclosure');
			assert.equal(record.byteCitations[2].bytes, landed.disclosureBytes);
			for (const index of [3, 4, 5, 6]) {
				assert.equal(record.byteCitations[index].serializer, 'serializePresentationRecord');
			}
			assert.equal(record.byteCitations[3].bytes, serializePresentationRecord(record.payload.provenanceView));
			assert.equal(record.byteCitations[4].bytes, serializePresentationRecord(record.payload.capacityView));
			assert.equal(record.byteCitations[5].bytes, serializePresentationRecord(record.payload.resetExpectationView));
			assert.equal(record.byteCitations[6].bytes, serializePresentationRecord(record.payload.decisionView));
			assert.equal(record.byteCitations[7].serializer, 'serializeEligibilityDecision');
			assert.equal(record.byteCitations[7].bytes, serializeEligibilityDecision(landedDecision));
		});

		test('the produced drill record satisfies the contract guard (the drift fail-closed law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-guard'));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-5', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: unknown }).evidence;
			assert.equal(isDrillRecord(record), true);
		});

		test('the exchange timings ride the injected clock (started at or after completion, both finite)', async () => {
			const clock = countingClock();
			const kit = makeKit(dedicatedLedgerRoot('drill-clock'), undefined, undefined, undefined, clock.now);
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-6', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			assert.equal(Number.isFinite(record.startedAtEpochMs), true);
			assert.equal(Number.isFinite(record.completedAtEpochMs), true);
			assert.equal(record.completedAtEpochMs >= record.startedAtEpochMs, true);
		});

		test('the drill ledger appends one canonical line per drill (append-only)', async () => {
			const root = dedicatedLedgerRoot('drill-ledger');
			const kit = makeKit(root);
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-7', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-8', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const lines = readLedgerLines(drillLedgerPath(root));
			assert.equal(lines.length, 2);
			assert.equal(isDrillRecord(JSON.parse(lines[0]) as unknown), true);
			assert.equal(isDrillRecord(JSON.parse(lines[1]) as unknown), true);
		});

		test('the landed ledgers chain at the same root (isolation-decisions and presentation-audits)', async () => {
			const root = dedicatedLedgerRoot('drill-chain');
			const kit = makeKit(root);
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-9', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			assert.equal(existsSync(join(root, ISOLATION_DECISIONS_LEDGER_FILE)), true);
			assert.equal(existsSync(join(root, PRESENTATION_AUDITS_LEDGER_FILE)), true);
			const decisions = readLedgerLines(join(root, ISOLATION_DECISIONS_LEDGER_FILE));
			assert.equal(decisions.length >= 1, true);
			const audits = readLedgerLines(join(root, PRESENTATION_AUDITS_LEDGER_FILE));
			assert.equal(audits.length, 4);
		});

		test('the snapshot counters fold honestly', async () => {
			const root = dedicatedLedgerRoot('drill-snapshot');
			const kit = makeKit(root);
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.healthy-10', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const snapshot = kit.snapshot();
			assert.equal(snapshot.acceptanceDrillsPerformed, 1);
			assert.equal(snapshot.failureDrillsPerformed, 0);
			assert.equal(snapshot.foldedAtEpochMs, FIXTURE_NOW_MS);
		});

		test('not-an-object: a non-object request is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-not-object'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill(null));
			assert.equal(refused.reason, 'not-an-object');
		});

		test('caller-supplied-label: a request carrying an evidence label is refused (the upgrade law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-label'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.label', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN, evidenceLabel: 'live-real' }));
			assert.equal(refused.reason, 'caller-supplied-label');
		});

		test('caller-supplied-verdict: a request carrying an eligibility verdict is refused (the never-re-derive law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-verdict'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.verdict', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN, eligibilityVerdict: 'eligible' }));
			assert.equal(refused.reason, 'caller-supplied-verdict');
		});

		test('shape-law-violation: a request field beyond the two-field shape is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-extra'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.extra', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN, retryCount: 3 }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an empty drill id is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-empty-id'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: '', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an empty model id is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-empty-model'));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.empty-model', requestedModelId: '' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('credential-shape: no credential port injected is a typed refusal (never a silent unauthenticated exchange)', async () => {
			const kit = createAcceptanceKit({
				now: fixedClock,
				catalog: fixtureCatalogRecord(),
				adapters: fixtureAdapterRecord(),
				scopes: fixtureScopeSetRecord(),
				networkPort: fixturePort(healthyObservation()),
				ledgerRoot: dedicatedLedgerRoot('drill-no-credential'),
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.no-credential', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a resolve fold that throws is a typed refusal', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-throwing-resolve'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => {
					throw new Error('fixture broken seam');
				},
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.throwing-resolve', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a non-object resolution is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-non-object-resolution'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => 'fixture resolution string' as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.bad-resolution', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a resolution without its side named is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-sideless-resolution'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => ({ scopeId: FIXTURE_SCOPE_HEALTHY_ID }) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.sideless', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a resolution beyond the typed reference is refused (the safety law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-beyond-reference'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => ({
					resolved: true,
					scopeId: FIXTURE_SCOPE_HEALTHY_ID,
					adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
					credentialHandle: FIXTURE_CREDENTIAL_HEALTHY,
					apiKey: 'fixture.secret-shaped-value',
				}) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.beyond-reference', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a cross-inconsistent resolution binding is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-cross-resolution'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => ({
					resolved: true,
					scopeId: FIXTURE_SCOPE_REFUSED_ID,
					adapterId: FIXTURE_ACCEPTANCE_REFUSED_ID,
					credentialHandle: FIXTURE_CREDENTIAL_REFUSED,
				}) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.cross-resolution', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: a caller-invented handle reference is refused (never a silent substitution)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-invented-handle'), undefined, inventedHandleCredentialPort());
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.invented-handle', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'credential-shape');
		});

		test('credential-shape: the unresolved resolution is the landed three-field refusal form', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-unresolved-resolution'), undefined, {
				kind: 'handle',
				scope: { id: FIXTURE_SCOPE_HEALTHY_ID, adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => ({ resolved: false, reason: 'unknown-scope', detail: 'fixture unknown scope' }) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.unresolved-resolution', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'unresolved-scope-binding');
		});

		test('unresolved-scope-binding: a credential port scope beyond the bound scope set is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-unbound-scope'), undefined, {
				kind: 'handle',
				scope: { id: 'fixture.scope.not-bound', adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID, handleRef: FIXTURE_CREDENTIAL_HEALTHY },
				resolve: async () => ({
					resolved: true,
					scopeId: 'fixture.scope.not-bound',
					adapterId: FIXTURE_ACCEPTANCE_HEALTHY_ID,
					credentialHandle: FIXTURE_CREDENTIAL_HEALTHY,
				}) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.unbound-scope', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'unresolved-scope-binding');
		});

		test('unresolved-decision-binding: the prohibited scope folds ineligible (never exchanged)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-ineligible'), undefined, refusedCredentialPort());
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.ineligible', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'unresolved-decision-binding');
			assert.match(refused.detail, /ineligible/);
		});

		test('unresolved-decision-binding: the unknown-terms scope never auto-eligibles (the honest-unknown law)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-term-unknown'), undefined, unknownTermCredentialPort());
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.term-unknown', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'unresolved-decision-binding');
			assert.match(refused.detail, /term-unknown/);
		});

		test('shape-law-violation: the port returning a non-object response is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-garbage-port'), {
				kind: 'fixture',
				respond: () => 'fixture garbage response' as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.garbage-port', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: the port response must name its completed side', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-sideless-port'), {
				kind: 'fixture',
				respond: () => ({ observation: healthyObservation() }) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.sideless-port', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: the completed response carries extra fields is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('drill-extra-response'), {
				kind: 'fixture',
				respond: () => ({ completed: true, observation: healthyObservation(), latencyMs: 12 }) as unknown as Record<string, unknown>,
			});
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.extra-response', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an observation with extra fields is refused', async () => {
			const observation = { ...healthyObservation(), temperature: 0.7 } as unknown as AdapterObservation;
			const kit = makeKit(dedicatedLedgerRoot('drill-extra-observation'), fixturePort(observation));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.extra-observation', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a non-finite observation timestamp is refused', async () => {
			const observation = { ...healthyObservation(), observedAtEpochMs: Number.NaN };
			const kit = makeKit(dedicatedLedgerRoot('drill-nan-observation'), fixturePort(observation));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.nan-observation', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: observation states failing the landed report fold are refused with the landed rejection cited', async () => {
			const observation = { ...healthyObservation(), health: 'exploded' } as unknown as AdapterObservation;
			const kit = makeKit(dedicatedLedgerRoot('drill-bad-health'), fixturePort(observation));
			const refused = refusedOutcome(await kit.runAcceptanceDrill({ drillId: 'fixture.drill.bad-health', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /reportAdapterSnapshot/);
		});
	});

	suite('runFailureDrill (the honest-failure folds)', () => {
		test('quota-failure: the disclosed exhausted state records the quota-failure class', async () => {
			const root = dedicatedLedgerRoot('failure-quota');
			const kit = makeKit(root, fixturePort(exhaustedObservation()));
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.quota', drillClass: 'quota-failure' });
			const drilled = drilledOutcome(outcome);
			assert.equal(drilled.evidence.kind, 'failure');
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'quota-failure');
			assert.equal(evidence.evidenceLabel, 'fixture');
			assert.equal(evidence.failureReason, 'quota-exhausted');
			assert.deepEqual([...evidence.disclosure.reasons], ['exhausted', 'quota-exhausted']);
			assert.equal(isFailureEvidence(evidence), true);
			assert.equal(readLedgerLines(drillLedgerPath(root)).length, 1);
		});

		test('cooldown-failure: the active cooldown own reason rides verbatim', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-cooldown'), fixturePort(cooldownObservation()));
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.cooldown', drillClass: 'cooldown-failure', cooldownReason: 'rate-limited' });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'cooldown-failure');
			assert.equal(evidence.failureReason, 'rate-limited');
			assert.deepEqual([...evidence.disclosure.reasons], ['cooldown', 'rate-limited']);
		});

		test('reset-failure: the stale fixed-instant reset projects the honest unknown', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-reset'), fixturePort(staleResetObservation()));
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.reset', drillClass: 'reset-failure' });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'reset-failure');
			assert.equal(evidence.failureReason, 'unknown');
			assert.deepEqual([...evidence.disclosure.reasons], ['fixed-instant', 'unknown']);
		});

		test('eligibility-refusal: the landed verdict is the failure reason verbatim', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-eligibility'), undefined, refusedCredentialPort());
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.eligibility', drillClass: 'eligibility-refusal', scopeId: FIXTURE_SCOPE_REFUSED_ID });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'eligibility-refusal');
			assert.equal(evidence.evidenceLabel, 'fixture');
			assert.equal(evidence.failureReason, 'ineligible');
			assert.deepEqual([...evidence.disclosure.reasons], ['ineligible']);
		});

		test('eligibility-refusal: NEVER reaches the wire (the counting port stays at zero)', async () => {
			const counting = countingFixturePort(healthyObservation());
			const kit = makeKit(dedicatedLedgerRoot('failure-eligibility-wire'), counting.port, refusedCredentialPort());
			await kit.runFailureDrill({ drillId: 'fixture.drill.eligibility-wire', drillClass: 'eligibility-refusal', scopeId: FIXTURE_SCOPE_REFUSED_ID });
			assert.equal(counting.calls(), 0);
		});

		test('network-refused: the port refusal reason rides verbatim (the honest-failure law)', async () => {
			const root = dedicatedLedgerRoot('failure-network');
			const kit = makeKit(root, refusingFixturePort());
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.network', drillClass: 'network-refused', refusalReason: FIXTURE_REFUSAL_REASON });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'network-refused');
			assert.equal(evidence.evidenceLabel, 'fixture');
			assert.equal(evidence.failureReason, FIXTURE_REFUSAL_REASON);
			assert.deepEqual([...evidence.disclosure.reasons], [FIXTURE_REFUSAL_REASON]);
			assert.equal(isFailureEvidence(evidence), true);
			assert.equal(readLedgerLines(drillLedgerPath(root)).length, 1);
		});

		test('network-refused: the refusal is never retried (one port call only)', async () => {
			const counting = countingRefusingFixturePort();
			const kit = makeKit(dedicatedLedgerRoot('failure-network-retry'), counting.port);
			await kit.runFailureDrill({ drillId: 'fixture.drill.network-retry', drillClass: 'network-refused', refusalReason: FIXTURE_REFUSAL_REASON });
			assert.equal(counting.calls(), 1);
		});

		test('provenance-unknown: the honest unknown capacity state with unverified metadata', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-unknown'), fixturePort(unknownCapacityObservation()));
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.unknown', drillClass: 'provenance-unknown' });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.drillClass, 'provenance-unknown');
			assert.equal(evidence.failureReason, 'unknown');
			assert.deepEqual([...evidence.disclosure.reasons], ['unknown', 'unverified']);
		});

		test('the evidence label follows the port class: the live-configured double derives live-real (the derivation switch)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-live-switch'), liveDoublePort(healthyObservation()));
			const outcome = await kit.runAcceptanceDrill({ drillId: 'fixture.drill.live-switch', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			assert.equal(record.evidenceLabel, 'live-real');
		});

		test('a failed live probe is recorded as live-real failure evidence, never converted (the honest-failure law over the live class)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-live-refused'), liveRefusingDoublePort());
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.live-refused', drillClass: 'network-refused', refusalReason: FIXTURE_REFUSAL_REASON });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(evidence.evidenceLabel, 'live-real');
			assert.equal(evidence.failureReason, FIXTURE_REFUSAL_REASON);
		});

		test('every failure record satisfies isFailureEvidence and the disclosure never silent-empty', async () => {
			const root = dedicatedLedgerRoot('failure-guard');
			const kit = makeKit(root, fixturePort(exhaustedObservation()));
			const outcome = await kit.runFailureDrill({ drillId: 'fixture.drill.guard', drillClass: 'quota-failure' });
			const evidence = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').FailureEvidence }).evidence;
			assert.equal(isFailureEvidence(evidence), true);
			assert.equal(evidence.disclosure.side, 'refused');
			assert.equal(evidence.disclosure.reasons.length > 0, true);
		});

		test('not-an-object: a non-object scenario is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-not-object'));
			const refused = refusedOutcome(await kit.runFailureDrill(null));
			assert.equal(refused.reason, 'not-an-object');
		});

		test('caller-supplied-label: a scenario carrying an evidence label is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-label'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.f-label', drillClass: 'quota-failure', evidenceLabel: 'fixture' }));
			assert.equal(refused.reason, 'caller-supplied-label');
		});

		test('caller-supplied-verdict: a scenario carrying an eligibility verdict is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-verdict'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.f-verdict', drillClass: 'quota-failure', verdict: 'eligible' }));
			assert.equal(refused.reason, 'caller-supplied-verdict');
		});

		test('shape-law-violation: the acceptance-exchange class is not a failure scenario', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-acceptance-class'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.acceptance-class', drillClass: 'acceptance-exchange' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a non-member class is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-non-member'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.non-member', drillClass: 'exploded' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a non-member cooldown reason is refused (the landed vocabulary only)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-bad-reason'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.bad-reason', drillClass: 'cooldown-failure', cooldownReason: 'tired' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an empty scope id is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-empty-scope'), undefined, refusedCredentialPort());
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.empty-scope', drillClass: 'eligibility-refusal', scopeId: '' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an empty refusal reason is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-empty-refusal'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.empty-refusal', drillClass: 'network-refused', refusalReason: '' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a scenario class requiring a completion is never re-worded from a refusal', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-reword-refusal'), refusingFixturePort());
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.reword-refusal', drillClass: 'quota-failure' }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /never re-words/);
		});

		test('shape-law-violation: a pinned refusal reason that disagrees with the port is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-pin-mismatch'), refusingFixturePort('provider hard refusal'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.pin-mismatch', drillClass: 'network-refused', refusalReason: 'a different reason' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a network-refused scenario whose port completed is never re-worded', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-reword-completion'), fixturePort(healthyObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.reword-completion', drillClass: 'network-refused', refusalReason: FIXTURE_REFUSAL_REASON }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /never re-words/);
		});

		test('shape-law-violation: a quota scenario whose observation is not exhausted is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-quota-mismatch'), fixturePort(healthyObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.quota-mismatch', drillClass: 'quota-failure' }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /exhausted/);
		});

		test('shape-law-violation: a cooldown scenario whose observation is not cooling down is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-cooldown-mismatch'), fixturePort(healthyObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.cooldown-mismatch', drillClass: 'cooldown-failure', cooldownReason: 'rate-limited' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a cooldown scenario whose active reason differs is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-cooldown-reason-mismatch'), fixturePort(cooldownObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.cooldown-reason-mismatch', drillClass: 'cooldown-failure', cooldownReason: 'provider-error' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: a reset scenario whose reset is not stale is refused (never a fabricated future)', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-reset-mismatch'), fixturePort(healthyObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.reset-mismatch', drillClass: 'reset-failure' }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /stale/);
		});

		test('shape-law-violation: a provenance-unknown scenario whose observation discloses a known state is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-unknown-mismatch'), fixturePort(healthyObservation()));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.unknown-mismatch', drillClass: 'provenance-unknown' }));
			assert.equal(refused.reason, 'shape-law-violation');
		});

		test('shape-law-violation: an eligibility refusal for an eligible scope is not honest evidence', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-eligible-refusal'));
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.eligible-refusal', drillClass: 'eligibility-refusal', scopeId: FIXTURE_SCOPE_HEALTHY_ID }));
			assert.equal(refused.reason, 'shape-law-violation');
			assert.match(refused.detail, /eligible/);
		});

		test('unresolved-scope-binding: a scenario naming a scope the credential port does not bind is refused', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-cross-scope'), undefined, refusedCredentialPort());
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.cross-scope', drillClass: 'eligibility-refusal', scopeId: FIXTURE_SCOPE_HEALTHY_ID }));
			assert.equal(refused.reason, 'unresolved-scope-binding');
		});

		test('unresolved-decision-binding: a wire-reaching failure drill needs an eligible binding', async () => {
			const kit = makeKit(dedicatedLedgerRoot('failure-ineligible-wire'), fixturePort(exhaustedObservation()), refusedCredentialPort());
			const refused = refusedOutcome(await kit.runFailureDrill({ drillId: 'fixture.drill.ineligible-wire', drillClass: 'quota-failure' }));
			assert.equal(refused.reason, 'unresolved-decision-binding');
		});
	});

	suite('readDrillLedger / projectDrillLedger (the canonical-bytes ledger walk)', () => {
		async function drilledLineFixture(name: string, port: unknown = fixturePort(healthyObservation())): Promise<{ path: string; lines: string[]; record: import('../../common/acceptanceContract.js').DrillRecord }> {
			const root = dedicatedLedgerRoot(name);
			const kit = makeKit(root, port);
			const outcome = await kit.runAcceptanceDrill({ drillId: `fixture.drill.${name}`, requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			const record = (outcome as { drilled: true; evidence: import('../../common/acceptanceContract.js').DrillRecord }).evidence;
			const lines = readLedgerLines(drillLedgerPath(root));
			return { path: drillLedgerPath(root), lines, record };
		}

		test('the drilled ledger lines project (kind agrees, canonical bytes carried verbatim)', async () => {
			const fixture = await drilledLineFixture('ledger-read');
			const kit = makeKit(dedicatedLedgerRoot('ledger-read-kit'));
			const outcome = kit.readDrillLedger(fixture.path, 1);
			const view = projectedLedgerLine(outcome as unknown as { projected: boolean });
			assert.equal(view.line, 1);
			assert.equal(view.recordKind, 'drill');
			assert.equal(view.canonicalBytes, fixture.lines[0]);
			assert.equal(view.contractVersion, CONTRACT_INFERENCE_ACCEPTANCE_VERSION);
			assert.equal(isDrillRecord(view.record), true);
		});

		test('the ledger line view satisfies isAcceptanceLedgerLine', async () => {
			const fixture = await drilledLineFixture('ledger-guard');
			const kit = makeKit(dedicatedLedgerRoot('ledger-guard-kit'));
			const view = projectedLedgerLine(kit.readDrillLedger(fixture.path, 1) as unknown as { projected: boolean });
			const { isAcceptanceLedgerLine } = await import('../../common/acceptanceContract.js');
			assert.equal(isAcceptanceLedgerLine(view), true);
		});

		test('shape-law-violation: a bad path / line shape is refused', () => {
			const kit = makeKit(dedicatedLedgerRoot('ledger-shape'));
			const refused = refusedLedgerRead(kit.readDrillLedger('', 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'shape-law-violation');
			const refusedLine = refusedLedgerRead(kit.readDrillLedger('fixture-path', 0) as unknown as { projected: boolean });
			assert.equal(refusedLine.reason, 'shape-law-violation');
		});

		test('unresolved-ledger-line: a missing ledger file is a typed rejection', () => {
			const kit = makeKit(dedicatedLedgerRoot('ledger-missing'));
			const refused = refusedLedgerRead(kit.readDrillLedger(join(LEDGER_TEST_ROOT, 'ledger-missing', 'nowhere.jsonl'), 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-ledger-line');
		});

		test('unresolved-ledger-line: a non-file path is a typed rejection', () => {
			const root = dedicatedLedgerRoot('ledger-non-file');
			const kit = makeKit(root);
			const refused = refusedLedgerRead(kit.readDrillLedger(root, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-ledger-line');
		});

		test('unresolved-ledger-line: an out-of-range line is a typed rejection', async () => {
			const fixture = await drilledLineFixture('ledger-range');
			const kit = makeKit(dedicatedLedgerRoot('ledger-range-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(fixture.path, 2) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-ledger-line');
			assert.match(refused.detail, /out of range/);
		});

		test('malformed-record: an unparseable line is refused, never a silent drop', async () => {
			const path = writeLedgerFixture('ledger-unparseable', ['{"kind":"drill",']);
			const kit = makeKit(dedicatedLedgerRoot('ledger-unparseable-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'malformed-record');
		});

		test('malformed-record: a parseable line no acceptance guard admits is refused', async () => {
			const path = writeLedgerFixture('ledger-no-guard', ['{"kind":"audit"}']);
			const kit = makeKit(dedicatedLedgerRoot('ledger-no-guard-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'malformed-record');
		});

		test('malformed-record: a non-canonical byte form (shuffled keys) fails the round-trip', async () => {
			const fixture = await drilledLineFixture('ledger-shuffled');
			const shuffled = JSON.stringify(shuffleDeep(JSON.parse(fixture.lines[0]) as unknown));
			const path = writeLedgerFixture('ledger-shuffled-file', [shuffled]);
			const kit = makeKit(dedicatedLedgerRoot('ledger-shuffled-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'malformed-record');
			assert.match(refused.detail, /round-trip/);
		});

		test('no-live-port: a live-real claim over a fixture-configured port is refused (the upgrade law at the read boundary)', async () => {
			const fixture = await drilledLineFixture('ledger-live-real', liveDoublePort(healthyObservation()));
			const kit = makeKit(dedicatedLedgerRoot('ledger-no-live-port-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(fixture.path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'no-live-port');
			assert.match(refused.detail, /never promoted/);
		});

		test('the live-configured kit projects its own live-real line (the switch at the read boundary)', async () => {
			const fixture = await drilledLineFixture('ledger-live-own', liveDoublePort(healthyObservation()));
			const kit = makeKit(dedicatedLedgerRoot('ledger-live-own-kit'), liveDoublePort(healthyObservation()));
			const view = projectedLedgerLine(kit.readDrillLedger(fixture.path, 1) as unknown as { projected: boolean });
			assert.equal(view.record.evidenceLabel, 'live-real');
		});

		test('unresolved-adapter-binding: a dangling adapter id is refused', async () => {
			const fixture = await drilledLineFixture('ledger-dangling-adapter');
			const dangling = {
				...fixture.record,
				adapterId: 'fixture.acceptance.nowhere',
				scope: { ...fixture.record.scope, adapterId: 'fixture.acceptance.nowhere' },
			};
			const path = writeLedgerFixture('ledger-dangling-adapter-file', [serializeAcceptanceRecord(dangling)]);
			const kit = makeKit(dedicatedLedgerRoot('ledger-dangling-adapter-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-adapter-binding');
		});

		test('unresolved-scope-binding: a dangling scope id is refused', async () => {
			const fixture = await drilledLineFixture('ledger-dangling-scope');
			const dangling = {
				...fixture.record,
				scope: { ...fixture.record.scope, id: 'fixture.scope.nowhere' },
			};
			const path = writeLedgerFixture('ledger-dangling-scope-file', [serializeAcceptanceRecord(dangling)]);
			const kit = makeKit(dedicatedLedgerRoot('ledger-dangling-scope-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-scope-binding');
		});

		test('unresolved-scope-binding: a cross-inconsistent scope binding is refused', async () => {
			const fixture = await drilledLineFixture('ledger-cross-bound');
			const kit = makeKit(dedicatedLedgerRoot('ledger-cross-bound-kit'), undefined, undefined, crossBoundScopeSetRecord());
			const refused = refusedLedgerRead(kit.readDrillLedger(fixture.path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-scope-binding');
		});

		test('unresolved-decision-binding: a verdict the bound records never produced is refused', async () => {
			const fixture = await drilledLineFixture('ledger-verdict');
			const mismatched = {
				...fixture.record,
				payload: {
					...fixture.record.payload,
					eligibilityVerdict: 'ineligible',
					decisionView: { ...fixture.record.payload.decisionView, reasons: ['ineligible'] },
				},
			};
			const path = writeLedgerFixture('ledger-verdict-file', [serializeAcceptanceRecord(mismatched)]);
			const kit = makeKit(dedicatedLedgerRoot('ledger-verdict-kit'));
			const refused = refusedLedgerRead(kit.readDrillLedger(path, 1) as unknown as { projected: boolean });
			assert.equal(refused.reason, 'unresolved-decision-binding');
			assert.match(refused.detail, /verdictForTermState/);
		});

		test('projectDrillLedger: the full stream projects every line exactly once', async () => {
			const root = dedicatedLedgerRoot('ledger-stream');
			const kit = makeKit(root, fixturePort(exhaustedObservation()));
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.stream-1', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			await kit.runFailureDrill({ drillId: 'fixture.drill.stream-2', drillClass: 'quota-failure' });
			const lines = readLedgerLines(drillLedgerPath(root));
			const outcome = kit.projectDrillLedger(lines);
			assert.equal(outcome.projected, true);
			const views = (outcome as { projected: true; view: AcceptanceLedgerLineOutcome[] }).view;
			assert.equal(views.length, 2);
			assert.equal(views[0].projected, true);
			assert.equal(views[1].projected, true);
			assert.equal(views[0].line, 1);
			assert.equal(views[1].line, 2);
		});

		test('projectDrillLedger: a non-array stream is refused', () => {
			const kit = makeKit(dedicatedLedgerRoot('ledger-stream-shape'));
			const outcome = kit.projectDrillLedger('not-an-array');
			assert.equal(outcome.projected, false);
			assert.equal((outcome as { reason: string }).reason, 'shape-law-violation');
		});

		test('projectDrillLedger: a non-string member refuses the whole stream', () => {
			const kit = makeKit(dedicatedLedgerRoot('ledger-stream-member'));
			const outcome = kit.projectDrillLedger(['{"kind":"drill"}', 42]);
			assert.equal(outcome.projected, false);
			assert.equal((outcome as { reason: string }).reason, 'shape-law-violation');
		});

		test('projectDrillLedger: per-line refusal outcomes carry the line index (never a silent drop)', () => {
			const kit = makeKit(dedicatedLedgerRoot('ledger-stream-refusals'));
			const outcome = kit.projectDrillLedger(['{"kind":"drill",', '{"kind":"audit"}']);
			const views = (outcome as { projected: true; view: AcceptanceLedgerLineOutcome[] }).view;
			assert.equal(views.length, 2);
			for (const view of views) {
				assert.equal(view.projected, false);
				assert.equal((view as { line: number }).line > 0, true);
			}
		});
	});

	suite('snapshot (the honest state fold)', () => {
		test('the counters fold over drills, failures, refusals and reads', async () => {
			const root = dedicatedLedgerRoot('snapshot-fold');
			const kit = makeKit(root, fixturePort(exhaustedObservation()));
			await kit.runAcceptanceDrill({ drillId: 'fixture.drill.fold-1', requestedModelId: FIXTURE_MODEL_HEALTHY_MAIN });
			await kit.runFailureDrill({ drillId: 'fixture.drill.fold-2', drillClass: 'quota-failure' });
			await kit.runAcceptanceDrill(null);
			kit.readDrillLedger(drillLedgerPath(root), 1);
			const snapshot = kit.snapshot();
			assert.equal(snapshot.acceptanceDrillsPerformed, 1);
			assert.equal(snapshot.failureDrillsPerformed, 1);
			assert.equal(snapshot.refusalsEmitted, 1);
			assert.equal(snapshot.ledgerLinesProjected, 1);
		});

		test('the drift fail-closed: a non-finite clock read at snapshot throws', () => {
			// Creation consumes exactly three clock reads (the acceptance
			// validation read, the landed isolation kit's, the landed
			// presentation kit's); the snapshot read is the fourth.
			const kit = makeKit(dedicatedLedgerRoot('snapshot-drift'), undefined, undefined, undefined, flakyClock(3));
			assert.throws(() => kit.snapshot(), TypeError);
		});
	});

	suite('every frozen rejection reason fires (the receipt as a test)', () => {
		test('all eleven ACCEPTANCE_REJECTION_REASONS fired across this battery', () => {
			for (const reason of ACCEPTANCE_REJECTION_REASONS) {
				assert.equal(firedReasons.has(reason), true, `the reason '${reason}' must fire somewhere in this battery`);
			}
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every Date.now / Math.random / process.env hit in acceptanceKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/acceptanceKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in acceptanceContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/acceptanceContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
