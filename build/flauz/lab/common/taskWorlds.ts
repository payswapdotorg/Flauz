/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Task-world module (LAB-003): world descriptors, deterministic instance generation and
 * the information-boundary law for the Flauz lab fixture lane. This wave ships the module
 * plus the first fixture world (software-engineering), honestly labeled at evidence level
 * 'fixture'; real domain worlds are later waves.
 *
 * DETERMINISM LAW: this module never calls Math.random, Date.now or `new Date()`. Every
 * generated WorldInstance is a pure function of (scenarioId, seed, instanceIndex): the
 * per-instance sub-seed is fnv1a32(`${scenarioId}:${seed}:${instanceIndex}`) and every
 * generated value is drawn from an inline mulberry32 stream seeded by that sub-seed, so
 * the instance stream is independent of the requested count and of sibling order.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type TaskScenario, type WorldModelVersion, type LabEvidenceLevel } from './labContracts.js';

/** Information boundary: what the agent lane may see vs what only the evaluator consumes. */
export interface InformationBoundary {
	/** Kinds of instance data exposed to the agent lane. */
	visibleToAgent: string[];
	/** Ground-truth kinds the evaluator alone consumes. */
	withheldFromAgent: string[];
	/** One honest sentence on how the boundary splits the two lanes. */
	notes: string;
}

/** A task world: recorded inputs, seed policy, version, information boundary, evidence provenance. */
export interface TaskWorldDescriptor {
	/** Fixed fixture scope ({ workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }). */
	scope: LabScope;
	/** The lab-contracts version this world is pinned to. */
	contractVersion: string;
	/** World identity, version, domain, seed policy, evidence level and provenance. */
	world: WorldModelVersion;
	/** The scenarios this world generates instances for. */
	taskScenarios: TaskScenario[];
	/** Which instance kinds are visible to the agent lane vs withheld for the evaluator. */
	informationBoundary: InformationBoundary;
	/** Recorded input bank names the generator draws from (fixture lane). */
	inputs: string[];
}

// --------------------------------------------------------------------------------------------
// Module-private fixture data
// --------------------------------------------------------------------------------------------

const LAB_FIXTURE_SCOPE: LabScope = { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' };

const WORLD_SE_FIXTURES_ID = 'world-se-fixtures';

// The fixed 24-path synthetic repository layout context files are drawn from.
const SYNTHETIC_REPO_PATHS: readonly string[] = [
	'src/server/auth.ts',
	'src/server/session.ts',
	'src/server/routes.ts',
	'src/server/middleware.ts',
	'src/server/config.ts',
	'src/client/api.ts',
	'src/client/store.ts',
	'src/client/components/form.ts',
	'src/client/components/list.ts',
	'src/db/schema.sql',
	'src/db/migrations/0007_add_audit_log.sql',
	'src/db/migrations/0008_widen_status_column.sql',
	'src/worker/queue.ts',
	'src/worker/jobs/cleanup.ts',
	'src/worker/jobs/notify.ts',
	'src/worker/scheduler.ts',
	'src/shared/types.ts',
	'src/shared/validation.ts',
	'src/shared/logger.ts',
	'src/shared/errors.ts',
	'test/server/auth.test.ts',
	'test/server/routes.test.ts',
	'test/worker/jobs.test.ts',
	'test/e2e/regression.spec.ts',
];

// The fixed 8-kind obstacle table.
const OBSTACLE_KINDS: readonly string[] = [
	'failing-test',
	'unclear-requirements',
	'flaky-ci',
	'missing-docs',
	'legacy-pattern',
	'large-diff-context',
	'concurrent-edits',
	'partial-rollback',
];

const CONTEXT_FILE_COUNT_MIN = 3;
const CONTEXT_FILE_COUNT_MAX = 6;
const OBSTACLE_COUNT_MIN = 1;
const OBSTACLE_COUNT_MAX = 3;
const CRITERION_COUNT_MIN = 2;
const CRITERION_COUNT_MAX = 4;
const EVIDENCE_FRAGMENT_COUNT_MAX = 2;
const REPO_LINES_MIN = 40;
const REPO_LINES_MAX = 900;
const REPO_LINES_STEP = 20;
const REPO_LINES_COUNT = (REPO_LINES_MAX - REPO_LINES_MIN) / REPO_LINES_STEP + 1;
const RELEVANCE_MIN = 0.3;
const RELEVANCE_MAX = 1.0;
const OBSTACLE_SEVERITY_MIN = 0.2;
const OBSTACLE_SEVERITY_MAX = 0.9;
const DIFFICULTY_FLOOR = 0.05;
const DIFFICULTY_CEILING = 0.95;
const OBSTACLE_SEVERITY_WEIGHT = 0.25;
const JITTER_HALF_WIDTH = 0.05;

type ContextFile = { path: string; lines: number; relevance: number };
type Obstacle = { kind: string; severity: number };

/** Per-scenario fixed fragment banks the brief and the acceptance criteria are composed from. */
interface ScenarioBanks {
	openers: readonly string[];
	evidenceFragments: readonly string[];
	constraints: readonly string[];
	deliverables: readonly string[];
	acceptanceCriteria: readonly string[];
}

const SCENARIO_SE_BUGFIX_REGRESSION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-se-bugfix-regression',
	worldId: WORLD_SE_FIXTURES_ID,
	taskTypeId: 'tt-bugfix-regression-tests',
	name: 'SE fixture: bugfix with regression coverage',
	description: 'Diagnose a seeded defect in the synthetic repository and land a fix guarded by new regression tests.',
	difficultyBase: 0.45,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_SE_FEATURE_ADDITION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-se-feature-addition',
	worldId: WORLD_SE_FIXTURES_ID,
	taskTypeId: 'tt-feature-addition-tests',
	name: 'SE fixture: feature addition with tests',
	description: 'Extend an existing synthetic-repo module with a bounded new capability and its test coverage.',
	difficultyBase: 0.6,
	instanceCount: 8,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance', 'acceptance-count'],
};

