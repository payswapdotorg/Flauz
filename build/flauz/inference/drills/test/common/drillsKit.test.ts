/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 drill kit test suite (mocha tdd style, matching
 * build/flauz/inference/presentation/test/common/presentationKit.test.ts).
 *
 * Fixture policy: every scenario id, provider entry id, adapter id,
 * scope id, matrix id, model id and credential handle below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the landed attempt outcomes, the
 * eligibility verdicts, the rejection reasons, the version stamps)
 * are the LANDED families' own values under test. All timestamps are
 * injected plain-number epoch milliseconds; the suite never reads a
 * clock. NO live provider calls exist anywhere: the drills are
 * simulated-provider fixtures over the LANDED kits only. The audit
 * stream runs local-real filesystem reads/writes at the kit's fixed
 * fixture root under os.tmpdir(); the assertions are delta-based so
 * pre-existing ledger lines never break a run.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import {
	INFERENCE_DRILLS_VERSION,
	DRILL_SCENARIO_KINDS,
	isDrillReceipt,
	serializeDrillReceipt,
} from '../../common/drillsContract.js';
import type { DrillReceipt } from '../../common/drillsContract.js';
import { createDrillsKit } from '../../common/drillsKit.js';
import type { DrillSummary } from '../../common/drillsKit.js';
import {
	isCapacityView,
	isDecisionView,
	isProvenanceView,
	isResetExpectationView,
	serializePresentationRecord,
} from '../../../presentation/common/presentationContract.js';
import type { DecisionView, ProvenanceView } from '../../../presentation/common/presentationContract.js';
import { ROUTING_ATTEMPT_OUTCOMES } from '../../../routing/common/routingContract.js';
import { createRoutingKit } from '../../../routing/common/routingKit.js';
import { reportAdapterSnapshot } from '../../../adapters/common/providerAdapter.js';
import type { ProviderAdapterRecord } from '../../../adapters/common/providerAdapter.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import { INFERENCE_ISOLATION_VERSION } from '../../../isolation/common/isolationContract.js';
import { unknownSnapshot } from '../../../semantics/common/capacityDisclosure.js';

const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_RETRY_BACKOFF_MS = 15_000;
const FIXTURE_PROVIDER_PERMITTED = 'fixture.provider.permitted';
const FIXTURE_PROVIDER_PROHIBITED = 'fixture.provider.prohibited';
const FIXTURE_PROVIDER_UNKNOWN_TERM = 'fixture.provider.unknown-term';
const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_GAMMA = 'fixture.adapter.gamma';
const FIXTURE_CREDENTIAL_ALPHA = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_BETA = 'fixture.credential.handle.beta';
const FIXTURE_CREDENTIAL_GAMMA = 'fixture.credential.handle.gamma';
const FIXTURE_SCOPE_PERMITTED = 'fixture.scope.permitted';
const FIXTURE_SCOPE_PROHIBITED = 'fixture.scope.prohibited';
const FIXTURE_SCOPE_UNKNOWN_TERM = 'fixture.scope.unknown-term';

