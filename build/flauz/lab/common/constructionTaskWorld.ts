/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * THE CONSTRUCTION INDUSTRY TASK-WORLD FIXTURE (DH residue wave 1 / GAP-1): the construction
 * member of the three industry task-worlds for the LAB-003 fixture lane, composed exactly like
 * the landed SE fixture world (world-se-fixtures): three scenarios, each backed by a curated
 * fragment bank (openers / evidenceFragments / constraints / deliverables / acceptanceCriteria)
 * over a fixed synthetic 24-path context layout and a fixed 8-kind obstacle table.
 *
 * THE CONTENT DISCLOSURE (binding): this is a CURATED FIXTURE-LEVEL task-world content set -
 * representative, deliberately modest, honestly labeled; NOT a claim of comprehensive domain
 * truth, NOT promoted evidence. The scenario shapes are real construction-operations work
 * shapes (submittal-review coordination, schedule-impact analysis, site-inspection finding
 * closure) rendered as curated fixture content over a synthetic layout.
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

/** World identity of the construction fixture task-world. */
export const CONSTRUCTION_WORLD_ID = 'world-construction-fixtures';

// The fixed 24-path synthetic construction-operations layout context files are drawn from.
export const CONSTRUCTION_CONTEXT_PATHS: readonly string[] = [
	'construction/submittals/submittal_register.csv',
	'construction/submittals/review_comments.yaml',
	'construction/submittals/approval_workflow.json',
	'construction/submittals/spec_section_map.yaml',
	'construction/submittals/lead_time_log.csv',
	'construction/drawings/sheet_revision_log.csv',
	'construction/drawings/current_sheet_set.json',
	'construction/schedule/master_schedule.csv',
	'construction/schedule/activity_network.json',
	'construction/schedule/float_report.csv',
	'construction/schedule/weather_delay_log.csv',
	'construction/schedule/change_order_register.csv',
	'construction/schedule/critical_path_snapshot.json',
	'construction/schedule/baseline_revisions.json',
	'construction/inspection/finding_register.csv',
	'construction/inspection/punch_list.yaml',
	'construction/inspection/safety_observations.csv',
	'construction/inspection/test_results_log.csv',
	'construction/inspection/closure_evidence.json',
	'construction/contracts/rfi_register.yaml',
	'construction/contracts/pay_app_log.csv',
	'construction/site/daily_reports.csv',
	'construction/site/material_delivery_log.csv',
	'construction/site/subcontractor_roster.json',
];

// The fixed 8-kind construction obstacle table.
export const CONSTRUCTION_OBSTACLE_KINDS: readonly string[] = [
	'late-submittal-approval',
	'conflicting-drawing-revisions',
	'unresolved-rfi-dependency',
	'weather-window-uncertainty',
	'limited-float-critical-path',
	'inspection-access-constraint',
	'subcontractor-sequencing-clash',
	'incomplete-closure-documentation',
];

const SCENARIO_CONSTRUCTION_SUBMITTAL_COORDINATION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-construction-submittal-coordination',
	worldId: CONSTRUCTION_WORLD_ID,
	taskTypeId: 'tt-submittal-coordination-review',
	name: 'Construction fixture: submittal review coordination',
	description: 'Coordinate a stalled submittal review package, resolving comment conflicts and revision references against the current drawing set.',
	difficultyBase: 0.5,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_CONSTRUCTION_SCHEDULE_IMPACT_ANALYSIS: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-construction-schedule-impact-analysis',
	worldId: CONSTRUCTION_WORLD_ID,
	taskTypeId: 'tt-schedule-impact-analysis-review',
	name: 'Construction fixture: schedule impact analysis',
	description: 'Reproduce and adjudicate a claimed schedule impact against the delay evidence chain and the current approved schedule revision.',
	difficultyBase: 0.55,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_CONSTRUCTION_INSPECTION_FINDING_CLOSURE: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-construction-inspection-finding-closure',
	worldId: CONSTRUCTION_WORLD_ID,
	taskTypeId: 'tt-inspection-finding-closure-diff-inspection',
	name: 'Construction fixture: inspection finding closure',
	description: 'Close site-inspection findings with their evidence chains current, escalating aged and reopened items with root-cause notes.',
	difficultyBase: 0.45,
	instanceCount: 6,
	perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'],
};

