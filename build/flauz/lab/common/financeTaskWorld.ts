/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * THE FINANCE INDUSTRY TASK-WORLD FIXTURE (DH residue wave 1 / GAP-1): the finance member of
 * the three industry task-worlds for the LAB-003 fixture lane, composed exactly like the landed
 * SE fixture world (world-se-fixtures): three scenarios, each backed by a curated fragment bank
 * (openers / evidenceFragments / constraints / deliverables / acceptanceCriteria) over a fixed
 * synthetic 24-path context layout and a fixed 8-kind obstacle table.
 *
 * THE CONTENT DISCLOSURE (binding): this is a CURATED FIXTURE-LEVEL task-world content set -
 * representative, deliberately modest, honestly labeled; NOT a claim of comprehensive domain
 * truth, NOT promoted evidence. The scenario shapes are real finance-operations work shapes
 * (reconciliation discrepancy investigation, regulatory-report validation, payment-failure
 * triage) rendered as curated fixture content over a synthetic layout.
 *
 * THE COMPOSITION-NOT-FORK LAW: this module is PURE DATA - it exports ONLY the frozen fixture
 * (no functions, no code paths). The generation engine is the REAL LAB-003 machinery: the
 * extension module (industryTaskWorlds.ts) imports the REAL generateInstance and drives it
 * with this data - the industries differ only in data.
 *
 * DETERMINISM LAW: this module never calls Math.random, Date.now or `new Date()`, and never
 * reads process.env; it is a frozen data record, so every generated instance stays a pure
 * function of (scenarioId, seed, instanceIndex) through the shared engine.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type TaskScenario } from './labContracts.js';
import { LAB_FIXTURE_SCOPE, type ScenarioBanks, type TaskWorldDescriptor } from './taskWorlds.js';

/** World identity of the finance fixture task-world. */
export const FINANCE_WORLD_ID = 'world-finance-fixtures';

// The fixed 24-path synthetic finance-operations layout context files are drawn from.
export const FINANCE_CONTEXT_PATHS: readonly string[] = [
	'finance/ledger/daily_positions.csv',
	'finance/ledger/subledger_entries.csv',
	'finance/ledger/accounting_periods.json',
	'finance/reconciliation/break_report.csv',
	'finance/reconciliation/matcher_config.yaml',
	'finance/reconciliation/exception_queue.csv',
	'finance/reconciliation/nostro_breaks.csv',
	'finance/reporting/regulatory_report_template.json',
	'finance/reporting/report_generation.sql',
	'finance/reporting/submission_log.csv',
	'finance/reporting/validation_rules.yaml',
	'finance/payments/payment_events.csv',
	'finance/payments/failure_codes.yaml',
	'finance/payments/retry_policy.json',
	'finance/payments/routing_table.yaml',
	'finance/payments/cutoff_schedule.json',
	'finance/settlement/settlement_batches.csv',
	'finance/settlement/daily_cash_sheet.csv',
	'finance/treasury/counterparty_limits.yaml',
	'finance/treasury/positions_feed.csv',
	'finance/controls/sox_controls_matrix.yaml',
	'finance/controls/access_review_log.csv',
	'finance/data/etl_pipeline_config.yaml',
	'finance/data/quality_gates.json',
];

/** The fixed 8-kind finance obstacle table. */
export const FINANCE_OBSTACLE_KINDS: readonly string[] = [
	'ambiguous-break-source',
	'stale-reference-data',
	'cross-system-latency',
	'incomplete-audit-trail',
	'conflicting-reporting-rules',
	'counterparty-data-gap',
	'manual-override-history',
	'high-volume-window',
];

const SCENARIO_FINANCE_RECONCILIATION_DISCREPANCY: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-finance-reconciliation-discrepancy',
	worldId: FINANCE_WORLD_ID,
	taskTypeId: 'tt-reconciliation-discrepancy-diff-inspection',
	name: 'Finance fixture: reconciliation discrepancy investigation',
	description: 'Investigate a seeded reconciliation break between the subledger and the general ledger and close it with correcting entries and evidence.',
	difficultyBase: 0.5,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_FINANCE_REGULATORY_REPORT_VALIDATION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-finance-regulatory-report-validation',
	worldId: FINANCE_WORLD_ID,
	taskTypeId: 'tt-regulatory-report-validation-review',
	name: 'Finance fixture: regulatory report validation',
	description: 'Validate a prepared regulatory report against the pinned rule set and resolve every failing edit before the submission window closes.',
	difficultyBase: 0.55,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_FINANCE_PAYMENT_FAILURE_TRIAGE: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-finance-payment-failure-triage',
	worldId: FINANCE_WORLD_ID,
	taskTypeId: 'tt-payment-failure-triage-runtime-check',
	name: 'Finance fixture: payment failure triage',
	description: 'Triage a cluster of failed payments into failure classes and disposition every stuck item within the documented retry budget.',
	difficultyBase: 0.45,
	instanceCount: 6,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance'],
};