function fixtureEntry(entryId: string, termsState: string, capacitySnapshot?: unknown): Record<string, unknown> {
	return {
		entryId,
		displayName: `Fixture Entry ${entryId}`,
		providerClass: 'third-party-free-tier',
		planClaims: [],
		capacitySnapshot: capacitySnapshot ?? unknownSnapshot(entryId, FIXTURE_NOW_MS),
		metadataVerification: 'unverified',
		termsState,
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureCatalog(): Record<string, unknown> {
	return {
		catalogId: 'fixture.catalog.drills',
		entries: [
			fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted'),
			fixtureEntry(FIXTURE_PROVIDER_PROHIBITED, 'prohibited'),
			fixtureEntry(FIXTURE_PROVIDER_UNKNOWN_TERM, 'unknown'),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

/** The exhausted-edge fixture snapshot: known quota at zero inside its inclusive window, a STALE fixed-instant reset. */
function exhaustedSnapshot(providerEntryId: string): Record<string, unknown> {
	return {
		contractVersion: '1.0.0',
		providerId: providerEntryId,
		verification: 'unverified',
		health: 'healthy',
		quota: {
			state: 'known',
			remaining: 0,
			limit: 60,
			window: {
				kind: 'fixed',
				windowStartEpochMs: FIXTURE_NOW_MS - 60_000,
				windowLengthMs: 2 * 60_000,
			},
		},
		cooldown: { state: 'none' },
		resetSchedule: { kind: 'fixed-instant', atEpochMs: FIXTURE_NOW_MS - 1_000 },
		observedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureAdapters(): Record<string, unknown> {
	return {
		adapterSetId: 'fixture.adapter-set.drills',
		adapters: [
			{
				adapterId: FIXTURE_ADAPTER_ALPHA,
				displayName: 'Fixture Adapter Alpha',
				providerEntryId: FIXTURE_PROVIDER_PERMITTED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_ALPHA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_BETA,
				displayName: 'Fixture Adapter Beta',
				providerEntryId: FIXTURE_PROVIDER_PROHIBITED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_BETA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_GAMMA,
				displayName: 'Fixture Adapter Gamma',
				providerEntryId: FIXTURE_PROVIDER_UNKNOWN_TERM,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_GAMMA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
		],
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

function fixtureScopes(): Record<string, unknown> {
	return {
		scopeSetId: 'fixture.scope-set.drills',
		scopes: [
			{ id: FIXTURE_SCOPE_PERMITTED, adapterId: FIXTURE_ADAPTER_ALPHA, handleRef: FIXTURE_CREDENTIAL_ALPHA },
			{ id: FIXTURE_SCOPE_PROHIBITED, adapterId: FIXTURE_ADAPTER_BETA, handleRef: FIXTURE_CREDENTIAL_BETA },
			{ id: FIXTURE_SCOPE_UNKNOWN_TERM, adapterId: FIXTURE_ADAPTER_GAMMA, handleRef: FIXTURE_CREDENTIAL_GAMMA },
		],
		contractVersion: INFERENCE_ISOLATION_VERSION,
	};
}

function scenarioBase(): Record<string, unknown> {
	return {
		contractVersion: INFERENCE_DRILLS_VERSION,
		clockSeed: FIXTURE_NOW_MS,
		catalog: fixtureCatalog(),
		adapters: fixtureAdapters(),
		scopes: fixtureScopes(),
	};
}

function scenario(
	scenarioId: string,
	kind: string,
	expected: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return { ...scenarioBase(), scenarioId, kind, expected, ...overrides };
}

function fixedClock(): number {
	return FIXTURE_NOW_MS;
}

/** The counting clock: pins the kit's one-validation-read law. */
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

function auditLines(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => line.length > 0);
}

function run(scenarioCandidate: Record<string, unknown>, now: () => number = fixedClock): DrillReceipt {
	return createDrillsKit({ now }).runDrill(scenarioCandidate);
}

function decisionViewOf(receipt: DrillReceipt): DecisionView {
	assert.equal(receipt.citation.length >= 1, true, 'the receipt carries its acceptance-view citation');
	const view = receipt.citation[0].view;
	assert.equal(isDecisionView(view), true, 'the first cited view is a LANDED DecisionView');
	return view as DecisionView;
}

function summaryOf(receipts: DrillReceipt[]): DrillSummary {
	return createDrillsKit({ now: fixedClock }).drillSummary(receipts) as DrillSummary;
}

suite('INF-009 drill kit', () => {
	suite('createDrillsKit (the fail-closed factory)', () => {
		test('options.now must be a function (the injected-clock law)', () => {
			assert.throws(() => createDrillsKit({} as { now: () => number }), TypeError);
			assert.throws(() => createDrillsKit({ now: 'not-a-function' } as unknown as { now: () => number }), TypeError);
		});
		test('the injected clock must produce a finite epoch-ms number (one validation read)', () => {
			assert.throws(() => createDrillsKit({ now: () => Number.NaN }), TypeError);
		});
		test('the flaky clock is finite exactly once at creation, so the one-read factory admits it (both malformed-options paths pinned)', () => {
			const kit = createDrillsKit({ now: flakyClock() });
			assert.equal(typeof kit.runDrill, 'function');
			assert.throws(() => createDrillsKit({ now: () => Number.NaN }), /finite epoch-ms number/);
		});
		test('exactly ONE clock read happens at creation (the counting clock)', () => {
			const clock = countingClock();
			createDrillsKit({ now: clock.now });
			assert.equal(clock.reads(), 1);
		});
		test('the fixture ledger root exists and the audit path is the presentation-audits.jsonl disclosure', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const auditPath = kit.auditLedgerPath();
			assert.match(auditPath, /flauz-drills-audit-fixture\/presentation-audits\.jsonl$/);
			assert.equal(existsSync(auditPath.split('/presentation-audits.jsonl')[0]), true);
		});
		test('auditLedgerPath is stable across calls (the deterministic disclosure)', () => {
			const kit = createDrillsKit({ now: fixedClock });
			assert.equal(kit.auditLedgerPath(), kit.auditLedgerPath());
		});
	});

	suite('the cooldown-hold drill (end-to-end)', () => {
		test('the hold trips: observed cooldown-hold against the matching expectation', () => {
			const receipt = run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			assert.equal(receipt.observed, 'cooldown-hold');
			assert.equal(receipt.passed, true);
			assert.equal(isDrillReceipt(receipt), true);
		});
		test('the log carries the LANDED skipped-cooldown outcome verbatim per candidate', () => {
			const receipt = run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			assert.deepEqual(
				receipt.drillLog.map((entry) => entry.verdict),
				['skipped-cooldown', 'skipped-cooldown', 'skipped-cooldown'],
			);
			assert.deepEqual(
				receipt.drillLog.map((entry) => entry.fold),
				['route', 'route', 'route'],
			);
		});
		test('the cited DecisionView is the refused side with the typed refusal reason verbatim', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold')));
			assert.equal(view.family, 'routing');
			assert.equal(view.side, 'refused');
			assert.equal(view.adapterId, 'none');
			assert.deepEqual([...view.reasons], ['rate-limited', 'rate-limited', 'rate-limited']);
			assert.equal(view.provenance, 'none');
		});
		test('the citation bytes are the LANDED serializePresentationRecord bytes of the cited view', () => {
			const receipt = run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			assert.equal(receipt.citation[0].canonicalBytes, serializePresentationRecord(receipt.citation[0].view));
		});
		test('a zero-candidate fixture set honestly observes unknown (the honest empty is never a pass)', () => {
			const adapters = { ...fixtureAdapters(), adapters: [] };
			const scopes = { ...fixtureScopes(), scopes: [] };
			const receipt = run(scenario('fixture.scenario.cooldown-empty', 'cooldown-hold', 'cooldown-hold', { adapters, scopes }));
			assert.equal(receipt.observed, 'unknown');
			assert.equal(receipt.passed, false);
			assert.equal(receipt.citation.length >= 1, true, 'the exhausted outcome still cites its DecisionView');
			const view = decisionViewOf(receipt);
			assert.deepEqual([...view.reasons], [], 'the landed refusal is honestly empty exactly when nothing was admitted');
		});
	});

	suite('the retry-schedule drill (end-to-end)', () => {
		test('two runs one clock: observed retry-schedule-byte-equal against the matching expectation', () => {
			const receipt = run(scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal'));
			assert.equal(receipt.observed, 'retry-schedule-byte-equal');
			assert.equal(receipt.passed, true);
		});
		test('the log carries the LANDED attempt outcomes verbatim for both runs (eligible + attempted-failed)', () => {
			const receipt = run(scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal'));
			const verdicts = receipt.drillLog.map((entry) => entry.verdict);
			assert.equal(receipt.drillLog.length, 18, 'two runs, three candidates, three ledger lines per candidate');
			for (const verdict of verdicts) {
				assert.equal((ROUTING_ATTEMPT_OUTCOMES as readonly string[]).includes(verdict), true, `the landed member '${verdict}'`);
			}
			assert.equal(verdicts.filter((verdict) => verdict === 'attempted-failed').length, 12);
		});
		test('the deterministic scheduling pin: the retry lands at seed + backoff (the arithmetic the drill pins byte-equal)', () => {
			const adapters = fixtureAdapters() as unknown as { adapters: never };
			const routing = createRoutingKit({
				now: fixedClock,
				adapters: fixtureAdapters(),
				catalog: fixtureCatalog(),
			});
			const adapterRecord = adapters as unknown as ProviderAdapterRecord;
			void adapterRecord;
			for (const adapter of (fixtureAdapters() as { adapters: Record<string, unknown>[] }).adapters) {
				const report = reportAdapterSnapshot(
					adapter as never,
					{
						observedAtEpochMs: FIXTURE_NOW_MS,
						health: 'healthy',
						quota: {
							state: 'known',
							remaining: 42,
							limit: 60,
							window: { kind: 'fixed', windowStartEpochMs: FIXTURE_NOW_MS - 60_000, windowLengthMs: 120_000 },
						},
						cooldown: { state: 'none' },
						reset: { kind: 'unknown' },
					},
					{
						requestedProviderId: (adapter as { providerEntryId: string }).providerEntryId,
						requestedModelId: 'fixture.model.main',
						actualProviderId: (adapter as { providerEntryId: string }).providerEntryId,
						actualModelId: 'fixture.model.main',
						recordedAtEpochMs: FIXTURE_NOW_MS,
					},
				);
				routing.addCandidate({ adapterId: (adapter as { adapterId: string }).adapterId, report });
			}
			const outcome = routing.runWithFailover({
				attempt: () => 'failed' as const,
				policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_RETRY_BACKOFF_MS] },
				at: FIXTURE_NOW_MS,
			});
			assert.equal(outcome.kind, 'exhausted');
			if (outcome.kind !== 'exhausted') {
				return;
			}
			const attempts = outcome.attemptLedger.filter((entry) => entry.outcome === 'attempted-failed');
			assert.equal(attempts.length, 6);
			assert.equal(attempts[1].atEpochMs, FIXTURE_NOW_MS + FIXTURE_RETRY_BACKOFF_MS, 'the retry after failure one rides the injected schedule');
		});
		test('the cited DecisionView is the refused side carrying the attempt reasons verbatim', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal')));
			assert.equal(view.family, 'routing');
			assert.equal(view.side, 'refused');
			assert.deepEqual([...view.reasons], ['none', 'none', 'none', 'attempt-failed', 'attempt-failed', 'attempt-failed', 'attempt-failed', 'attempt-failed', 'attempt-failed']);
		});
	});

	suite('the failover-walk drill (end-to-end)', () => {
		test('the walk reaches the no-route terminal: observed failover-walk-exhausted', () => {
			const receipt = run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted'));
			assert.equal(receipt.observed, 'failover-walk-exhausted');
			assert.equal(receipt.passed, true);
		});
		test('every logged verdict is a LANDED ROUTING_ATTEMPT_OUTCOMES member (cited verbatim)', () => {
			const receipt = run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted'));
			for (const entry of receipt.drillLog) {
				assert.equal(entry.fold, 'runWithFailover');
				assert.equal((ROUTING_ATTEMPT_OUTCOMES as readonly string[]).includes(entry.verdict), true, `the landed member '${entry.verdict}'`);
			}
		});
		test('the walk visited every alternate in order (N eligible + N attempted-failed)', () => {
			const receipt = run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted'));
			const verdicts = receipt.drillLog.map((entry) => entry.verdict);
			assert.deepEqual(verdicts, ['eligible', 'eligible', 'eligible', 'attempted-failed', 'attempted-failed', 'attempted-failed']);
		});
		test('the cited DecisionView is the refused side with the ledger reasons verbatim in ledger order', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted')));
			assert.equal(view.family, 'routing');
			assert.equal(view.side, 'refused');
			assert.deepEqual([...view.reasons], ['none', 'none', 'none', 'attempt-failed', 'attempt-failed', 'attempt-failed']);
			assert.equal(view.provenance, 'none');
		});
	});

	suite('the eligibility-denial law (end-to-end)', () => {
		test('the prohibited fixture scope is INELIGIBLE (byte-pinned, never a silent pass)', () => {
			const receipt = run(scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED }));
			assert.equal(receipt.observed, 'eligibility-ineligible');
			assert.equal(receipt.passed, true);
			assert.deepEqual(
				receipt.drillLog.map((entry) => entry.verdict),
				['ineligible'],
			);
			assert.equal(receipt.drillLog[0].fold, 'checkEligibility');
		});
		test('the unknown-term fixture scope is TERM-UNKNOWN (the honest-unknown law, verbatim)', () => {
			const receipt = run(scenario('fixture.scenario.eligibility-unknown-term', 'eligibility-denial', 'eligibility-term-unknown', { targetId: FIXTURE_SCOPE_UNKNOWN_TERM }));
			assert.equal(receipt.observed, 'eligibility-term-unknown');
			assert.equal(receipt.passed, true);
			assert.deepEqual(
				receipt.drillLog.map((entry) => entry.verdict),
				['term-unknown'],
			);
		});
		test('the cited DecisionView carries the verdict verbatim and the derived probe provenance', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED })));
			assert.equal(view.family, 'isolation');
			assert.equal(view.side, 'selected');
			assert.deepEqual([...view.reasons], ['ineligible']);
			assert.notEqual(view.provenance, 'none');
			const provenance = view.provenance as ProvenanceView;
			assert.equal(isProvenanceView(provenance), true);
			assert.equal(provenance.scopeLabel, 'isolation.eligibility-probe', 'the landed eligibility probe scope rides the actual model field verbatim');
			assert.equal(provenance.substitution, 'none', 'the substitution label is derived, never caller-supplied');
		});
		test('a minimal single-scope fixture set drills its target honestly', () => {
			const scopes = {
				scopeSetId: 'fixture.scope-set.minimal',
				scopes: [{ id: FIXTURE_SCOPE_PROHIBITED, adapterId: FIXTURE_ADAPTER_BETA, handleRef: FIXTURE_CREDENTIAL_BETA }],
				contractVersion: INFERENCE_ISOLATION_VERSION,
			};
			const receipt = run(scenario('fixture.scenario.eligibility-minimal', 'eligibility-denial', 'eligibility-ineligible', { scopes, targetId: FIXTURE_SCOPE_PROHIBITED }));
			assert.equal(receipt.observed, 'eligibility-ineligible');
			assert.equal(receipt.passed, true);
		});
	});

	suite('the quota-exhaustion drill (end-to-end)', () => {
		test('the exhausted edge: the inclusive boundary math folds honestly', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', exhaustedSnapshot(FIXTURE_PROVIDER_PERMITTED));
			const receipt = run(scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			assert.equal(receipt.observed, 'quota-exhausted');
			assert.equal(receipt.passed, true);
			assert.deepEqual(
				receipt.drillLog.map((entry) => `${entry.fold}=${entry.verdict}`),
				['quotaWindowContains=true', 'cooldownActive=false', 'projectCapacityDisclosure=exhausted'],
			);
		});
		test('the cited CapacityView carries the disclosed state verbatim at the exhausted edge', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', exhaustedSnapshot(FIXTURE_PROVIDER_PERMITTED));
			const receipt = run(scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			const view = receipt.citation[0].view;
			assert.equal(isCapacityView(view), true);
			const capacity = view as { capacityState: string; quotaRemaining: number; cooldown: boolean; providerId: string };
			assert.equal(capacity.capacityState, 'exhausted');
			assert.equal(capacity.quotaRemaining, 0);
			assert.equal(capacity.cooldown, false);
			assert.equal(capacity.providerId, FIXTURE_PROVIDER_PERMITTED);
		});
		test('the stale-reset projection is carried AS unknown, never coerced (the INF-001 law, byte-pinned)', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', exhaustedSnapshot(FIXTURE_PROVIDER_PERMITTED));
			const receipt = run(scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			assert.equal(receipt.citation.length, 2, 'the drill cites its CapacityView AND its ResetExpectationView');
			const resetView = receipt.citation[1].view;
			assert.equal(isResetExpectationView(resetView), true);
			assert.equal(receipt.citation[1].canonicalBytes, serializePresentationRecord(resetView));
			assert.match(
				receipt.citation[1].canonicalBytes,
				/"expectation":\{"kind":"unknown"\}/,
				'the stale fixed-instant reset projects the honest unknown expectation',
			);
			assert.match(receipt.citation[1].canonicalBytes, /"resetClass":"fixed-instant"/);
		});
		test('an unknown-quota fixture honestly observes unknown (never a fabricated exhausted state)', () => {
			const receipt = run(scenario('fixture.scenario.quota-unknown', 'quota-exhaustion', 'unknown'));
			assert.equal(receipt.observed, 'unknown');
			assert.equal(receipt.passed, true, 'the honest-unknown expectation is matched honestly');
			const view = receipt.citation[0].view;
			assert.equal(isCapacityView(view), true);
			assert.equal((view as { capacityState: string }).capacityState, 'unknown');
		});
		test('a healthy-quota fixture maps the breach member honestly (the boundary math did not read exhausted)', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', {
				...unknownSnapshot(FIXTURE_PROVIDER_PERMITTED, FIXTURE_NOW_MS),
				health: 'healthy',
				quota: {
					state: 'known',
					remaining: 42,
					limit: 60,
					window: { kind: 'fixed', windowStartEpochMs: FIXTURE_NOW_MS - 60_000, windowLengthMs: 120_000 },
				},
			});
			const receipt = run(scenario('fixture.scenario.quota-healthy', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			assert.equal(receipt.observed, 'quota-available');
			assert.equal(receipt.passed, false, 'the drilled law did not hold - the receipt fails honestly');
			assert.equal(summaryOf([receipt]).unknownObserved, 0, 'the breach is not laundered as an honest unknown');
		});
	});

	suite('the substitution-disclosure drill (end-to-end)', () => {
		test('the dishonest fixture is rejected: observed substitution-rejected', () => {
			const receipt = run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			assert.equal(receipt.observed, 'substitution-rejected');
			assert.equal(receipt.passed, true);
		});
		test('the log carries the landed rejection reason verbatim (unlimited-provider-capacity)', () => {
			const receipt = run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			assert.deepEqual(
				receipt.drillLog.map((entry) => `${entry.fold}=${entry.verdict}`),
				['admitHonestPromise=unlimited-provider-capacity', 'unverifiedProvenance=disclosed'],
			);
		});
		test('the cited ProvenanceView carries the DERIVED substitution label (never caller-supplied)', () => {
			const receipt = run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			const view = receipt.citation[0].view;
			assert.equal(isProvenanceView(view), true);
			const provenance = view as ProvenanceView;
			assert.equal(provenance.substitution, 'disclosed');
			assert.equal(provenance.requestedModelId, 'fixture.model.requested');
			assert.equal(provenance.actualModelId, 'fixture.model.actual');
			assert.equal(provenance.scopeLabel, provenance.actualModelId, 'the scope label is the landed record own actual model field, never a re-derived display label');
		});
		test('the citation bytes are the LANDED canonical bytes (byte-pinned)', () => {
			const receipt = run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			assert.equal(receipt.citation[0].canonicalBytes, serializePresentationRecord(receipt.citation[0].view));
			assert.match(receipt.citation[0].canonicalBytes, /"substitution":"disclosed"/);
		});
	});

	suite('the determinism receipt (same scenario + same injected clock)', () => {
		test('two runs of the same scenario byte-equal through serializeDrillReceipt', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const candidate = scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold');
			const bytesA = serializeDrillReceipt(kit.runDrill(candidate));
			const bytesB = serializeDrillReceipt(kit.runDrill(candidate));
			assert.equal(bytesA, bytesB);
		});
		test('two runs across two kits byte-equal (the clock is the only time authority)', () => {
			const candidate = scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted');
			const bytesA = serializeDrillReceipt(createDrillsKit({ now: fixedClock }).runDrill(candidate));
			const bytesB = serializeDrillReceipt(createDrillsKit({ now: fixedClock }).runDrill(candidate));
			assert.equal(bytesA, bytesB);
		});
		test('the audit-stream deltas of two runs are byte-identical line sequences', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const candidate = scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal');
			const auditPath = kit.auditLedgerPath();
			const before = auditLines(auditPath).length;
			const receiptA = kit.runDrill(candidate);
			const deltaA = auditLines(auditPath).slice(before);
			const afterA = auditLines(auditPath).length;
			const receiptB = kit.runDrill(candidate);
			const deltaB = auditLines(auditPath).slice(afterA);
			assert.equal(serializeDrillReceipt(receiptA), serializeDrillReceipt(receiptB));
			assert.deepEqual(deltaA, deltaB);
			assert.equal(deltaA.length, receiptA.citation.length);
		});
	});

	suite('the audit-stream law (the delivery-evidence stream)', () => {
		test('each runDrill appends exactly its citation-count lines to presentation-audits.jsonl', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const auditPath = kit.auditLedgerPath();
			const before = auditLines(auditPath).length;
			const receipt = kit.runDrill(scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED }));
			const delta = auditLines(auditPath).slice(before);
			assert.equal(delta.length, receipt.citation.length);
		});
		test('the appended lines equal the cited canonical bytes in order', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const auditPath = kit.auditLedgerPath();
			const before = auditLines(auditPath).length;
			const receipt = kit.runDrill(scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'quota-exhausted', {
				catalog: (() => {
					const catalog = fixtureCatalog() as Record<string, unknown>;
					(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', exhaustedSnapshot(FIXTURE_PROVIDER_PERMITTED));
					return catalog;
				})(),
			}));
			const delta = auditLines(auditPath).slice(before);
			assert.deepEqual(delta, receipt.citation.map((cited) => cited.canonicalBytes));
		});
		test('every audit line parses under the LANDED presentation shape guards', () => {
			const kit = createDrillsKit({ now: fixedClock });
			kit.runDrill(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			const lines = auditLines(kit.auditLedgerPath());
			assert.equal(lines.length > 0, true);
			for (const line of lines) {
				const parsed = JSON.parse(line) as unknown;
				const landed = isProvenanceView(parsed) || isCapacityView(parsed) || isResetExpectationView(parsed) || isDecisionView(parsed);
				assert.equal(landed, true, `the audit line must be a LANDED view: ${line.slice(0, 80)}`);
			}
		});
	});

	suite('drillSummary (the honest-unknown roll-up)', () => {
		test('a passing batch rolls up honestly', () => {
			const receipts = [
				run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold')),
				run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted')),
			];
			const summary = summaryOf(receipts);
			assert.equal(summary.contractVersion, INFERENCE_DRILLS_VERSION);
			assert.equal(summary.total, 2);
			assert.equal(summary.passed, 2);
			assert.equal(summary.failed, 0);
			assert.equal(summary.unknownObserved, 0);
			assert.equal(summary.allPassed, true);
			assert.deepEqual(summary.rows.map((row) => row.scenarioId), ['fixture.scenario.cooldown-hold', 'fixture.scenario.failover-walk']);
		});
		test('an UNKNOWN observed verdict counts honestly and is NEVER coerced to pass against a held expectation', () => {
			const receipt = run(scenario('fixture.scenario.quota-unknown', 'quota-exhaustion', 'quota-exhausted'));
			assert.equal(receipt.observed, 'unknown');
			const summary = summaryOf([receipt]);
			assert.equal(summary.total, 1);
			assert.equal(summary.passed, 0);
			assert.equal(summary.failed, 1);
			assert.equal(summary.unknownObserved, 1);
			assert.equal(summary.allPassed, false);
			assert.equal(summary.rows[0].unknownObserved, true);
		});
		test('an EXPECTED unknown is a pass AND counts in the honest-unknown column', () => {
			const receipt = run(scenario('fixture.scenario.quota-unknown', 'quota-exhaustion', 'unknown'));
			assert.equal(receipt.observed, 'unknown');
			assert.equal(receipt.passed, true);
			const summary = summaryOf([receipt]);
			assert.equal(summary.passed, 1);
			assert.equal(summary.unknownObserved, 1);
			assert.equal(summary.allPassed, true);
		});
		test('a mixed batch adds up exactly', () => {
			const receipts = [
				run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold')),
				run(scenario('fixture.scenario.quota-unknown', 'quota-exhaustion', 'quota-exhausted')),
				run(scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED })),
			];
			const summary = summaryOf(receipts);
			assert.equal(summary.total, 3);
			assert.equal(summary.passed, 2);
			assert.equal(summary.failed, 1);
			assert.equal(summary.unknownObserved, 1);
			assert.equal(summary.allPassed, false);
		});
		test('the empty batch is honestly not-all-passed (nothing accepted is honest)', () => {
			const summary = summaryOf([]);
			assert.equal(summary.total, 0);
			assert.equal(summary.passed, 0);
			assert.equal(summary.allPassed, false);
		});
		test('a non-receipt row never enters the roll-up (fail-closed TypeError)', () => {
			const honest = run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			assert.throws(() => summaryOf([honest, { ...honest, citation: [] } as unknown as DrillReceipt]), TypeError);
			assert.throws(() => summaryOf(['not-a-receipt'] as unknown as DrillReceipt[]), TypeError);
		});
		test('a non-array input is fail-closed TypeError', () => {
			assert.throws(() => createDrillsKit({ now: fixedClock }).drillSummary('nope'), TypeError);
		});
	});

	suite('the fail-closed runDrill (the scenario walk surfaces through the kit)', () => {
		test('a rejected scenario throws TypeError carrying the reason verbatim', () => {
			assert.throws(
				() => run(scenario('openai-cooldown', 'cooldown-hold', 'cooldown-hold')),
				(error: unknown) => error instanceof TypeError && /fixture-id-not-synthetic/.test(error.message),
			);
		});
		test('an unrunnable kind throws with scenario-kind-unrunnable', () => {
			assert.throws(
				() => run(scenario('fixture.scenario.route', 'route', 'unknown')),
				(error: unknown) => error instanceof TypeError && /scenario-kind-unrunnable/.test(error.message),
			);
		});
		test('a dangling eligibility target throws with scenario-target-malformed', () => {
			assert.throws(
				() => run(scenario('fixture.scenario.eligibility-dangling', 'eligibility-denial', 'eligibility-ineligible', { targetId: 'fixture.scope.dangling' })),
				(error: unknown) => error instanceof TypeError && /scenario-target-malformed/.test(error.message),
			);
		});
		test('a scope set with a mismatched handleRef throws with the landed reason cited verbatim', () => {
			const scopes = fixtureScopes() as Record<string, unknown>;
			(scopes.scopes as Record<string, unknown>[])[0].handleRef = 'fixture.credential.handle.other';
			assert.throws(
				() => run(scenario('fixture.scenario.scopes-bad', 'cooldown-hold', 'cooldown-hold', { scopes })),
				(error: unknown) => error instanceof TypeError && /credential-handle-mismatch/.test(error.message),
			);
		});
	});

	suite('the disclosed fixture ids are synthetic (the fixture-prefixed law at the kit)', () => {
		test('every drill receipt scenarioId carries the fixture prefix', () => {
			for (const kind of DRILL_SCENARIO_KINDS) {
				const candidate: Record<string, unknown> = scenario(`fixture.scenario.${kind}`, kind, 'unknown');
				if (kind === 'eligibility-denial') {
					candidate.targetId = FIXTURE_SCOPE_PERMITTED;
				}
				const receipt = run(candidate);
				assert.match(receipt.scenarioId, /^fixture\./);
			}
		});
		test('an authority-looking provider entry id throws the typed rejection with the id named', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0].entryId = 'gpt-4-main';
			assert.throws(
				() => run(scenario('fixture.scenario.authority', 'cooldown-hold', 'cooldown-hold', { catalog })),
				(error: unknown) => error instanceof TypeError && /gpt-4-main/.test(error.message) && /fixture-id-not-synthetic/.test(error.message),
			);
		});
	});

	suite('the six kinds end-to-end (the kind coverage receipt)', () => {
		test('every scenario kind produces a guarded receipt with a non-empty acceptance-view citation', () => {
			const candidates: Record<string, unknown>[] = [
				scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'),
				scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal'),
				scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted'),
				scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED }),
				scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'unknown'),
				scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'),
			];
			for (const candidate of candidates) {
				const receipt = run(candidate);
				assert.equal(isDrillReceipt(receipt), true, `kind '${candidate.kind}' produces a guarded receipt`);
				assert.equal(receipt.citation.length >= 1, true, `kind '${candidate.kind}' cites its acceptance view`);
				assert.equal(receipt.drillLog.length >= 1, true, `kind '${candidate.kind}' discloses its drill log`);
				assert.equal(receipt.passed, true, `kind '${candidate.kind}' matches its honest expectation`);
			}
		});
		test('the six receipts roll up to all-passed with zero unknowns (the honest happy batch)', () => {
			const receipts = [
				run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold')),
				run(scenario('fixture.scenario.retry-schedule', 'retry-schedule', 'retry-schedule-byte-equal')),
				run(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted')),
				run(scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED })),
				run(scenario('fixture.scenario.eligibility-unknown-term', 'eligibility-denial', 'eligibility-term-unknown', { targetId: FIXTURE_SCOPE_UNKNOWN_TERM })),
				run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected')),
			];
			const summary = summaryOf(receipts);
			assert.equal(summary.total, 6);
			assert.equal(summary.passed, 6);
			assert.equal(summary.unknownObserved, 0);
			assert.equal(summary.allPassed, true);
		});
	});

	suite('the receipt field pins (the acceptance evidence shapes)', () => {
		test('the receipt carries its version stamp, kind and verdict fields verbatim', () => {
			const receipt = run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			assert.equal(receipt.contractVersion, INFERENCE_DRILLS_VERSION);
			assert.equal(receipt.scenarioKind, 'cooldown-hold');
			assert.equal(receipt.expected, 'cooldown-hold');
			assert.equal(receipt.observed, 'cooldown-hold');
			assert.equal(receipt.passed, true);
		});
		test('the receipt audit-path disclosure equals the kit auditLedgerPath disclosure', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const receipt = kit.runDrill(scenario('fixture.scenario.failover-walk', 'failover-walk', 'failover-walk-exhausted'));
			assert.equal(receipt.auditLedgerPath, kit.auditLedgerPath());
		});
		test('the admitted scenario output is itself runnable (the walk feeds the kit)', () => {
			const candidate = scenario('fixture.scenario.eligibility-prohibited', 'eligibility-denial', 'eligibility-ineligible', { targetId: FIXTURE_SCOPE_PROHIBITED });
			const receipt = run(candidate);
			assert.equal(receipt.observed, 'eligibility-ineligible');
		});
		test('the cooldown-hold DecisionView stamps the injected seed (one decision, one time)', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold')));
			assert.equal(view.decidedAtEpochMs, FIXTURE_NOW_MS);
		});
		test('the eligibility DecisionView stamps the injected seed (one decision, one time)', () => {
			const view = decisionViewOf(run(scenario('fixture.scenario.eligibility-unknown-term', 'eligibility-denial', 'eligibility-term-unknown', { targetId: FIXTURE_SCOPE_UNKNOWN_TERM })));
			assert.equal(view.decidedAtEpochMs, FIXTURE_NOW_MS);
			assert.deepEqual([...view.reasons], ['term-unknown'], 'the unknown-term verdict rides the view verbatim');
		});
		test('the quota CapacityView carries the derived provenance view (scope label = actual model field)', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', exhaustedSnapshot(FIXTURE_PROVIDER_PERMITTED));
			const receipt = run(scenario('fixture.scenario.quota-exhaustion', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			const capacity = receipt.citation[0].view as { provenance: ProvenanceView };
			assert.equal(isProvenanceView(capacity.provenance), true);
			assert.equal(capacity.provenance.scopeLabel, 'fixture.model.main');
			assert.equal(capacity.provenance.substitution, 'none');
			assert.equal(capacity.provenance.verification, 'unverified');
		});
		test('the quota cooldown-edge fixture maps the breach member honestly and cites the cooldown capacity view', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0] = fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted', {
				...unknownSnapshot(FIXTURE_PROVIDER_PERMITTED, FIXTURE_NOW_MS),
				health: 'cooldown',
				cooldown: {
					state: 'active',
					reason: 'rate-limited',
					sinceEpochMs: FIXTURE_NOW_MS - 60_000,
					untilEpochMs: FIXTURE_NOW_MS + 60_000,
				},
			});
			const receipt = run(scenario('fixture.scenario.quota-cooldown', 'quota-exhaustion', 'quota-exhausted', { catalog }));
			assert.equal(receipt.observed, 'quota-available');
			assert.equal(receipt.passed, false);
			const view = receipt.citation[0].view as { capacityState: string; cooldown: boolean };
			assert.equal(isCapacityView(receipt.citation[0].view), true);
			assert.equal(view.capacityState, 'cooldown');
			assert.equal(view.cooldown, true);
		});
		test('the substitution ProvenanceView rides the unverified-default law', () => {
			const receipt = run(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			const provenance = receipt.citation[0].view as ProvenanceView;
			assert.equal(provenance.verification, 'unverified');
			assert.equal(provenance.recordedAtEpochMs, FIXTURE_NOW_MS);
		});
		test('a scenario carrying the optional matrix surface drills end-to-end', () => {
			const matrix = {
				matrixId: 'fixture.matrix.drills',
				descriptors: [
					{
						modelId: 'fixture.model.main',
						providerEntryId: FIXTURE_PROVIDER_PERMITTED,
						contextWindow: { minTokens: 256, maxTokens: 8192 },
						maxOutputTokens: 1024,
						modalities: ['text-in', 'text-out'],
						contractVersion: INFERENCE_CATALOG_VERSION,
					},
				],
				contractVersion: INFERENCE_CATALOG_VERSION,
			};
			const receipt = run(scenario('fixture.scenario.matrix', 'failover-walk', 'failover-walk-exhausted', { matrix }));
			assert.equal(receipt.observed, 'failover-walk-exhausted');
			assert.equal(receipt.passed, true);
		});
		test('the audit stream grows monotonically across runs (append-only)', () => {
			const kit = createDrillsKit({ now: fixedClock });
			const auditPath = kit.auditLedgerPath();
			const before = auditLines(auditPath).length;
			kit.runDrill(scenario('fixture.scenario.cooldown-hold', 'cooldown-hold', 'cooldown-hold'));
			const middle = auditLines(auditPath).length;
			kit.runDrill(scenario('fixture.scenario.substitution', 'substitution-disclosure', 'substitution-rejected'));
			const after = auditLines(auditPath).length;
			assert.equal(middle > before, true);
			assert.equal(after > middle, true);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in drillsKit.ts is a law-comment line', () => {
			const modulePath = new URL('../../common/drillsKit.ts', import.meta.url).pathname;
			const source = readFileSync(modulePath, 'utf8');
			const hits = source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
		test('every Date.now / Math.random / process.env hit in drillsContract.ts is a law-comment line', () => {
			const modulePath = new URL('../../common/drillsContract.ts', import.meta.url).pathname;
			const source = readFileSync(modulePath, 'utf8');
			const hits = source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