/** The three construction fixture scenarios. */
export const CONSTRUCTION_TASK_SCENARIOS: TaskScenario[] = [
	SCENARIO_CONSTRUCTION_SUBMITTAL_COORDINATION,
	SCENARIO_CONSTRUCTION_SCHEDULE_IMPACT_ANALYSIS,
	SCENARIO_CONSTRUCTION_INSPECTION_FINDING_CLOSURE,
];

/** The construction scenario fragment banks (openers / evidence fragments / constraints / deliverables / acceptance criteria). */
export const CONSTRUCTION_SCENARIO_BANKS: ReadonlyMap<string, ScenarioBanks> = new Map<string, ScenarioBanks>([
	['scenario-construction-submittal-coordination', {
		openers: [
			'A submittal package is stuck past its review milestone with three trades waiting on it.',
			'The submittal register shows a review that conflicts with the spec section it cites.',
			'A late submittal approval is pushing the procurement long-lead items off schedule.',
			'The design team flagged review comments that contradict the current drawing revision.',
			'Two submittals cite the same spec section with different revision references.',
		],
		evidenceFragments: [
			'Symptom: the review comments reference a drawing revision two issues behind the current set.',
			'Symptom: one submittal\'s lead time log entry assumes an approval that has not happened.',
			'Symptom: the approval workflow shows a reviewer signature on a version later superseded.',
			'Symptom: the spec section map points two submittals at overlapping scopes.',
			'Symptom: a deferred submittal still carries its original milestone date.',
			'Symptom: the material delivery log shows fabricator commitments dated before review closure.',
		],
		constraints: [
			'Constraint: no submittal may be approved out of sequence with its spec section dependencies.',
			'Constraint: review comments must cite the drawing revision they apply to.',
			'Constraint: procurement dates may only move with a recorded schedule note.',
			'Constraint: contradictory comments must be resolved before the package advances.',
			'Constraint: keep the coordination record inside the submittal register.',
		],
		deliverables: [
			'Deliverable: the coordinated submittal package with comment conflicts resolved and the register updated.',
			'Deliverable: a review-coordination note with every revision reference corrected.',
			'Deliverable: the re-sequenced submittals with dependency order documented.',
			'Deliverable: the updated register, the resolved comments, and the procurement impact note.',
			'Deliverable: a coordination summary naming each conflict and its resolution path.',
		],
		acceptanceCriteria: [
			'Every review comment cites the drawing revision it applies to.',
			'No submittal advances out of dependency sequence.',
			'The register shows one current revision reference per submittal.',
			'Procurement date changes carry their schedule note.',
			'The coordination summary accounts for every flagged conflict.',
		],
	}],
	['scenario-construction-schedule-impact-analysis', {
		openers: [
			'A change order claims a three-week schedule impact the team cannot reproduce.',
			'The owner asked for an impact analysis after two weeks of weather delays.',
			'An unresolved RFI is holding a predecessor activity the critical path runs through.',
			'The monthly schedule update shows float erosion the baseline cannot explain.',
			'A subcontractor sequenced work against a superseded schedule revision.',
		],
		evidenceFragments: [
			'Signal: the claimed impact sits on a path with two weeks of free float in the current network.',
			'Signal: the weather delay log records six lost days the update has not absorbed.',
			'Signal: the RFI register shows the answered RFI never released its dependent activity.',
			'Signal: the critical path snapshot moved without a corresponding change order.',
			'Signal: the float report shows negative float on activities with no delay entry.',
			'Signal: the subcontractor\'s sequence cites the baseline issued before the last revision.',
		],
		constraints: [
			'Constraint: the analysis must use the current approved schedule revision.',
			'Constraint: every claimed delay day needs a delay-log or change-order reference.',
			'Constraint: float arguments must name the path they ride.',
			'Constraint: the analysis may not resequence work outside the contract change path.',
			'Constraint: state the impact as a range when the delay evidence is incomplete.',
		],
		deliverables: [
			'Deliverable: the impact analysis with the delay evidence chain and the revised forecast.',
			'Deliverable: a schedule-impact memo reproducing the claimed delay day by day.',
			'Deliverable: the fragnet analysis, the entitlement note, and the updated forecast.',
			'Deliverable: an impact analysis separating excusable, compensable, and concurrent delay.',
			'Deliverable: the validated impact claim with the float position documented.',
		],
		acceptanceCriteria: [
			'Every delay day in the analysis carries its evidence reference.',
			'The analysis runs against the current approved schedule revision.',
			'Float arguments name their path and current float value.',
			'Delay classes separate excusable, compensable, and concurrent time.',
			'The forecast impact is stated with its confidence basis.',
		],
	}],
	['scenario-construction-inspection-finding-closure', {
		openers: [
			'A re-inspection found three findings still open from the previous walk.',
			'The punch list shows items closed without their required evidence attachments.',
			'A safety observation has aged past its interim-control deadline.',
			'The inspector rejected a closure package for missing test results.',
			'A finding was closed against a drawing revision the current set supersedes.',
		],
		evidenceFragments: [
			'Symptom: two closed punch items carry no closure evidence reference.',
			'Symptom: the safety observation\'s interim control lapsed before the fix date.',
			'Symptom: the test results log misses the pour the finding concerns.',
			'Symptom: the closure cites a drawing revision the current sheet set supersedes.',
			'Symptom: the daily reports place the crew elsewhere on the claimed closure date.',
			'Symptom: the finding register shows the same deficiency reopened twice this quarter.',
		],
		constraints: [
			'Constraint: no finding closes without its evidence attachment referenced.',
			'Constraint: interim controls must be current through the fix date.',
			'Constraint: closures must cite the current drawing revision.',
			'Constraint: reopened findings need a root-cause note, not another patch.',
			'Constraint: the closure record stays inside the inspection register.',
		],
		deliverables: [
			'Deliverable: the closure package with evidence references for every finding.',
			'Deliverable: a finding-closure report with the evidence chain and the reopened-item root causes.',
			'Deliverable: the corrected punch list with current interim controls and the re-inspection note.',
			'Deliverable: the closure evidence assembled, the register updated, and the aged findings escalated.',
			'Deliverable: a closure memo accounting for every open, closed, and reopened finding.',
		],
		acceptanceCriteria: [
			'Every closed finding references its closure evidence.',
			'Interim controls are current through each fix date.',
			'Closures cite the current drawing revision.',
			'Reopened findings carry root-cause notes.',
			'The register reconciles open, closed, and reopened counts exactly.',
		],
	}],
]);

