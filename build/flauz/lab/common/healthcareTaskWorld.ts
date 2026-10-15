/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * THE HEALTHCARE INDUSTRY TASK-WORLD FIXTURE (DH residue wave 1 / GAP-1): the healthcare member
 * of the three industry task-worlds for the LAB-003 fixture lane, composed exactly like the
 * landed SE fixture world (world-se-fixtures): three scenarios, each backed by a curated
 * fragment bank (openers / evidenceFragments / constraints / deliverables / acceptanceCriteria)
 * over a fixed synthetic 24-path context layout and a fixed 8-kind obstacle table.
 *
 * THE CONTENT DISCLOSURE (binding): this is a CURATED FIXTURE-LEVEL task-world content set -
 * representative, deliberately modest, honestly labeled; NOT a claim of comprehensive domain
 * truth, NOT promoted evidence. The scenario shapes are real healthcare-operations work
 * shapes (clinical-workflow scheduling integrity, patient-record access audit, claim-coding
 * validation) rendered as curated fixture content over a synthetic layout; no real patient
 * data is involved or implied.
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

/** World identity of the healthcare fixture task-world. */
export const HEALTHCARE_WORLD_ID = 'world-healthcare-fixtures';

// The fixed 24-path synthetic healthcare-operations layout context files are drawn from.
export const HEALTHCARE_CONTEXT_PATHS: readonly string[] = [
	'healthcare/scheduling/appointment_slots.csv',
	'healthcare/scheduling/clinic_calendar.json',
	'healthcare/scheduling/provider_roster.yaml',
	'healthcare/scheduling/waitlist_entries.csv',
	'healthcare/scheduling/room_blocks.json',
	'healthcare/scheduling/session_times.yaml',
	'healthcare/records/patient_index.csv',
	'healthcare/records/encounter_notes.yaml',
	'healthcare/records/medication_list.csv',
	'healthcare/records/lab_results_feed.csv',
	'healthcare/records/consent_registry.json',
	'healthcare/audit/access_log.csv',
	'healthcare/audit/break_glass_events.csv',
	'healthcare/audit/role_matrix.yaml',
	'healthcare/audit/retention_policy.json',
	'healthcare/audit/unit_activity_summary.csv',
	'healthcare/claims/claim_lines.csv',
	'healthcare/claims/coding_edits.yaml',
	'healthcare/claims/denial_reasons.csv',
	'healthcare/claims/payer_rules_matrix.yaml',
	'healthcare/claims/submission_batch_log.csv',
	'healthcare/billing/charge_master.csv',
	'healthcare/interoperability/fhir_mapping.json',
	'healthcare/quality/measure_definitions.yaml',
];

// The fixed 8-kind healthcare obstacle table.
export const HEALTHCARE_OBSTACLE_KINDS: readonly string[] = [
	'overbooked-slot-conflict',
	'stale-consent-flag',
	'incomplete-encounter-documentation',
	'ambiguous-code-mapping',
	'payer-rule-drift',
	'fragmented-patient-identity',
	'audit-log-retention-gap',
	'cross-shift-handover-noise',
];

const SCENARIO_HEALTHCARE_SCHEDULING_INTEGRITY: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-healthcare-scheduling-integrity',
	worldId: HEALTHCARE_WORLD_ID,
	taskTypeId: 'tt-scheduling-integrity-diff-inspection',
	name: 'Healthcare fixture: clinical scheduling integrity',
	description: 'Audit the clinic schedule for booking conflicts and roster mismatches and land a deconflicted calendar with every disposition logged.',
	difficultyBase: 0.5,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_HEALTHCARE_RECORD_ACCESS_AUDIT: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-healthcare-record-access-audit',
	worldId: HEALTHCARE_WORLD_ID,
	taskTypeId: 'tt-record-access-audit-review',
	name: 'Healthcare fixture: patient-record access audit',
	description: 'Audit patient-record accesses and break-glass events against the care-team pattern, classifying every access and escalating the unexplained.',
	difficultyBase: 0.45,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance'],
};

const SCENARIO_HEALTHCARE_CLAIM_CODING_VALIDATION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-healthcare-claim-coding-validation',
	worldId: HEALTHCARE_WORLD_ID,
	taskTypeId: 'tt-claim-coding-validation-review',
	name: 'Healthcare fixture: claim coding validation',
	description: 'Re-validate a denied claim batch against the current payer rules and encounter documentation, correcting coding with per-change rationales.',
	difficultyBase: 0.55,
	instanceCount: 6,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance', 'acceptance-count'],
};

