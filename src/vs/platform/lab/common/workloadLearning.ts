/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-002 (fixture lane): deterministic workload and task-type learning from raw activity records.
 *
 * Derives a `WorkloadProfile` (signals, task mix, budget, SLA) and one `TaskTypeDescriptor` per
 * task family from `LabActivityRecord`s, under explicit user controls.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` — the learner is a pure
 * function of its inputs; every timestamp is a caller-supplied ISO string and the only time
 * arithmetic is `Date.parse` over those strings. The only rounding is deterministic half-up
 * `Math.round` on non-negative values.
 *
 * GOVERNANCE (LAB-002 core requirement — explicit user controls are the gate):
 *  - `optIn: false` makes `learnWorkloadProfile` return `null`: no learning from activity, ever.
 *  - The retention window (`occurredAt` strictly newer than `nowIso - retentionDays`) and the
 *    delete cutoff (`occurredAt >= deleteAllBefore` → excluded) are applied BEFORE any derivation;
 *    excluded records are counted (`excludedRecordCount`), never learned from.
 *  - Raw activity never leaves this module except as counts — see `separateLearningState`.
 *  - Records whose scope does not match the requested scope are ignored entirely (not learned
 *    from, not counted): no cross-workspace or cross-tenant leakage.
 *
 * EVIDENCE HONESTY: this is the fixture lane — LAB-002 ships no real activity collection, no
 * telemetry and no persistence. Every result therefore carries the `fixture-evidence` warning;
 * runtime waves revisit that marker when real activity exists.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type WorkloadProfile, type WorkloadSignal, type TaskTypeDescriptor } from './labContracts.js';

/** Raw activity record — the ONLY input type; fixture corpora provide instances. */
export interface LabActivityRecord {
	scope: LabScope; // scope the activity belongs to
	taskFamily: string; // e.g. 'feature', 'bugfix', 'refactor', 'review', 'investigation'
	toolKinds: string[]; // e.g. ['editor', 'shell', 'vcs']
	usedBrowser: boolean; // browser interaction occurred during the task
	usedEnvironment: boolean; // a live environment (dev server, REPL, sandbox) was used
	durationMinutes: number; // > 0
	complexityHint: number; // 0..1
	parallelThreads: number; // >= 1
	humanInterventions: number; // >= 0
	requiredReview: boolean; // a human review was required for this task
	qualitySensitivity: number; // 0..1
	costSensitivity: number; // 0..1
	latencySensitivity: number; // 0..1
	occurredAt: string; // ISO string, caller-supplied (determinism law)
}

/** Explicit user controls — the governance gate over all workload learning (LAB-002 core requirement). */
export interface WorkloadLearningControls {
	optIn: boolean; // false -> learnWorkloadProfile MUST return null (no learning from activity)
	retentionDays: number; // records older than this window are EXCLUDED before any derivation
	exportable: boolean; // surfaces verbatim on the profile
	deleteAllBefore?: string; // ISO cutoff: records at/after it are EXCLUDED (the delete support)
}

/** Task-type derivation output: deterministic id plus its fully populated descriptor. */
export interface TaskTypeInference {
	taskTypeId: string; // deterministic id derived from family + verification style
	descriptor: TaskTypeDescriptor;
}

/** Learning result: derived profile, per-family task types, governance counts and warnings. */
export interface WorkloadLearningResult {
	profile: WorkloadProfile; // source 'learned', carries learning: { optIn, retentionDays, exportable }
	taskTypes: TaskTypeInference[]; // one per task family present in the retained records
	retainedRecordCount: number; // records that survived the governance filters and were learned from
	excludedRecordCount: number; // governance exclusions (retention window + delete cutoff)
	warnings: string[]; // always 'fixture-evidence'; plus 'insufficient-history' when retained < 5
}

// --- documented fixed constants ----------------------------------------------------------------

// Fixed signal weights, one per measurable dimension. Documented contract:
// 0.18 + 0.12 + 0.14 + 0.08 + 0.06 + 0.06 + 0.08 + 0.10 + 0.06 + 0.12 = 1.00
// (weights sum to exactly 1 so the signal vector is a weighted profile).
const SIGNAL_WEIGHTS = {
	familyMix: 0.18,
	avgDuration: 0.12,
	avgComplexity: 0.14,
	toolUse: 0.08,
	browserUse: 0.06,
	environmentUse: 0.06,
	parallelism: 0.08,
	humanIntervention: 0.10,
	reviewRequirement: 0.06,
	sensitivityMix: 0.12,
};

// Normalization ceilings for signal values (documented constants): a record at the ceiling
// contributes a full 1.0 to the corresponding normalized average.
const DURATION_CEILING_MINUTES = 240; // avg-duration: 240+ minute tasks count as fully loaded
const TOOL_KIND_CEILING = 4; // tool-use: the 4 canonical kinds are 'editor', 'shell', 'vcs', 'test-runner'
const PARALLEL_THREADS_CEILING = 4; // parallelism: 4+ parallel threads count as fully parallel
const HUMAN_INTERVENTION_CEILING = 5; // human-intervention: 5+ interventions count as fully intervened

// Budget/SLA formulas (documented constants):
//   budgetUsdPerTask      = round1(BUDGET_BASE_USD + avgCostSensitivity * BUDGET_SENSITIVITY_FACTOR_USD)
//   latencySlaMinutes     = round1(SLA_BASE_MINUTES + (1 - avgLatencySensitivity) * SLA_SENSITIVITY_SPAN_MINUTES)
const BUDGET_BASE_USD = 0.5;
const BUDGET_SENSITIVITY_FACTOR_USD = 1.5;
const SLA_BASE_MINUTES = 5;
const SLA_SENSITIVITY_SPAN_MINUTES = 55;

// With no retained records the sensitivity averages default to the neutral midpoint.
const NEUTRAL_SENSITIVITY = 0.5;

// Fewer retained records than this warns 'insufficient-history'.
const MIN_RETAINED_RECORDS = 5;

// Warning markers (documented strings).
const WARNING_FIXTURE_EVIDENCE = 'fixture-evidence'; // always present: LAB-002 evidence is fixture-grade
const WARNING_INSUFFICIENT_HISTORY = 'insufficient-history'; // present when retained < MIN_RETAINED_RECORDS

// Rounding precision (documented constants).
const VALUE_DECIMALS = 4; // signal values and task-mix shares
const COST_DECIMALS = 1; // budget/SLA outputs

// Time arithmetic — only ever applied to caller-supplied timestamps (determinism law).
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The tool kind that flips a family's verification style to 'tests'.
const TEST_RUNNER_TOOL_KIND = 'test-runner';

// --- task-family templates ---------------------------------------------------------------------

/** Family-fixed descriptor template; `verificationStyle` is the only record-derived descriptor field. */
interface TaskFamilyTemplate {
	descriptorFamily: TaskTypeDescriptor['family'];
	name: string;
	complexity: number;
	contextNeeds: number;
	typicalTools: string[];
	typicalObstacles: string[];
}

// Documented family-fixed constants: raw task family -> descriptor family mapping
// ('feature'/'bugfix'/'refactor' -> 'implementation'; 'review' -> 'review'; 'investigation' ->
// 'investigation'; anything else -> 'maintenance' via DEFAULT_TASK_FAMILY_TEMPLATE), human name,
// complexity/contextNeeds constants, typical tools and 1-3 typical obstacles.
const TASK_FAMILY_TEMPLATES: { [taskFamily: string]: TaskFamilyTemplate } = {
	feature: {
		descriptorFamily: 'implementation',
		name: 'Feature work',
		complexity: 0.7,
		contextNeeds: 0.6,
		typicalTools: ['editor', 'shell', 'vcs'],
		typicalObstacles: ['ambiguous-requirements', 'integration-surface'],
	},
	bugfix: {
		descriptorFamily: 'implementation',
		name: 'Bug fixing',
		complexity: 0.5,
		contextNeeds: 0.5,
		typicalTools: ['editor', 'shell', 'vcs'],
		typicalObstacles: ['unclear-root-cause', 'regression-risk'],
	},
	refactor: {
		descriptorFamily: 'implementation',
		name: 'Refactoring',
		complexity: 0.4,
		contextNeeds: 0.7,
		typicalTools: ['editor', 'vcs'],
		typicalObstacles: ['hidden-coupling'],
	},
	review: {
		descriptorFamily: 'review',
		name: 'Code review',
		complexity: 0.3,
		contextNeeds: 0.4,
		typicalTools: ['vcs', 'editor'],
		typicalObstacles: ['large-diff-noise'],
	},
	investigation: {
		descriptorFamily: 'investigation',
		name: 'Investigation',
		complexity: 0.6,
		contextNeeds: 0.8,
		typicalTools: ['shell', 'browser'],
		typicalObstacles: ['missing-repro', 'scattered-evidence'],
	},
};

// Default template for families not listed above — maps to 'maintenance'.
const DEFAULT_TASK_FAMILY_TEMPLATE: TaskFamilyTemplate = {
	descriptorFamily: 'maintenance',
	name: 'Maintenance',
	complexity: 0.3,
	contextNeeds: 0.3,
	typicalTools: ['shell'],
	typicalObstacles: ['drift', 'tooling-rot'],
};

// --- internal helpers --------------------------------------------------------------------------

/** Clamp into [0, 1] — inputs outside documented ranges never escape the learner. */
function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Round to `decimals` places with deterministic half-up `Math.round` (non-negative values only). */
function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

/** Arithmetic mean of a picked numeric field (0 for an empty input; callers guard the empty case). */
function averageOf(records: LabActivityRecord[], pick: (record: LabActivityRecord) => number): number {
	let sum = 0;
	for (const record of records) {
		sum += pick(record);
	}
	return records.length > 0 ? sum / records.length : 0;
}

/** Deterministic slug: lowercase; runs of non-alphanumerics collapse to a single '-'; edges trimmed. */
function slugify(value: string): string {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(segment => segment.length > 0)
		.join('-');
}

/** Group records by task family, preserving first-seen order (Map iteration is deterministic). */
function groupByTaskFamily(records: LabActivityRecord[]): Map<string, LabActivityRecord[]> {
	const groups = new Map<string, LabActivityRecord[]>();
	for (const record of records) {
		const group = groups.get(record.taskFamily);
		if (group) {
			group.push(record);
		} else {
			groups.set(record.taskFamily, [record]);
		}
	}
	return groups;
}

/**
 * Verification style for one family's records, in documented priority order:
 * 'review' when a strict majority (>50%) of the family's records required review; else 'tests'
 * when ANY of the family's records used a test runner; else 'runtime-check' when ANY of the
 * family's records used the browser or an environment; else 'diff-inspection'.
 */
function deriveVerificationStyle(familyRecords: LabActivityRecord[]): TaskTypeDescriptor['verificationStyle'] {
	const reviewCount = familyRecords.filter(record => record.requiredReview).length;
	if (reviewCount * 2 > familyRecords.length) {
		return 'review';
	}
	if (familyRecords.some(record => record.toolKinds.includes(TEST_RUNNER_TOOL_KIND))) {
		return 'tests';
	}
	if (familyRecords.some(record => record.usedBrowser || record.usedEnvironment)) {
		return 'runtime-check';
	}
	return 'diff-inspection';
}

/**
 * The ONLY place records are partitioned. Governance rules:
 *  1. foreign-scope records are ignored entirely (never learned from, never counted);
 *  2. retention window: keep records with `occurredAt` strictly newer than nowIso - retentionDays;
 *  3. delete cutoff: records with `occurredAt` at/after `deleteAllBefore` are excluded.
 * Unparseable timestamps fail every comparison and are therefore deterministically excluded.
 */
function applyGovernanceFilters(
	scope: LabScope,
	records: LabActivityRecord[],
	controls: WorkloadLearningControls,
	nowIso: string,
): { retained: LabActivityRecord[]; excluded: LabActivityRecord[] } {
	const nowMs = Date.parse(nowIso);
	const retentionBoundaryMs = nowMs - controls.retentionDays * MS_PER_DAY;
	const deleteCutoffMs = controls.deleteAllBefore !== undefined ? Date.parse(controls.deleteAllBefore) : NaN;
	const retained: LabActivityRecord[] = [];
	const excluded: LabActivityRecord[] = [];
	for (const record of records) {
		const inScope = record.scope.workspaceId === scope.workspaceId && record.scope.tenantId === scope.tenantId;
		if (!inScope) {
			continue;
		}
		const occurredAtMs = Date.parse(record.occurredAt);
		const withinRetentionWindow = occurredAtMs > retentionBoundaryMs;
		const atOrAfterDeleteCutoff = !Number.isNaN(deleteCutoffMs) && occurredAtMs >= deleteCutoffMs;
		if (withinRetentionWindow && !atOrAfterDeleteCutoff) {
			retained.push(record);
		} else {
			excluded.push(record);
		}
	}
	return { retained, excluded };
}

/** budgetUsdPerTask = round1(0.5 + avgCostSensitivity * 1.5) USD; empty input uses the neutral 0.5. */
function computeBudgetUsdPerTask(records: LabActivityRecord[]): number {
	const averageCostSensitivity = records.length > 0 ? clamp01(averageOf(records, record => record.costSensitivity)) : NEUTRAL_SENSITIVITY;
	return roundTo(BUDGET_BASE_USD + averageCostSensitivity * BUDGET_SENSITIVITY_FACTOR_USD, COST_DECIMALS);
}

/** latencySlaMinutes = round1(5 + (1 - avgLatencySensitivity) * 55) minutes; empty input uses the neutral 0.5. */
function computeLatencySlaMinutes(records: LabActivityRecord[]): number {
	const averageLatencySensitivity = records.length > 0 ? clamp01(averageOf(records, record => record.latencySensitivity)) : NEUTRAL_SENSITIVITY;
	return roundTo(SLA_BASE_MINUTES + (1 - averageLatencySensitivity) * SLA_SENSITIVITY_SPAN_MINUTES, COST_DECIMALS);
}

/** One inference per family, ordered like the task mix (prevalence desc, then id asc). */
function deriveTaskTypes(scope: LabScope, records: LabActivityRecord[]): TaskTypeInference[] {
	if (records.length === 0) {
		return [];
	}
	const entries: { inference: TaskTypeInference; prevalence: number }[] = [];
	for (const [taskFamily, familyRecords] of groupByTaskFamily(records)) {
		const verificationStyle = deriveVerificationStyle(familyRecords);
		const taskTypeId = inferTaskTypeId(taskFamily, verificationStyle);
		const template = TASK_FAMILY_TEMPLATES[taskFamily] || DEFAULT_TASK_FAMILY_TEMPLATE;
		entries.push({
			prevalence: familyRecords.length,
			inference: {
				taskTypeId,
				descriptor: {
					scope,
					contractVersion: LAB_CONTRACTS_VERSION,
					id: taskTypeId,
					name: template.name,
					family: template.descriptorFamily,
					complexity: template.complexity,
					contextNeeds: template.contextNeeds,
					verificationStyle,
					typicalTools: template.typicalTools,
					typicalObstacles: template.typicalObstacles,
				},
			},
		});
	}
	entries.sort((a, b) => {
		if (a.prevalence !== b.prevalence) {
			return b.prevalence - a.prevalence;
		}
		if (a.inference.taskTypeId === b.inference.taskTypeId) {
			return 0;
		}
		return a.inference.taskTypeId < b.inference.taskTypeId ? -1 : 1;
	});
	return entries.map(entry => entry.inference);
}

// --- exported learner --------------------------------------------------------------------------

/** THE learner — pure and deterministic; returns null iff !controls.optIn (the explicit opt-out gate). */
export function learnWorkloadProfile(
	scope: LabScope,
	records: LabActivityRecord[],
	controls: WorkloadLearningControls,
	profileId: string,
	nowIso: string,
): WorkloadLearningResult | null {
	if (!controls.optIn) {
		return null; // governance gate: no learning from activity without explicit opt-in
	}
	const { retained, excluded } = applyGovernanceFilters(scope, records, controls, nowIso);
	const warnings: string[] = [WARNING_FIXTURE_EVIDENCE];
	if (retained.length < MIN_RETAINED_RECORDS) {
		warnings.push(WARNING_INSUFFICIENT_HISTORY);
	}
	const profile: WorkloadProfile = {
		scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		id: profileId,
		name: `Learned workload for ${scope.workspaceId}`,
		description: `Deterministically learned (LAB-002) from ${retained.length} retained activity record(s) in workspace ${scope.workspaceId}, tenant ${scope.tenantId}.`,
		signals: deriveSignals(retained),
		taskMix: deriveTaskMix(retained),
		budgetUsdPerTask: computeBudgetUsdPerTask(retained),
		latencySlaMinutes: computeLatencySlaMinutes(retained),
		source: 'learned',
		learning: {
			optIn: controls.optIn,
			retentionDays: controls.retentionDays,
			exportable: controls.exportable,
		},
	};
	return {
		profile,
		taskTypes: deriveTaskTypes(scope, retained),
		retainedRecordCount: retained.length,
		excludedRecordCount: excluded.length,
		warnings,
	};
}

/** One signal per measurable dimension — fixed kinds and weights, values are clamped normalized averages. */
export function deriveSignals(records: LabActivityRecord[]): WorkloadSignal[] {
	if (records.length === 0) {
		return [];
	}
	const count = records.length;
	let dominantFamilyShare = 0;
	for (const familyRecords of groupByTaskFamily(records).values()) {
		dominantFamilyShare = Math.max(dominantFamilyShare, familyRecords.length / count);
	}
	const fraction = (predicate: (record: LabActivityRecord) => boolean): number => records.filter(predicate).length / count;
	return [
		// family-mix: share of the most frequent task family (workload concentration)
		{
			kind: 'family-mix',
			label: 'Dominant task-family share',
			weight: SIGNAL_WEIGHTS.familyMix,
			value: roundTo(clamp01(dominantFamilyShare), VALUE_DECIMALS),
		},
		// avg-duration: mean durationMinutes against the fixed 240-minute ceiling
		{
			kind: 'avg-duration',
			label: 'Average duration (240-minute ceiling)',
			weight: SIGNAL_WEIGHTS.avgDuration,
			value: roundTo(clamp01(averageOf(records, record => record.durationMinutes) / DURATION_CEILING_MINUTES), VALUE_DECIMALS),
		},
		// avg-complexity: mean complexityHint
		{
			kind: 'avg-complexity',
			label: 'Average complexity hint',
			weight: SIGNAL_WEIGHTS.avgComplexity,
			value: roundTo(clamp01(averageOf(records, record => record.complexityHint)), VALUE_DECIMALS),
		},
		// tool-use: mean number of tool kinds per record against the 4-kind ceiling
		{
			kind: 'tool-use',
			label: 'Tool breadth (4-kind ceiling)',
			weight: SIGNAL_WEIGHTS.toolUse,
			value: roundTo(clamp01(averageOf(records, record => record.toolKinds.length) / TOOL_KIND_CEILING), VALUE_DECIMALS),
		},
		// browser-use: fraction of records that used the browser
		{
			kind: 'browser-use',
			label: 'Browser usage rate',
			weight: SIGNAL_WEIGHTS.browserUse,
			value: roundTo(fraction(record => record.usedBrowser), VALUE_DECIMALS),
		},
		// environment-use: fraction of records that used a live environment
		{
			kind: 'environment-use',
			label: 'Environment usage rate',
			weight: SIGNAL_WEIGHTS.environmentUse,
			value: roundTo(fraction(record => record.usedEnvironment), VALUE_DECIMALS),
		},
		// parallelism: mean parallelThreads against the 4-thread ceiling
		{
			kind: 'parallelism',
			label: 'Parallel threads (4-thread ceiling)',
			weight: SIGNAL_WEIGHTS.parallelism,
			value: roundTo(clamp01(averageOf(records, record => record.parallelThreads) / PARALLEL_THREADS_CEILING), VALUE_DECIMALS),
		},
		// human-intervention: mean humanInterventions against the 5-per-record ceiling
		{
			kind: 'human-intervention',
			label: 'Human interventions (5-count ceiling)',
			weight: SIGNAL_WEIGHTS.humanIntervention,
			value: roundTo(clamp01(averageOf(records, record => record.humanInterventions) / HUMAN_INTERVENTION_CEILING), VALUE_DECIMALS),
		},
		// review-requirement: fraction of records that required review
		{
			kind: 'review-requirement',
			label: 'Required-review rate',
			weight: SIGNAL_WEIGHTS.reviewRequirement,
			value: roundTo(fraction(record => record.requiredReview), VALUE_DECIMALS),
		},
		// sensitivity-mix: mean of (quality + cost + latency) / 3 per record
		{
			kind: 'sensitivity-mix',
			label: 'Quality+cost+latency sensitivity mix',
			weight: SIGNAL_WEIGHTS.sensitivityMix,
			value: roundTo(clamp01(averageOf(records, record => (clamp01(record.qualitySensitivity) + clamp01(record.costSensitivity) + clamp01(record.latencySensitivity)) / 3)), VALUE_DECIMALS),
		},
	];
}

/** Task mix over the given records: one share per family (family count / total), sorted by share desc then id asc. */
export function deriveTaskMix(records: LabActivityRecord[]): { taskTypeId: string; share: number }[] {
	if (records.length === 0) {
		return [];
	}
	const mix: { taskTypeId: string; share: number }[] = [];
	for (const [taskFamily, familyRecords] of groupByTaskFamily(records)) {
		mix.push({
			taskTypeId: inferTaskTypeId(taskFamily, deriveVerificationStyle(familyRecords)),
			share: roundTo(familyRecords.length / records.length, VALUE_DECIMALS),
		});
	}
	mix.sort((a, b) => {
		if (a.share !== b.share) {
			return b.share - a.share;
		}
		if (a.taskTypeId === b.taskTypeId) {
			return 0;
		}
		return a.taskTypeId < b.taskTypeId ? -1 : 1;
	});
	return mix;
}

/** Deterministic task-type id slug: `tt-${family}-${style}` (both segments slugified). */
export function inferTaskTypeId(taskFamily: string, verificationStyle: string): string {
	return `tt-${slugify(taskFamily)}-${slugify(verificationStyle)}`;
}

/** Raw/derived separation law: raw activity leaves the learner as COUNTS ONLY; derived state is profile + descriptors. */
export function separateLearningState(result: WorkloadLearningResult): {
	raw: { recordCount: number; retainedRecordCount: number };
	derived: { profile: WorkloadProfile; taskTypes: TaskTypeDescriptor[] };
	controls: WorkloadLearningControls;
} {
	return {
		// counts only — no raw record payloads ever cross this boundary
		raw: {
			recordCount: result.retainedRecordCount + result.excludedRecordCount,
			retainedRecordCount: result.retainedRecordCount,
		},
		derived: {
			profile: result.profile,
			taskTypes: result.taskTypes.map(taskType => taskType.descriptor),
		},
		// controls are recovered from the profile's durable learning block. `deleteAllBefore` is an
		// ephemeral input cutoff (one-shot delete support), not retained learning state — the frozen
		// WorkloadProfile.learning contract carries only the durable controls, so it comes back
		// undefined here.
		controls: {
			optIn: result.profile.learning.optIn,
			retentionDays: result.profile.learning.retentionDays,
			exportable: result.profile.learning.exportable,
		},
	};
}