const SCENARIO_SE_FLAKY_INVESTIGATION: TaskScenario = {
	scope: LAB_FIXTURE_SCOPE,
	contractVersion: LAB_CONTRACTS_VERSION,
	id: 'scenario-se-flaky-investigation',
	worldId: WORLD_SE_FIXTURES_ID,
	taskTypeId: 'tt-flaky-investigation-runtime-check',
	name: 'SE fixture: flaky test investigation',
	description: 'Investigate an intermittently failing test in the synthetic repository and stabilize it with evidence.',
	difficultyBase: 0.5,
	instanceCount: 6,
	perturbations: ['obstacle-mix', 'brief-phrasing', 'context-relevance'],
};

const SCENARIO_BANKS: ReadonlyMap<string, ScenarioBanks> = new Map<string, ScenarioBanks>([
	['scenario-se-bugfix-regression', {
		openers: [
			'A regression was reported against the mainline branch.',
			'The nightly verification run flagged a behavioral regression.',
			'A red test landed in the queue after the last merge to main.',
			'A user-visible regression slipped through review in the previous sprint.',
			'The release candidate is blocked by a failing regression suite.',
		],
		evidenceFragments: [
			'Symptom: an assertion in the regression suite fails reproducibly on a clean checkout.',
			'Symptom: the failure only appears once the audit-log migration has been applied.',
			'Symptom: session tokens are rejected with a stale-clock error after the last patch.',
			'Symptom: the notification worker drops roughly one message in twenty under load.',
			'Symptom: pagination returns an empty page for offsets above the boundary check.',
			'Symptom: the form validator intermittently accepts an empty required field.',
		],
		constraints: [
			'Constraint: do not change the public API surface.',
			'Constraint: keep the fix inside the failing subsystem and avoid drive-by refactors.',
			'Constraint: no new runtime dependencies may be introduced.',
			'Constraint: preserve the existing database schema.',
			'Constraint: the change must stay reviewable in a single sitting.',
		],
		deliverables: [
			'Deliverable: a root-cause fix plus regression tests that fail before and pass after.',
			'Deliverable: a minimal patch and an updated regression test.',
			'Deliverable: the corrected behavior with the regression suite restored to green.',
			'Deliverable: a targeted fix with a new test locking the invariant.',
			'Deliverable: a patch, a regression test, and a short root-cause note.',
		],
		acceptanceCriteria: [
			'The regression suite passes on a clean checkout.',
			'The previously failing assertion passes deterministically across three consecutive runs.',
			'No existing test is weakened, skipped, or deleted.',
			'The root cause is identified and named in the change description.',
			'No public API signature changes.',
		],
	}],
	['scenario-se-feature-addition', {
		openers: [
			'A new capability has been requested for the next milestone.',
			'Product has scoped a small feature for this sprint.',
			'A gap in the current toolset needs closing before the freeze.',
			'A stakeholder has asked for one more bounded capability this quarter.',
			'The roadmap calls for a contained feature addition.',
		],
		evidenceFragments: [
			'Signal: the requested capability extends an existing, well-tested module.',
			'Signal: the design sketch reuses two helpers that already cover the hard parts.',
			'Signal: an adjacent module already implements half of the needed logic.',
			'Signal: the requested behavior has a clear counterpart in the API guidelines.',
			'Signal: existing telemetry shows users retrying the flow the feature would fix.',
			'Signal: the feature touches one vertical slice, from API to client.',
		],
		constraints: [
			'Constraint: follow the existing module structure and naming conventions.',
			'Constraint: the new surface must be covered by tests before review.',
			'Constraint: the implementation must stay within a one-sprint-day budget.',
			'Constraint: no breaking changes to existing callers.',
			'Constraint: configuration must be additive and default to off.',
		],
		deliverables: [
			'Deliverable: the feature implementation, its tests, and a short usage note.',
			'Deliverable: working code with unit and integration coverage.',
			'Deliverable: the new capability wired end-to-end with tests at each seam.',
			'Deliverable: an implementation, tests, and an updated example.',
			'Deliverable: the feature plus a test that demonstrates the documented behavior.',
		],
		acceptanceCriteria: [
			'The feature works end-to-end within the synthetic repository layout.',
			'Every new code path is covered by at least one test.',
			'Existing tests continue to pass unchanged.',
			'The public surface matches the naming conventions of neighboring modules.',
			'A usage note or example documents the new capability.',
		],
	}],
	['scenario-se-flaky-investigation', {
		openers: [
			'A test has been reported flaky on the CI lane.',
			'The merge queue is stalled by an intermittently failing test.',
			'A green build turned red with no change in the commit range.',
			'An engineer escalated a test that fails on some machines only.',
			'The CI lane reports a test that passes locally and fails remotely.',
		],
		evidenceFragments: [
			'Signal: the failure correlates with concurrent test execution.',
			'Signal: the test touches a shared clock or a temporary directory.',
			'Signal: the flake reproduces under artificial CPU load about one run in ten.',
			'Signal: the failing assertion depends on the ordering of two background jobs.',
			'Signal: the test passes in isolation and fails in the full suite.',
			'Signal: timeouts in the worker queue coincide with the flaky window.',
		],
		constraints: [
			'Constraint: the investigation must produce evidence, not just a re-run.',
			'Constraint: do not delete or skip the flaky test.',
			'Constraint: keep instrumentation additions out of the shipped path.',
			'Constraint: any proposed fix must come with a determinism argument.',
			'Constraint: document every hypothesis you rule out.',
		],
		deliverables: [
			'Deliverable: a root-cause diagnosis with evidence, plus the smallest safe fix.',
			'Deliverable: a written diagnosis and a stabilizing patch.',
			'Deliverable: the flake reproduced deterministically, then fixed.',
			'Deliverable: a diagnosis, a fix, and a guard test against regression.',
			'Deliverable: an evidence-backed root cause and a patch that makes the test deterministic.',
		],
		acceptanceCriteria: [
			'The flake is reproduced deterministically, or its absence is explained with evidence.',
			'The root cause is stated precisely enough to predict the failure mode.',
			'The fix makes the test deterministic across at least ten consecutive runs.',
			'No test is deleted or skipped.',
			'The diagnosis clearly separates symptom from cause.',
		],
	}],
]);