/** The three healthcare fixture scenarios. */
export const HEALTHCARE_TASK_SCENARIOS: TaskScenario[] = [
	SCENARIO_HEALTHCARE_SCHEDULING_INTEGRITY,
	SCENARIO_HEALTHCARE_RECORD_ACCESS_AUDIT,
	SCENARIO_HEALTHCARE_CLAIM_CODING_VALIDATION,
];

/** The healthcare scenario fragment banks (openers / evidence fragments / constraints / deliverables / acceptance criteria). */
export const HEALTHCARE_SCENARIO_BANKS: ReadonlyMap<string, ScenarioBanks> = new Map<string, ScenarioBanks>([
	['scenario-healthcare-scheduling-integrity', {
		openers: [
			'The weekly clinic calendar shows provider slots that cannot all be valid.',
			'A double-booking complaint surfaced against one provider\'s afternoon clinic.',
			'The scheduling desk reported an appointment count that exceeds the room blocks available.',
			'A patient was turned away from a slot the system still shows as open.',
			'The waitlist audit found patients offered slots that conflict with the provider roster.',
		],
		evidenceFragments: [
			'Symptom: two booked appointments share the same slot index in the appointment export.',
			'Symptom: a room block was reassigned mid-week without a matching roster update.',
			'Symptom: the calendar shows a provider booked through a block marked as leave.',
			'Symptom: cancelled appointments still consume waitlist offers in the nightly feed.',
			'Symptom: one clinic\'s slot grid gained a slot outside its published session times.',
			'Symptom: the roster and the calendar disagree about which site a provider attends that day.',
		],
		constraints: [
			'Constraint: no appointment may be moved without patient notification recorded.',
			'Constraint: provider leave blocks take precedence over routine bookings.',
			'Constraint: the fix must preserve the published session times.',
			'Constraint: waitlist fairness order must survive every adjustment.',
			'Constraint: keep the correction inside the scheduling subsystem.',
		],
		deliverables: [
			'Deliverable: the deconflicted schedule, the affected-patient list, and the integrity note.',
			'Deliverable: a corrected calendar with every conflict resolved and its disposition logged.',
			'Deliverable: the schedule repair, the waitlist re-issue order, and the audit note.',
			'Deliverable: an integrity report naming each conflict class and its resolution.',
			'Deliverable: the rebuilt slot grid with the double-bookings closed and the roster aligned.',
		],
		acceptanceCriteria: [
			'No two appointments share the same slot, room, and provider.',
			'Every moved appointment has its patient notification recorded.',
			'The waitlist re-issue preserves the original fairness order.',
			'Provider leave blocks appear as unavailable, never bookable.',
			'The integrity note accounts for every conflict found in the audit.',
		],
	}],
	['scenario-healthcare-record-access-audit', {
		openers: [
			'A routine audit flagged patient-record accesses outside the treating-care-team pattern.',
			'The privacy officer asked for a review of break-glass events from the last reporting period.',
			'An access-log sweep found record views without a matching encounter.',
			'A patient request for an access report turned up entries the audit must explain.',
			'The compliance dashboard shows an uptick in after-hours record views on one unit.',
		],
		evidenceFragments: [
			'Symptom: eleven break-glass events carry no documented reason string.',
			'Symptom: a group of record views has no encounter id linking them to care.',
			'Symptom: one user id appears in the access log before its role assignment date.',
			'Symptom: after-hours views cluster on records also accessed by a billing queue.',
			'Symptom: the retention policy purged a month of logs the audit window expects.',
			'Symptom: two record views ride a shared session that the consent registry lists as withdrawn.',
		],
		constraints: [
			'Constraint: every finding must be classified as care-linked, operational, or unexplained.',
			'Constraint: patient identities must not leave the audit workspace.',
			'Constraint: break-glass events without reasons are findings, never assumptions.',
			'Constraint: the audit report must state the retention gap honestly where logs are missing.',
			'Constraint: no access may be revoked or granted from the audit itself.',
		],
		deliverables: [
			'Deliverable: the classified access-audit report with every finding dispositioned.',
			'Deliverable: an audit summary separating care-linked, operational, and unexplained access.',
			'Deliverable: the findings register with recommended follow-ups routed to the privacy officer.',
			'Deliverable: an access-audit note covering the break-glass events and the retention gap.',
			'Deliverable: the audit report with the unexplained accesses escalated and the rest closed.',
		],
		acceptanceCriteria: [
			'Every audited access carries one of the three classifications.',
			'No patient identifier appears outside the audit workspace.',
			'Unexplained accesses are escalated, not closed by assumption.',
			'The retention gap is stated with its exact missing window.',
			'The report changes no permissions on its own.',
		],
	}],
	['scenario-healthcare-claim-coding-validation', {
		openers: [
			'A batch of claims came back from the payer with coding-related denials.',
			'The denial report shows one edit failing across a whole submission batch.',
			'A coder escalation questions the mapping between two code sets this period.',
			'The payer rules matrix changed and the prepared claims batch must be re-validated.',
			'The claims team flagged claims whose coding disagrees with the encounter documentation.',
		],
		evidenceFragments: [
			'Signal: the denied claims share a code pair the payer rules list as mutually exclusive.',
			'Signal: the coding edits file maps one code to two targets after the last terminology update.',
			'Signal: encounter documentation supports a level of service one step above the billed code.',
			'Signal: the payer rules matrix gained a bundling edit that the submission batch predates.',
			'Signal: a share of denied lines carry modifier codes the payer retired last period.',
			'Signal: the interoperability mapping drops a laterality field the payer edit keys on.',
		],
		constraints: [
			'Constraint: coding may only follow the encounter documentation, never the payment outcome.',
			'Constraint: every code change needs a documented rationale in the claim note.',
			'Constraint: do not resubmit claims that belong to the payer\'s reconsideration path.',
			'Constraint: the validation must run against the current payer rules matrix version.',
			'Constraint: keep the code-mapping change inside the claims subsystem.',
		],
		deliverables: [
			'Deliverable: the validated claim batch with corrected coding and per-change rationales.',
			'Deliverable: a denial analysis with the failing edit fixed and the batch re-validated.',
			'Deliverable: the corrected claims, the mapping fix, and the resubmission note.',
			'Deliverable: a coding-validation report separating documentation-backed changes from payer-rule retractions.',
			'Deliverable: the re-coded batch with the payer-rule version recorded on each claim.',
		],
		acceptanceCriteria: [
			'Every code change cites its encounter documentation or payer rule.',
			'No claim is resubmitted outside its correct payer path.',
			'The mapping carries exactly one target per source code.',
			'The validation records the payer rules matrix version it ran against.',
			'No coding change is justified by the payment outcome alone.',
		],
	}],
]);

