/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 Free Inference Fabric contracts: the typed deterministic
 * DRILL KIT - the fail-closed factory over the single injected clock,
 * the six failure-scenario drills folding the LANDED kits (the INF-005
 * routing kit's route/runWithFailover paths, the INF-007 isolation
 * kit's checkEligibility, the INF-001 semantics boundary math and
 * honest-promise guard) and rolling every observed verdict up through
 * the LANDED INF-008 presentation projections (the acceptance
 * vocabulary), the receipt assembly with THE ACCEPTANCE-VIEW CITATION,
 * the audit-stream append, and the acceptance roll-up (kit module, the
 * labContracts discipline; binds the landed INF-001..008 family
 * vocabularies verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..008 family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a clock.
 *   Every timestamp comes from the single injected now() function or
 *   from the scenario's injected clock seed. No Date.now, no
 *   Math.random, no process.env ANYWHERE in this module (law comments
 *   excepted) - the determinism ban; same scenario + same injected
 *   clock produces byte-equal receipts INCLUDING the acceptance-view
 *   citations and the audit stream (drills are replayable acceptance
 *   evidence).
 * - THE NO-LIVE-PROVIDER LAW (binding, the family charter): the
 *   'live-provider acceptance' is THE DRILL HARNESS - simulated
 *   provider behavior only, folded through the LANDED kits over
 *   SYNTHETIC fixture-prefixed fixtures. No network, no fetch, no
 *   provider surface, no credential material anywhere in this kit.
 * - THE ACCEPTANCE-VOCABULARY LAW (the v2 binder law, binding): every
 *   drill's observed verdict additionally projects through the LANDED
 *   presentation kit (instantiated over the drill's synthetic fixture
 *   surfaces at the kit's fixture ledgerRoot); the cooldown-hold /
 *   failover-walk / eligibility-denial drills cite their DecisionView
 *   (the selected|refused side + the typed refusal reason verbatim),
 *   the quota-exhaustion drill cites its CapacityView, the
 *   substitution-disclosure drill cites its ProvenanceView
 *   (substitution labels derived, never caller-supplied), and any
 *   reset expectation cites its ResetExpectationView (the stale-reset
 *   'unknown' projection carried AS unknown, never coerced). A
 *   projection that refuses over the admitted fixture surfaces is a
 *   drift - the fail-closed TypeError carries the LANDED
 *   PRESENTATION_REJECTION_REASONS member verbatim, never re-worded,
 *   never silent.
 * - THE AUDIT-STREAM LAW (v2, binding): each runDrill appends the
 *   projected views to the presentation kit's delivery-evidence
 *   stream (recordViewAudit under the kit's fixture ledgerRoot - the
 *   presentation-audits.jsonl ledger); the receipt discloses the
 *   ledger path; the audit lines are the LANDED
 *   serializePresentationRecord bytes.
 * - THE HONEST-VERDICT-MAPPING LAW (binding): the observed verdict is
 *   the honest mapping of the fold's outcome onto the closed
 *   DRILL_VERDICT_FAMILIES vocabulary - a landed honest-unknown state
 *   (the unknown capacity state, the unknown-term verdict) maps AS
 *   'unknown', never coerced to a held verdict, and a drilled law
 *   that does not hold maps onto its breach member, never a silent
 *   pass.
 * - THE DRIFT FAIL-CLOSED LAW (binding): the kit's own receipt must
 *   satisfy isDrillReceipt; a re-admission or projection refusal over
 *   the admitted fixture surfaces is a fail-closed TypeError carrying
 *   the landed reason verbatim.
 * - Zero external dependencies: node: builtins (fs/os/path for the
 *   bounded fixture-ledger-root creation) and the landed sibling
 *   families only.
 */
import { mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DRILL_FOLDS,
	INFERENCE_DRILLS_VERSION,
	admitDrillReceipt,
	admitDrillScenario,
	isDrillReceipt,
	serializeDrillReceipt,
} from './drillsContract.js';
export { INFERENCE_DRILLS_VERSION } from './drillsContract.js';
import type {
	DrillCitedView,
	DrillFold,
	DrillLogEntry,
	DrillReceipt,
	DrillScenario,
	DrillVerdictFamily,
} from './drillsContract.js';
import {
	cooldownActive,
	projectCapacityDisclosure,
	quotaWindowContains,
	unverifiedProvenance,
} from '../../semantics/common/capacityDisclosure.js';
import { FLAUZ_PRODUCT_PROMISE, INFERENCE_SEMANTICS_CONTRACTS_VERSION, admitHonestPromise } from '../../semantics/common/planSemantics.js';
import { admitProviderAdapterRecord, reportAdapterSnapshot } from '../../adapters/common/providerAdapter.js';
import type { AdapterObservation, ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { createRoutingKit } from '../../routing/common/routingKit.js';
import type { RoutingKit } from '../../routing/common/routingKit.js';
import { ROUTING_ATTEMPT_OUTCOMES } from '../../routing/common/routingContract.js';
import type { FailoverOutcome, RetryPolicy, RoutingOutcome } from '../../routing/common/routingContract.js';
import { createIsolationKit } from '../../isolation/common/isolationKit.js';
import type { EligibilityDecisionRecord } from '../../isolation/common/isolationContract.js';
import { PRESENTATION_AUDITS_LEDGER_FILE, createPresentationKit } from '../../presentation/common/presentationKit.js';
import type { PresentationKit } from '../../presentation/common/presentationKit.js';
import { serializePresentationRecord } from '../../presentation/common/presentationContract.js';
import type { CapacityView, DecisionView, ProvenanceView } from '../../presentation/common/presentationContract.js';

/** One roll-up row of the acceptance summary. */
export interface DrillSummaryRow {
	readonly scenarioId: string;
	readonly scenarioKind: DrillScenario['kind'];
	readonly expected: DrillVerdictFamily;
	readonly observed: DrillVerdictFamily;
	readonly passed: boolean;
	readonly unknownObserved: boolean;
}

/**
 * The acceptance roll-up over a batch of receipts: pass/fail per
 * receipt plus the honest-unknown count (an UNKNOWN observed verdict
 * is a first-class drill outcome, never coerced to pass - it is
 * counted here AND in the pass/fail columns exactly as the
 * expected/observed comparison decides).
 */
export interface DrillSummary {
	readonly contractVersion: string;
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly unknownObserved: number;
	readonly allPassed: boolean;
	readonly rows: readonly DrillSummaryRow[];
}

/**
 * The deterministic drill kit: the six failure-scenario drills over
 * the LANDED kits, the receipt assembly with the acceptance-view
 * citation and the audit-stream append, and the acceptance roll-up.
 * Pure vocabulary over injected values plus the one bounded
 * fixture-ledger surface: no network, no clock reading, no
 * randomness, no credential material, no live provider calls.
 */
export interface DrillsKit {
	runDrill(scenario: unknown): DrillReceipt;
	drillSummary(receipts: unknown): DrillSummary;
	auditLedgerPath(): string;
}

/** The kit's fixed fixture-ledger-root name under os.tmpdir() (the kit never invents ids, only this fixed fixture location). */
const DRILLS_FIXTURE_LEDGER_ROOT_NAME = 'flauz-drills-audit-fixture';

/** The fixture model scope labels the drill-derived provenances carry (SYNTHETIC, fixture-prefixed, never authority values). */
const FIXTURE_MODEL_MAIN = 'fixture.model.main';
const FIXTURE_MODEL_REQUESTED = 'fixture.model.requested';
const FIXTURE_MODEL_ACTUAL = 'fixture.model.actual';

/** The fixture observation numbers (SYNTHETIC; the drills' simulated provider behavior). */
const FIXTURE_QUOTA_REMAINING = 42;
const FIXTURE_QUOTA_LIMIT = 60;
const FIXTURE_WINDOW_HALF_MS = 60_000;
const FIXTURE_RETRY_BACKOFF_MS = 15_000;

/** One drill fold's honest output: the observed verdict, the disclosed log, the projected acceptance views. */
interface DrillFoldResult {
	readonly observed: DrillVerdictFamily;
	readonly drillLog: readonly DrillLogEntry[];
	readonly views: readonly unknown[];
}

/**
 * Creates a drill kit (fail-closed factory). Validation order is
 * deterministic: the options shape (now must be a function), ONE read
 * of the injected clock to validate it can produce a finite number,
 * and the fixture ledger root (created under os.tmpdir() at the fixed
 * fixture name - an existing directory, the presentation kit's audit
 * ledger lives inside it). The kit owns no scenario state: every
 * runDrill folds its scenario's fixture surfaces fresh.
 */
export function createDrillsKit(options: { readonly now: () => number }): DrillsKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createDrillsKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const now = (options as { readonly now: () => number }).now;
	if (!isFiniteEpochMs(now())) {
		throw new TypeError(
			'createDrillsKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
		);
	}
	const fixtureRoot = join(tmpdir(), DRILLS_FIXTURE_LEDGER_ROOT_NAME);
	try {
		mkdirSync(fixtureRoot, { recursive: true });
	} catch (error) {
		throw new TypeError(
			`createDrillsKit: the fixture ledger root '${fixtureRoot}' could not be created: ${String(error)} - the audit-stream law needs the directory the presentation-audits.jsonl ledger lives in`,
		);
	}
	const rootStats = statSync(fixtureRoot, { throwIfNoEntry: false });
	if (rootStats === undefined || !rootStats.isDirectory()) {
		throw new TypeError(
			`createDrillsKit: the fixture ledger root '${fixtureRoot}' must be an existing directory (the audit-stream law)`,
		);
	}
	const auditLedgerPath = join(fixtureRoot, PRESENTATION_AUDITS_LEDGER_FILE);

	const kit: DrillsKit = {
		runDrill(scenario: unknown): DrillReceipt {
			const admission = admitDrillScenario(scenario);
			if (!admission.admitted) {
				throw new TypeError(
					`runDrill: the scenario must satisfy admitDrillScenario: '${admission.reason}': ${admission.detail}`,
				);
			}
			const drill = admission.scenario;
			// THE ACCEPTANCE-VOCABULARY LAW: the LANDED presentation kit,
			// instantiated over the drill's synthetic fixture surfaces at the
			// kit's fixture ledgerRoot - the acceptance fold every observed
			// verdict projects through.
			const presentation = createPresentationKit({
				now,
				catalog: drill.catalog,
				adapters: drill.adapters,
				scopes: drill.scopes,
				ledgerRoot: fixtureRoot,
			});
			const fold = runDrillFold(drill, presentation, now, fixtureRoot);
			const citation: DrillCitedView[] = [];
			for (const view of fold.views) {
				// THE AUDIT-STREAM LAW: each runDrill appends the projected views
				// to the presentation kit's delivery-evidence stream; the audit
				// lines are the LANDED serializePresentationRecord bytes.
				presentation.recordViewAudit(view);
				citation.push({ view: view as DrillCitedView['view'], canonicalBytes: serializePresentationRecord(view) });
			}
			const receipt: DrillReceipt = {
				contractVersion: INFERENCE_DRILLS_VERSION,
				scenarioId: drill.scenarioId,
				scenarioKind: drill.kind,
				expected: drill.expected,
				observed: fold.observed,
				passed: fold.observed === drill.expected,
				drillLog: fold.drillLog,
				citation,
				auditLedgerPath,
			};
			if (!isDrillReceipt(receipt)) {
				throw new TypeError(
					'runDrill: the produced receipt must satisfy isDrillReceipt (the drift fails closed - an empty acceptance-view citation is never a valid receipt)',
				);
			}
			return receipt;
		},
		drillSummary(receipts: unknown): DrillSummary {
			if (!Array.isArray(receipts)) {
				throw new TypeError('drillSummary: receipts must be an array of drill receipts');
			}
			const rows: DrillSummaryRow[] = [];
			for (const candidate of receipts) {
				const receiptAdmission = admitDrillReceipt(candidate);
				if (!receiptAdmission.admitted) {
					throw new TypeError(
						`drillSummary: every row must satisfy admitDrillReceipt: '${receiptAdmission.reason}': ${receiptAdmission.detail} - no dishonest receipt ever enters the roll-up`,
					);
				}
				const receipt = receiptAdmission.receipt;
				rows.push({
					scenarioId: receipt.scenarioId,
					scenarioKind: receipt.scenarioKind,
					expected: receipt.expected,
					observed: receipt.observed,
					passed: receipt.passed,
					unknownObserved: receipt.observed === 'unknown',
				});
			}
			const passed = rows.filter((row) => row.passed).length;
			return {
				contractVersion: INFERENCE_DRILLS_VERSION,
				total: rows.length,
				passed,
				failed: rows.length - passed,
				unknownObserved: rows.filter((row) => row.unknownObserved).length,
				allPassed: rows.length > 0 && passed === rows.length,
				rows,
			};
		},
		auditLedgerPath(): string {
			return auditLedgerPath;
		},
	};
	return kit;
}

/** The drill dispatch: one honest fold per closed scenario kind. */
function runDrillFold(
	drill: DrillScenario,
	presentation: PresentationKit,
	now: () => number,
	fixtureRoot: string,
): DrillFoldResult {
	switch (drill.kind) {
		case 'cooldown-hold':
			return runCooldownHoldDrill(drill, presentation, now);
		case 'retry-schedule':
			return runRetryScheduleDrill(drill, presentation, now);
		case 'failover-walk':
			return runFailoverWalkDrill(drill, presentation, now);
		case 'eligibility-denial':
			return runEligibilityDenialDrill(drill, presentation, now, fixtureRoot);
		case 'quota-exhaustion':
			return runQuotaExhaustionDrill(drill, presentation, now);
		case 'substitution-disclosure':
			return runSubstitutionDisclosureDrill(drill, presentation, now);
	}
}

/**
 * THE COOLDOWN-HOLD DRILL: walks the LANDED routing kit's route path
 * over candidates under active cooldown - the hold trips
 * (skipped-cooldown, the exhausted terminal) or the drilled law does
 * not hold (the breach member). Cites its DecisionView (the refused
 * side + the typed refusal reason verbatim; the breach cites the
 * selected side's decision view).
 */
function runCooldownHoldDrill(drill: DrillScenario, presentation: PresentationKit, now: () => number): DrillFoldResult {
	const adapters = adapterRecordFor(drill);
	const routing = createRoutingKit({ now, adapters: drill.adapters, catalog: drill.catalog });
	addRoutingCandidates(routing, adapters, cooldownObservationAt(drill.clockSeed));
	const outcome = routing.route({ at: drill.clockSeed });
	// The honest log: every exercised fold's LANDED verdict verbatim - the
	// per-candidate attempt outcomes when the ledger carries them, the
	// landed outcome kind itself when the honest ledger is empty (the
	// zero-candidate exhausted terminal is the fold's own decision kind).
	const drillLog: DrillLogEntry[] =
		outcome.attemptLedger.length > 0
			? outcome.attemptLedger.map((entry) => ({
					fold: 'route' as DrillFold,
					verdict: entry.outcome,
				}))
			: [{ fold: 'route', verdict: outcome.kind }];
	if (outcome.kind === 'exhausted') {
		const held = outcome.attemptLedger.some((entry) => entry.outcome === 'skipped-cooldown');
		return {
			observed: held ? 'cooldown-hold' : 'unknown',
			drillLog,
			views: [projectDecisionOrThrow(presentation, outcome)],
		};
	}
	if (outcome.kind === 'selected') {
		return {
			observed: 'cooldown-breach',
			drillLog,
			views: [projectDecisionOrThrow(presentation, outcome.decision)],
		};
	}
	return { observed: 'unknown', drillLog, views: [] };
}

/**
 * THE RETRY-SCHEDULE DRILL: asserts deterministic scheduling
 * byte-equality across two failover runs over fresh kits with ONE
 * injected clock - the failed thunk walks the retry schedule to the
 * exhausted terminal twice, and the two outcomes must be byte-equal.
 * Cites the first run's DecisionView (the refused side + the typed
 * refusal reason verbatim).
 */
function runRetryScheduleDrill(drill: DrillScenario, presentation: PresentationKit, now: () => number): DrillFoldResult {
	const adapters = adapterRecordFor(drill);
	const policy: RetryPolicy = { maxAttempts: 2, backoffScheduleMs: [FIXTURE_RETRY_BACKOFF_MS] };
	const routingA = createRoutingKit({ now, adapters: drill.adapters, catalog: drill.catalog });
	addRoutingCandidates(routingA, adapters, healthyObservationAt(drill.clockSeed));
	const runA = routingA.runWithFailover({
		attempt: () => 'failed' as const,
		policy,
		at: drill.clockSeed,
	});
	const routingB = createRoutingKit({ now, adapters: drill.adapters, catalog: drill.catalog });
	addRoutingCandidates(routingB, adapters, healthyObservationAt(drill.clockSeed));
	const runB = routingB.runWithFailover({
		attempt: () => 'failed' as const,
		policy,
		at: drill.clockSeed,
	});
	const drillLog: DrillLogEntry[] = [...foldFailoverLog(runA), ...foldFailoverLog(runB)];
	const observed: DrillVerdictFamily =
		JSON.stringify(runA) === JSON.stringify(runB) ? 'retry-schedule-byte-equal' : 'retry-schedule-diverged';
	return { observed, drillLog, views: [failoverBreachOrDecisionView(presentation, runA, adapters, drill.clockSeed)] };
}

/**
 * THE FAILOVER-WALK DRILL: walks the ordered alternates to the
 * no-route terminal - every ledger outcome is a LANDED
 * ROUTING_ATTEMPT_OUTCOMES member (cited verbatim), the walk ends
 * exhausted, or the drilled law does not hold (the breach member).
 * Cites its DecisionView (the refused side + the typed refusal
 * reason verbatim).
 */
function runFailoverWalkDrill(drill: DrillScenario, presentation: PresentationKit, now: () => number): DrillFoldResult {
	const adapters = adapterRecordFor(drill);
	const routing = createRoutingKit({ now, adapters: drill.adapters, catalog: drill.catalog });
	addRoutingCandidates(routing, adapters, healthyObservationAt(drill.clockSeed));
	const outcome = routing.runWithFailover({
		attempt: () => 'failed' as const,
		policy: { maxAttempts: 1, backoffScheduleMs: [] },
		at: drill.clockSeed,
	});
	const drillLog = foldFailoverLog(outcome);
	if (outcome.kind === 'exhausted') {
		const landedOutcomes = outcome.attemptLedger.every((entry) =>
			(ROUTING_ATTEMPT_OUTCOMES as readonly string[]).includes(entry.outcome),
		);
		const attempted = outcome.attemptLedger.some((entry) => entry.outcome === 'attempted-failed');
		return {
			observed: landedOutcomes && attempted ? 'failover-walk-exhausted' : 'unknown',
			drillLog,
			views: [projectDecisionOrThrow(presentation, outcome)],
		};
	}
	if (outcome.kind === 'succeeded') {
		return {
			observed: 'failover-walk-selected',
			drillLog,
			views: [breachCapacityView(presentation, adapters, outcome.adapterId, drill.clockSeed)],
		};
	}
	return { observed: 'unknown', drillLog, views: [] };
}

/**
 * THE ELIGIBILITY-DENIAL DRILL: drives the LANDED isolation kit's
 * checkEligibility over the scenario's fixture target scope with the
 * drill's own product-inference usage class - the prohibited scope's
 * verdict is 'ineligible', the unknown-term scope's verdict is
 * 'term-unknown' (the honest-unknown law), each carried verbatim.
 * Cites its DecisionView (the decided disclosure's verdict verbatim;
 * the typed refusal side when the fold refuses).
 */
function runEligibilityDenialDrill(
	drill: DrillScenario,
	presentation: PresentationKit,
	now: () => number,
	fixtureRoot: string,
): DrillFoldResult {
	const isolation = createIsolationKit({
		now,
		adapters: drill.adapters,
		catalog: drill.catalog,
		ledgerRoot: fixtureRoot,
	});
	for (const scope of adapterScopesRecordFor(drill).scopes) {
		const registration = isolation.register({ id: scope.id, adapterId: scope.adapterId, handleRef: scope.handleRef });
		if (!registration.admitted) {
			throw new TypeError(
				`runDrill: the fixture scope '${scope.id}' must register through the LANDED isolation kit: '${registration.reason}': ${registration.detail} - a re-admitted fixture scope is never rejected (the drift fails closed)`,
			);
		}
	}
	const decision: EligibilityDecisionRecord = isolation.checkEligibility(drill.targetId, 'product-inference');
	const drillLog: DrillLogEntry[] = [
		{ fold: 'checkEligibility', verdict: decision.kind === 'decided' ? decision.verdict : decision.kind },
	];
	let observed: DrillVerdictFamily;
	if (decision.kind === 'decided') {
		if (decision.verdict === 'ineligible') {
			observed = 'eligibility-ineligible';
		} else if (decision.verdict === 'term-unknown') {
			observed = 'eligibility-term-unknown';
		} else {
			observed = 'eligibility-eligible';
		}
	} else {
		observed = 'unknown';
	}
	return { observed, drillLog, views: [projectDecisionOrThrow(presentation, decision)] };
}

/**
 * THE QUOTA-EXHAUSTION DRILL: folds the LANDED boundary math at the
 * exhausted edge over the fixture catalog's first entry snapshot -
 * the inclusive quota window, the cooldown gate, and the disclosure
 * projection. The exhausted edge maps 'quota-exhausted'; a landed
 * honest-unknown state maps AS 'unknown' (never coerced); any other
 * disclosed state maps the breach member. Cites its CapacityView and
 * the snapshot reset schedule's ResetExpectationView (the stale-reset
 * 'unknown' projection carried AS unknown, never coerced).
 */
function runQuotaExhaustionDrill(drill: DrillScenario, presentation: PresentationKit, now: () => number): DrillFoldResult {
	const snapshot = firstCatalogEntryFor(drill).capacitySnapshot;
	const drillLog: DrillLogEntry[] = [];
	if (snapshot.quota.state === 'known') {
		drillLog.push({
			fold: 'quotaWindowContains',
			verdict: String(quotaWindowContains(snapshot.quota.window, drill.clockSeed)),
		});
	}
	drillLog.push({ fold: 'cooldownActive', verdict: String(cooldownActive(snapshot.cooldown, drill.clockSeed)) });
	const provenance = unverifiedProvenance({
		requestedProviderId: snapshot.providerId,
		requestedModelId: FIXTURE_MODEL_MAIN,
		actualProviderId: snapshot.providerId,
		actualModelId: FIXTURE_MODEL_MAIN,
		recordedAtEpochMs: drill.clockSeed,
	});
	const disclosureOutcome = projectCapacityDisclosure(snapshot, provenance, drill.clockSeed);
	if (!disclosureOutcome.disclosed) {
		throw new TypeError(
			`runDrill: the LANDED disclosure projection refused the fixture snapshot: '${disclosureOutcome.reason}': ${disclosureOutcome.detail} - a projection refusal over the admitted fixture surfaces is a drift, never a silent pass`,
		);
	}
	drillLog.push({ fold: 'projectCapacityDisclosure', verdict: disclosureOutcome.disclosure.capacityState });
	const observed: DrillVerdictFamily =
		disclosureOutcome.disclosure.capacityState === 'exhausted'
			? 'quota-exhausted'
			: disclosureOutcome.disclosure.capacityState === 'unknown'
				? 'unknown'
				: 'quota-available';
	const views: unknown[] = [projectCapacityOrThrow(presentation, disclosureOutcome.disclosure)];
	views.push(presentation.projectReset(snapshot.resetSchedule));
	return { observed, drillLog, views };
}

/**
 * THE SUBSTITUTION-DISCLOSURE DRILL: drives the LANDED honest-promise
 * guard (admitHonestPromise) with the dishonest fixture - the
 * unlimited-provider-capacity lie is rejected verbatim - and cites
 * the drill's derived ProvenanceView (the substitution label derived
 * by the LANDED unverifiedProvenance constructor, never
 * caller-supplied).
 */
function runSubstitutionDisclosureDrill(
	drill: DrillScenario,
	presentation: PresentationKit,
	now: () => number,
): DrillFoldResult {
	const dishonestFixture = {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		planId: 'fixture.plan.main',
		tier: 'free' as const,
		productPromise: FLAUZ_PRODUCT_PROMISE,
		providerCapacityClaim: {
			promiseSide: 'provider-side' as const,
			subject: 'provider-capacity' as const,
			guarantee: 'unlimited' as const,
			capacityProvenance: 'third-party-free-tier' as const,
		},
	};
	const admission = admitHonestPromise(dishonestFixture);
	const drillLog: DrillLogEntry[] = [
		{ fold: 'admitHonestPromise', verdict: admission.honest ? 'honest' : admission.reason },
	];
	const derived = unverifiedProvenance({
		requestedProviderId: firstCatalogEntryFor(drill).entryId,
		requestedModelId: FIXTURE_MODEL_REQUESTED,
		actualProviderId: firstCatalogEntryFor(drill).entryId,
		actualModelId: FIXTURE_MODEL_ACTUAL,
		recordedAtEpochMs: drill.clockSeed,
	});
	drillLog.push({ fold: 'unverifiedProvenance', verdict: derived.substitution });
	let observed: DrillVerdictFamily;
	if (!admission.honest && admission.reason === 'unlimited-provider-capacity') {
		observed = 'substitution-rejected';
	} else if (admission.honest) {
		observed = 'substitution-admitted';
	} else {
		observed = 'unknown';
	}
	return { observed, drillLog, views: [projectProvenanceOrThrow(presentation, derived)] };
}

/** The fixture adapter record re-fold (deterministic; fail-closed on drift). */
function adapterRecordFor(drill: DrillScenario): ProviderAdapterRecord {
	const admission = admitProviderAdapterRecord(drill.adapters, drill.catalog);
	if (!admission.admitted) {
		throw new TypeError(
			`runDrill: the fixture adapter record must satisfy admitProviderAdapterRecord: '${admission.reason}': ${admission.detail}`,
		);
	}
	return admission.record;
}

/** The fixture scope set re-fold through the LANDED guard (deterministic; fail-closed on drift). */
function adapterScopesRecordFor(drill: DrillScenario): { readonly scopes: readonly { readonly id: string; readonly adapterId: string; readonly handleRef: string }[] } {
	// The scopes were admitted by admitDrillScenario; the drill
	// registers the admitted triples verbatim (re-derive through the
	// landed set guard is the deterministic re-fold).
	const scopeSet = drill.scopes as { readonly scopes?: unknown };
	if (!isRecord(scopeSet) || !Array.isArray(scopeSet.scopes)) {
		throw new TypeError('runDrill: the fixture scope set must carry its scopes array (the drift fails closed)');
	}
	return scopeSet as { readonly scopes: readonly { readonly id: string; readonly adapterId: string; readonly handleRef: string }[] };
}

/** The fixture catalog's first entry re-fold (deterministic; fail-closed on drift). */
function firstCatalogEntryFor(drill: DrillScenario): { readonly entryId: string; readonly capacitySnapshot: Parameters<typeof projectCapacityDisclosure>[0] } {
	const catalogRecord = drill.catalog as { readonly entries?: unknown };
	if (!isRecord(catalogRecord) || !Array.isArray(catalogRecord.entries) || catalogRecord.entries.length === 0) {
		throw new TypeError('runDrill: the fixture catalog must carry at least one entry (the drift fails closed)');
	}
	return catalogRecord.entries[0] as { readonly entryId: string; readonly capacitySnapshot: Parameters<typeof projectCapacityDisclosure>[0] };
}

/** Adds one candidate per fixture adapter, each reporting the given observation with the drill's derived provenance. */
function addRoutingCandidates(kit: RoutingKit, adapters: ProviderAdapterRecord, observation: AdapterObservation): void {
	for (const adapter of adapters.adapters) {
		const report = reportAdapterSnapshot(adapter, observation, {
			requestedProviderId: adapter.providerEntryId,
			requestedModelId: FIXTURE_MODEL_MAIN,
			actualProviderId: adapter.providerEntryId,
			actualModelId: FIXTURE_MODEL_MAIN,
			recordedAtEpochMs: observation.observedAtEpochMs,
		});
		const admission = kit.addCandidate({ adapterId: adapter.adapterId, report });
		if (!admission.admitted) {
			throw new TypeError(
				`runDrill: the fixture candidate '${adapter.adapterId}' must admit through the LANDED routing kit: '${admission.reason}': ${admission.detail} - a re-derived fixture candidate is never rejected (the drift fails closed)`,
			);
		}
	}
}

/** The failover outcome's honest ledger log (every fold the run exercised, the attempt outcomes verbatim; the landed outcome kind when the honest ledger is empty). */
function foldFailoverLog(outcome: FailoverOutcome): DrillLogEntry[] {
	if (outcome.kind === 'rejected') {
		return [{ fold: 'runWithFailover', verdict: outcome.reason }];
	}
	if (outcome.attemptLedger.length === 0) {
		return [{ fold: 'runWithFailover', verdict: outcome.kind }];
	}
	return outcome.attemptLedger.map((entry) => ({ fold: 'runWithFailover' as DrillFold, verdict: entry.outcome }));
}

/** The retry/failover drill's citation: the exhausted terminal's DecisionView, or the breach candidate's CapacityView. */
function failoverBreachOrDecisionView(
	presentation: PresentationKit,
	outcome: FailoverOutcome,
	adapters: ProviderAdapterRecord,
	at: number,
): unknown {
	if (outcome.kind === 'exhausted') {
		return projectDecisionOrThrow(presentation, outcome);
	}
	if (outcome.kind === 'succeeded') {
		return breachCapacityView(presentation, adapters, outcome.adapterId, at);
	}
	throw new TypeError(
		`runDrill: the LANDED failover run rejected its drill policy: '${outcome.reason}': ${outcome.detail} - the drill's own policy is well-formed, never a silent skip`,
	);
}

/** The breach citation: the breach candidate's disclosed capacity view (the drill's own fixture state, projected). */
function breachCapacityView(
	presentation: PresentationKit,
	adapters: ProviderAdapterRecord,
	adapterId: string,
	at: number,
): CapacityView {
	const adapter = adapters.adapters.find((entry) => entry.adapterId === adapterId);
	if (adapter === undefined) {
		throw new TypeError(
			`runDrill: the breach candidate '${adapterId}' must resolve in the fixture adapter record - never a dangling ref`,
		);
	}
	const report = reportAdapterSnapshot(adapter, healthyObservationAt(at), {
		requestedProviderId: adapter.providerEntryId,
		requestedModelId: FIXTURE_MODEL_MAIN,
		actualProviderId: adapter.providerEntryId,
		actualModelId: FIXTURE_MODEL_MAIN,
		recordedAtEpochMs: at,
	});
	const provenance = unverifiedProvenance({
		requestedProviderId: adapter.providerEntryId,
		requestedModelId: FIXTURE_MODEL_MAIN,
		actualProviderId: adapter.providerEntryId,
		actualModelId: FIXTURE_MODEL_MAIN,
		recordedAtEpochMs: at,
	});
	const disclosure = projectCapacityDisclosure(report.snapshot, provenance, at);
	if (!disclosure.disclosed) {
		throw new TypeError(
			`runDrill: the LANDED disclosure projection refused the breach candidate: '${disclosure.reason}': ${disclosure.detail}`,
		);
	}
	return projectCapacityOrThrow(presentation, disclosure.disclosure);
}

/** The LANDED decision projection with the drift fail-closed (the landed refusal reason verbatim). */
function projectDecisionOrThrow(presentation: PresentationKit, outcome: unknown): DecisionView {
	const projected = presentation.projectDecision(outcome);
	if (!projected.projected) {
		throw new TypeError(
			`runDrill: the LANDED decision projection refused the drill's outcome: '${projected.reason}': ${projected.detail} - a projection refusal over the admitted fixture surfaces is a drift, never a silent pass`,
		);
	}
	return projected.view;
}

/** The LANDED capacity projection with the drift fail-closed (the landed refusal reason verbatim). */
function projectCapacityOrThrow(presentation: PresentationKit, disclosure: unknown): CapacityView {
	const projected = presentation.projectCapacity(disclosure);
	if (!projected.projected) {
		throw new TypeError(
			`runDrill: the LANDED capacity projection refused the drill's disclosure: '${projected.reason}': ${projected.detail} - a projection refusal over the admitted fixture surfaces is a drift, never a silent pass`,
		);
	}
	return projected.view;
}

/** The LANDED provenance projection with the drift fail-closed (the landed refusal reason verbatim). */
function projectProvenanceOrThrow(presentation: PresentationKit, provenance: unknown): ProvenanceView {
	const projected = presentation.projectProvenance(provenance);
	if (!projected.projected) {
		throw new TypeError(
			`runDrill: the LANDED provenance projection refused the drill's record: '${projected.reason}': ${projected.detail} - a projection refusal over the admitted fixture surfaces is a drift, never a silent pass`,
		);
	}
	return projected.view;
}

/** The fixture healthy observation (the simulated provider behavior: known quota, no cooldown, unknown reset). */
function healthyObservationAt(at: number): AdapterObservation {
	return {
		observedAtEpochMs: at,
		health: 'healthy',
		quota: {
			state: 'known',
			remaining: FIXTURE_QUOTA_REMAINING,
			limit: FIXTURE_QUOTA_LIMIT,
			window: {
				kind: 'fixed',
				windowStartEpochMs: at - FIXTURE_WINDOW_HALF_MS,
				windowLengthMs: 2 * FIXTURE_WINDOW_HALF_MS,
			},
		},
		cooldown: { state: 'none' },
		reset: { kind: 'unknown' },
	};
}

/** The fixture cooldown observation (the simulated provider behavior: the active cooldown the hold drill trips). */
function cooldownObservationAt(at: number): AdapterObservation {
	return {
		...healthyObservationAt(at),
		health: 'cooldown',
		cooldown: {
			state: 'active',
			reason: 'rate-limited',
			sinceEpochMs: at - FIXTURE_WINDOW_HALF_MS,
			untilEpochMs: at + FIXTURE_WINDOW_HALF_MS,
		},
	};
}

function isFiniteEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