// --------------------------------------------------------------------------------------------
// The fixture catalog
// --------------------------------------------------------------------------------------------

/** The fixture task-world catalog: exactly one world ('world-se-fixtures') in this wave. */
export const TASK_WORLDS: TaskWorldDescriptor[] = [
	{
		scope: LAB_FIXTURE_SCOPE,
		contractVersion: LAB_CONTRACTS_VERSION,
		world: {
			worldId: WORLD_SE_FIXTURES_ID,
			version: '1.0.0',
			domain: 'software-engineering',
			seedPolicy: 'fixed',
			evidenceLevel: 'fixture',
			provenance: 'Fixture lane: briefs, contexts, obstacles and acceptance criteria are drawn from hand-authored fragment banks over a synthetic 24-path repository layout; no real telemetry, no real user data and no live repository snapshots are involved.',
		},
		taskScenarios: [
			SCENARIO_SE_BUGFIX_REGRESSION,
			SCENARIO_SE_FEATURE_ADDITION,
			SCENARIO_SE_FLAKY_INVESTIGATION,
		],
		informationBoundary: {
			visibleToAgent: ['brief', 'contextFiles', 'obstacles', 'evidenceLevel'],
			withheldFromAgent: ['acceptanceCriteria', 'difficulty'],
			notes: 'The agent lane receives the visible payload only; acceptance criteria and difficulty are ground truth consumed exclusively by the evaluator lane.',
		},
		inputs: [
			'bank-se-brief-fragments',
			'bank-se-synthetic-repo-layout',
			'bank-se-obstacle-kind-table',
			'bank-se-acceptance-criteria',
		],
	},
];