/** The three finance fixture scenarios. */
export const FINANCE_TASK_SCENARIOS: TaskScenario[] = [
	SCENARIO_FINANCE_RECONCILIATION_DISCREPANCY,
	SCENARIO_FINANCE_REGULATORY_REPORT_VALIDATION,
	SCENARIO_FINANCE_PAYMENT_FAILURE_TRIAGE,
];

/** The finance scenario fragment banks (openers / evidence fragments / constraints / deliverables / acceptance criteria). */
export const FINANCE_SCENARIO_BANKS: ReadonlyMap<string, ScenarioBanks> = new Map<string, ScenarioBanks>([
	['scenario-finance-reconciliation-discrepancy', {
		openers: [
			'The daily reconciliation run surfaced an unexplained break between the subledger and the general ledger.',
			'A break report flagged a discrepancy above the tolerance threshold for the period close.',
			'Finance operations escalated a recurring mismatch on the nostro reconciliation lane.',
			'The month-end close is blocked by an unresolved reconciliation discrepancy.',
			'An auditor query turned up a reconciliation difference that predates the current period.',
		],
		evidenceFragments: [
			'Symptom: the break amount is exactly three times a single settlement batch value.',
			'Symptom: the discrepancy appears only on days when the cutoff schedule slips past midnight.',
			'Symptom: one counterparty statement shows a value date shifted by one business day.',
			'Symptom: the matcher reports unreconciled items whose amounts net to zero.',
			'Symptom: a manual journal entry references an account mapping that was retired last quarter.',
			'Symptom: the exception queue holds items aged beyond the five-day escalation window.',
		],
		constraints: [
			'Constraint: every adjustment must trace to a documented break reason code.',
			'Constraint: do not alter the matcher configuration without a recorded change note.',
			'Constraint: the period-close calendar must not be moved to absorb the break.',
			'Constraint: adjustments must net to the discrepancy amount, never round it away.',
			'Constraint: keep the investigation inside the reconciliation subsystem.',
		],
		deliverables: [
			'Deliverable: the root-caused break, the correcting entries, and a reconciliation note that closes the discrepancy.',
			'Deliverable: a resolved break report with the supporting adjustment journal and evidence trail.',
			'Deliverable: the corrected reconciliation with an aged-item disposition for every exception cited.',
			'Deliverable: a reconciliation memo naming the cause, the fix, and the guard against recurrence.',
			'Deliverable: the balanced reconciliation plus the annotated break report.',
		],
		acceptanceCriteria: [
			'The subledger and general ledger balances agree to the penny after the correction.',
			'Every adjusting entry carries a break reason code and a supporting reference.',
			'The exception queue holds no item older than the escalation window at closure.',
			'The reconciliation note names the root cause without rounding residual amounts away.',
			'No matcher configuration change lands without its recorded change note.',
		],
	}],
	['scenario-finance-regulatory-report-validation', {
		openers: [
			'The regulatory report must be validated before the submission window closes.',
			'A draft regulatory report failed two of its validation rules in the pre-submission check.',
			'The compliance desk asked for an independent validation pass over the prepared report.',
			'A rule update landed after the last submission, and this period\'s report must be checked against it.',
			'The submission log shows last period\'s report was accepted with warnings that need clearing.',
		],
		evidenceFragments: [
			'Signal: the validation rules file gained three new edits that reference a threshold changed last period.',
			'Signal: two report rows carry amounts that disagree with the subledger by a constant factor.',
			'Signal: the generation query sums a column the schema widened after the last release.',
			'Signal: one counterparty is missing a risk-weight classification the new rules expect.',
			'Signal: the submission log shows a prior warning about a rounding rule on borderline totals.',
			'Signal: the template carries a field the report generator leaves blank on empty sections.',
		],
		constraints: [
			'Constraint: the validation must run against the pinned rule version for the period.',
			'Constraint: no figure may be adjusted without a reconciled source reference.',
			'Constraint: the submission deadline is immovable; scope the fix to the failing edits.',
			'Constraint: every deviation must be explained in the validation note, never silently patched.',
			'Constraint: keep the report layout aligned with the official template.',
		],
		deliverables: [
			'Deliverable: the validated report, the failing-edit resolutions, and the submission-ready sign-off note.',
			'Deliverable: a clean validation pass with each resolved edit documented.',
			'Deliverable: the corrected report plus a note reconciling every flagged figure to its source.',
			'Deliverable: the validation result and the patched generation query with its tests.',
			'Deliverable: the report, the validation log, and the disclosure of any residual warnings.',
		],
		acceptanceCriteria: [
			'Every validation rule passes or carries an explained, documented exception.',
			'Each report figure reconciles to a named source reference.',
			'The validation note lists every deviation and its disposition.',
			'The report layout matches the official template field for field.',
			'The sign-off records the rule version the validation ran against.',
		],
	}],
	['scenario-finance-payment-failure-triage', {
		openers: [
			'A batch of payments failed during the overnight settlement window.',
			'The failure dashboard lit up with a cluster of declines sharing one error code.',
			'A payment partner reported repeated drops in the morning cutoff batch.',
			'Customer complaints trace back to a payment failure pattern that began after the last routing change.',
			'The payment events feed shows a rising failure rate on one corridor.',
		],
		evidenceFragments: [
			'Symptom: the failures cluster on one failure code that the retry policy maps to a permanent decline.',
			'Symptom: affected payments share a currency pair touched by the routing table update.',
			'Symptom: the events feed shows a duplicate attempt nine seconds after each failure.',
			'Symptom: failures begin exactly when the cutoff schedule shifted by fifteen minutes.',
			'Symptom: the routing table lists a provider whose availability feed went stale.',
			'Symptom: a share of failures carry an account number that fails the checksum edit.',
		],
		constraints: [
			'Constraint: no payment may be retried without identifying its failure class.',
			'Constraint: do not widen the retry policy beyond its documented budget.',
			'Constraint: customer-visible messaging must stay consistent with the failure class.',
			'Constraint: the routing table may only change through its documented approval path.',
			'Constraint: the triage note must separate provider-side from payload-side failures.',
		],
		deliverables: [
			'Deliverable: the triaged failure classes, the remediation for each, and the disposition of every stuck payment.',
			'Deliverable: a triage note with root causes and a routing fix routed through its approval path.',
			'Deliverable: the classified failures, the retried subset with outcomes, and the escalation list.',
			'Deliverable: a payment-failure report separating provider-side from payload-side causes.',
			'Deliverable: the failure cluster explained, the stuck queue drained, and the guard against the repeat failure.',
		],
		acceptanceCriteria: [
			'Every failed payment in the window carries a failure class and a disposition.',
			'No retry exceeds the documented retry budget.',
			'The triage separates provider-side from payload-side causes with evidence for each split.',
			'Routing changes land only through the documented approval path.',
			'The stuck-payment queue is empty or its remainder is escalated with reasons.',
		],
	}],
]);