/** The healthcare industry fixture task-world descriptor (scope lab-fixtures, evidence level 'fixture', honestly labeled). */
export const HEALTHCARE_TASK_WORLD: TaskWorldDescriptor = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	world: {
		worldId: HEALTHCARE_WORLD_ID,
		version: '1.0.0',
		domain: 'healthcare',
		seedPolicy: 'fixed',
		evidenceLevel: 'fixture',
		provenance: 'Fixture lane: briefs, contexts, obstacles and acceptance criteria are drawn from hand-authored fragment banks over a synthetic healthcare-operations layout (scheduling, records-access audit and claims-coding artifacts); no real telemetry, no real patient data and no live clinical-system snapshots are involved.',
	},
	taskScenarios: [
		SCENARIO_HEALTHCARE_SCHEDULING_INTEGRITY,
		SCENARIO_HEALTHCARE_RECORD_ACCESS_AUDIT,
		SCENARIO_HEALTHCARE_CLAIM_CODING_VALIDATION,
	],
	informationBoundary: {
		visibleToAgent: ['brief', 'contextFiles', 'obstacles', 'evidenceLevel'],
		withheldFromAgent: ['acceptanceCriteria', 'difficulty'],
		notes: 'The agent lane receives the visible payload only; acceptance criteria and difficulty are ground truth consumed exclusively by the evaluator lane.',
	},
	inputs: [
		'bank-healthcare-brief-fragments',
		'bank-healthcare-context-layout',
		'bank-healthcare-obstacle-kind-table',
		'bank-healthcare-acceptance-criteria',
	],
};