// --------------------------------------------------------------------------------------------
// Deterministic generation
// --------------------------------------------------------------------------------------------

/** One generated task instance: deterministic in (scenarioId, seed, instanceIndex). */
export interface WorldInstance {
	/** Id of the scenario this instance was generated from. */
	scenarioId: string;
	/** The run seed, copied through to the instance. */
	seed: number;
	/** 0-based index of this instance within the run. */
	instanceIndex: number;
	/** Task brief composed from the scenario's fragment banks. */
	brief: string;
	/** 3-6 files drawn without replacement from the fixed 24-path synthetic repo table. */
	contextFiles: { path: string; lines: number; relevance: number }[];
	/** 1-3 obstacles drawn without replacement from the fixed 8-kind table, severity 0.2..0.9. */
	obstacles: { kind: string; severity: number }[];
	/** 2-4 canonical acceptance criteria (WITHHELD ground truth, evaluator lane only). */
	acceptanceCriteria: string[];
	/** 0..1 difficulty: clamp(0.05, 0.95, difficultyBase + 0.25 * avgObstacleSeverity + jitter(-0.05..+0.05)). */
	difficulty: number;
	/** Evidence level of the world this instance came from  -  never overstated. */
	evidenceLevel: LabEvidenceLevel;
}

function fnv1a32(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function mulberry32(seedValue: number): () => number {
	let state = seedValue >>> 0;
	return (): number => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function clampNumber(minimum: number, maximum: number, value: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function pickCount(rng: () => number, minimum: number, maximum: number): number {
	return minimum + Math.floor(rng() * (maximum - minimum + 1));
}

function pickIndex(rng: () => number, length: number): number {
	return Math.floor(rng() * length);
}

function sampleIndices(rng: () => number, length: number, count: number): number[] {
	const pool: number[] = [];
	for (let i = 0; i < length; i++) {
		pool.push(i);
	}
	for (let i = 0; i < count; i++) {
		const swapIndex = i + Math.floor(rng() * (length - i));
		const temporary = pool[i]!;
		pool[i] = pool[swapIndex]!;
		pool[swapIndex] = temporary;
	}
	return pool.slice(0, count);
}

function drawContextFiles(rng: () => number): ContextFile[] {
	const count = pickCount(rng, CONTEXT_FILE_COUNT_MIN, CONTEXT_FILE_COUNT_MAX);
	const indices = sampleIndices(rng, SYNTHETIC_REPO_PATHS.length, count);
	const files: ContextFile[] = [];
	for (const index of indices) {
		const lines = REPO_LINES_MIN + REPO_LINES_STEP * Math.floor(rng() * REPO_LINES_COUNT);
		const relevance = round2(RELEVANCE_MIN + rng() * (RELEVANCE_MAX - RELEVANCE_MIN));
		files.push({ path: SYNTHETIC_REPO_PATHS[index]!, lines, relevance });
	}
	files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return files;
}

function drawObstacles(rng: () => number): Obstacle[] {
	const count = pickCount(rng, OBSTACLE_COUNT_MIN, OBSTACLE_COUNT_MAX);
	const indices = sampleIndices(rng, OBSTACLE_KINDS.length, count);
	const obstacles: Obstacle[] = [];
	for (const index of indices) {
		const severity = round2(OBSTACLE_SEVERITY_MIN + rng() * (OBSTACLE_SEVERITY_MAX - OBSTACLE_SEVERITY_MIN));
		obstacles.push({ kind: OBSTACLE_KINDS[index]!, severity });
	}
	obstacles.sort((left, right) => (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
	return obstacles;
}

function composeBrief(banks: ScenarioBanks, rng: () => number): string {
	const openerIndex = pickIndex(rng, banks.openers.length);
	const evidenceCount = 1 + Math.floor(rng() * EVIDENCE_FRAGMENT_COUNT_MAX);
	const evidenceIndices = sampleIndices(rng, banks.evidenceFragments.length, evidenceCount);
	const constraintIndex = pickIndex(rng, banks.constraints.length);
	const deliverableIndex = pickIndex(rng, banks.deliverables.length);
	const parts: string[] = [banks.openers[openerIndex]!];
	for (const index of evidenceIndices) {
		parts.push(banks.evidenceFragments[index]!);
	}
	parts.push(banks.constraints[constraintIndex]!);
	parts.push(banks.deliverables[deliverableIndex]!);
	return parts.join(' ');
}

function drawAcceptanceCriteria(banks: ScenarioBanks, rng: () => number): string[] {
	const count = pickCount(rng, CRITERION_COUNT_MIN, CRITERION_COUNT_MAX);
	const indices = sampleIndices(rng, banks.acceptanceCriteria.length, count);
	indices.sort((left, right) => left - right);
	const criteria: string[] = [];
	for (const index of indices) {
		criteria.push(banks.acceptanceCriteria[index]!);
	}
	return criteria;
}

// Composition law (deterministic, per instance):
// - brief = opener + 1-2 evidence fragments + constraint + deliverable, chosen from the
//   scenario's fixed fragment banks (4-6 fragments per bank) by the per-instance RNG.
// - contextFiles: 3-6 entries drawn without replacement from the fixed 24-path synthetic
//   repo table; lines drawn from 40..900 in steps of 20; relevance drawn from 0.3..1.0
//   (lines are exact step values, relevance is rounded to two decimals); emitted in
//   ascending path order.
// - obstacles: 1-3 entries drawn without replacement from the fixed 8-kind table; severity
//   drawn from 0.2..0.9 and rounded to two decimals; emitted in ascending kind order.
// - acceptanceCriteria: 2-4 entries chosen from the scenario's canonical criterion bank and
//   emitted in fixed canonical (bank) order.
// - difficulty = clamp(0.05, 0.95, difficultyBase + 0.25 * avgObstacleSeverity + jitter),
//   with jitter drawn from -0.05..+0.05 as the final RNG draw of the instance.
// - Draw order (fixed): context count, context indices, per-file lines+relevance, obstacle
//   count, obstacle indices, per-obstacle severity, brief opener, evidence count, evidence
//   indices, constraint, deliverable, criterion count, criterion indices, difficulty jitter.
function generateInstance(scenario: TaskScenario, banks: ScenarioBanks, evidenceLevel: LabEvidenceLevel, seed: number, instanceIndex: number): WorldInstance {
	const subSeed = fnv1a32(`${scenario.id}:${seed}:${instanceIndex}`);
	const rng = mulberry32(subSeed);
	const contextFiles = drawContextFiles(rng);
	const obstacles = drawObstacles(rng);
	const brief = composeBrief(banks, rng);
	const acceptanceCriteria = drawAcceptanceCriteria(banks, rng);
	const totalSeverity = obstacles.reduce((sum, obstacle) => sum + obstacle.severity, 0);
	const averageSeverity = obstacles.length > 0 ? totalSeverity / obstacles.length : 0;
	const jitter = rng() * (2 * JITTER_HALF_WIDTH) - JITTER_HALF_WIDTH;
	const difficulty = clampNumber(DIFFICULTY_FLOOR, DIFFICULTY_CEILING, scenario.difficultyBase + OBSTACLE_SEVERITY_WEIGHT * averageSeverity + jitter);
	return {
		scenarioId: scenario.id,
		seed,
		instanceIndex,
		brief,
		contextFiles,
		obstacles,
		acceptanceCriteria,
		difficulty,
		evidenceLevel,
	};
}

/** Deterministically generate count instances (indices 0..count-1) of the given scenario; every instance is a pure function of (scenarioId, seed, instanceIndex) via the per-instance sub-seed fnv1a32('scenarioId:seed:instanceIndex'), so the stream is independent of count and of sibling order; returns [] iff the scenarioId is unknown or count <= 0. */
export function generateInstances(scenarioId: string, seed: number, count: number): WorldInstance[] {
	const scenario = getScenario(scenarioId);
	if (scenario === undefined || count <= 0) {
		return [];
	}
	const banks = SCENARIO_BANKS.get(scenario.id);
	const world = getWorld(scenario.worldId);
	if (banks === undefined || world === undefined) {
		return [];
	}
	const instances: WorldInstance[] = [];
	for (let instanceIndex = 0; instanceIndex < count; instanceIndex++) {
		instances.push(generateInstance(scenario, banks, world.world.evidenceLevel, seed, instanceIndex));
	}
	return instances;
}

// --------------------------------------------------------------------------------------------
// Information boundary
// --------------------------------------------------------------------------------------------

/** The agent-lane payload: everything except acceptanceCriteria and difficulty; visible arrays are copied so the agent lane cannot mutate the recorded instance. */
export interface VisibleInstancePayload {
	/** Id of the scenario this payload was generated for. */
	scenarioId: string;
	/** 0-based index of the instance within the run. */
	instanceIndex: number;
	/** Task brief composed from the scenario's fragment banks. */
	brief: string;
	/** 3-6 files from the 24-path synthetic repo layout. */
	contextFiles: { path: string; lines: number; relevance: number }[];
	/** 1-3 obstacles from the fixed 8-kind table. */
	obstacles: { kind: string; severity: number }[];
	/** Evidence level of the originating world  -  never overstated. */
	evidenceLevel: LabEvidenceLevel;
}

export function visiblePayload(instance: WorldInstance): VisibleInstancePayload {
	return {
		scenarioId: instance.scenarioId,
		instanceIndex: instance.instanceIndex,
		brief: instance.brief,
		contextFiles: instance.contextFiles.map((file) => ({ path: file.path, lines: file.lines, relevance: file.relevance })),
		obstacles: instance.obstacles.map((obstacle) => ({ kind: obstacle.kind, severity: obstacle.severity })),
		evidenceLevel: instance.evidenceLevel,
	};
}

// --------------------------------------------------------------------------------------------
// Pure lookups
// --------------------------------------------------------------------------------------------

/** Look up a task world by its worldId (pure). */
export function getWorld(worldId: string): TaskWorldDescriptor | undefined {
	return TASK_WORLDS.find((world) => world.world.worldId === worldId);
}

/** List all task worlds (pure; returns a fresh array). */
export function listWorlds(): TaskWorldDescriptor[] {
	return TASK_WORLDS.slice();
}

/** Look up a scenario by its id across all worlds (pure). */
export function getScenario(scenarioId: string): TaskScenario | undefined {
	for (const world of TASK_WORLDS) {
		const scenario = world.taskScenarios.find((candidate) => candidate.id === scenarioId);
		if (scenario !== undefined) {
			return scenario;
		}
	}
	return undefined;
}

/** Look up a world's WorldModelVersion by its worldId (pure). */
export function worldModelVersion(worldId: string): WorldModelVersion | undefined {
	const world = getWorld(worldId);
	return world === undefined ? undefined : world.world;
}