/** The finance industry fixture task-world descriptor (scope lab-fixtures, evidence level 'fixture', honestly labeled). */
export const FINANCE_TASK_WORLD: TaskWorldDescriptor = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	world: {
		worldId: FINANCE_WORLD_ID,
		version: '1.0.0',
		domain: 'finance',
		seedPolicy: 'fixed',
		evidenceLevel: 'fixture',
		provenance: 'Fixture lane: briefs, contexts, obstacles and acceptance criteria are drawn from hand-authored fragment banks over a synthetic finance-operations layout (reconciliation, regulatory reporting and payment triage artifacts); no real telemetry, no real customer data and no live ledger snapshots are involved.',
	},
	taskScenarios: [
		SCENARIO_FINANCE_RECONCILIATION_DISCREPANCY,
		SCENARIO_FINANCE_REGULATORY_REPORT_VALIDATION,
		SCENARIO_FINANCE_PAYMENT_FAILURE_TRIAGE,
	],
	informationBoundary: {
		visibleToAgent: ['brief', 'contextFiles', 'obstacles', 'evidenceLevel'],
		withheldFromAgent: ['acceptanceCriteria', 'difficulty'],
		notes: 'The agent lane receives the visible payload only; acceptance criteria and difficulty are ground truth consumed exclusively by the evaluator lane.',
	},
	inputs: [
		'bank-finance-brief-fragments',
		'bank-finance-context-layout',
		'bank-finance-obstacle-kind-table',
		'bank-finance-acceptance-criteria',
	],
};