/** The construction industry fixture task-world descriptor (scope lab-fixtures, evidence level 'fixture', honestly labeled). */
export const CONSTRUCTION_TASK_WORLD: TaskWorldDescriptor = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	world: {
		worldId: CONSTRUCTION_WORLD_ID,
		version: '1.0.0',
		domain: 'construction',
		seedPolicy: 'fixed',
		evidenceLevel: 'fixture',
		provenance: 'Fixture lane: briefs, contexts, obstacles and acceptance criteria are drawn from hand-authored fragment banks over a synthetic construction-operations layout (submittals, scheduling and inspection artifacts); no real telemetry, no real project data and no live site-system snapshots are involved.',
	},
	taskScenarios: [
		SCENARIO_CONSTRUCTION_SUBMITTAL_COORDINATION,
		SCENARIO_CONSTRUCTION_SCHEDULE_IMPACT_ANALYSIS,
		SCENARIO_CONSTRUCTION_INSPECTION_FINDING_CLOSURE,
	],
	informationBoundary: {
		visibleToAgent: ['brief', 'contextFiles', 'obstacles', 'evidenceLevel'],
		withheldFromAgent: ['acceptanceCriteria', 'difficulty'],
		notes: 'The agent lane receives the visible payload only; acceptance criteria and difficulty are ground truth consumed exclusively by the evaluator lane.',
	},
	inputs: [
		'bank-construction-brief-fragments',
		'bank-construction-context-layout',
		'bank-construction-obstacle-kind-table',
		'bank-construction-acceptance-criteria',
	],
};
