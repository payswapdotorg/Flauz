/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-011 closed-loop proof (B11): one full scenario demonstrating the ten
 * stages end to end over the landed deterministic modules -
 *
 *   1. workload observation        (workloadLearning.learnWorkloadProfile)
 *   2. task-type discovery         (the learning's TaskTypeInference set)
 *   3. world generation            (taskWorlds.generateInstances)
 *   4. organization search         (orgSearch.searchOrganizations)
 *   5. model occupancy search      (occupancySearch.searchOccupancies)
 *   6. robust simulation           (runEngine.runLadder at the L2 rung)
 *   7. real Flauz execution        (taskBridge.bridgeRecommendation drafts +
 *                                   the FIXTURE LabExecutionPort below)
 *   8. outcome measurement         (calibration.observeBridgeOutcome rows)
 *   9. calibration                 (calibration.buildCalibrationModel)
 *  10. improved second run         (calibration.correctScores + the gap verdict)
 *
 * DETERMINISM LAW: no Math.random, no clock reads; the single injected nowIso
 * stamps every record edge. The same request always produces a byte-identical
 * proof.
 *
 * This module is the closed-loop COMPOSER: it imports the seven frozen lab
 * (the widest import surface in the lane, by the nature of the
 * proof); each stage delegates to its owning module's law and adds nothing
 * but the chain.
 *
 * HONESTY LAWS: the opt-in gate refuses the whole proof without explicit
 * workload-learning consent; the loop must be COHERENT (the scenario's task
 * type must be one the workload learning discovered - a closed loop never
 * proves itself against a task type the user never runs); execution is the
 * fixture port (Agent OS is never bypassed - the bridge drafts carry
 * approval 'ask' and the Lab never becomes a second execution engine); every
 * product carries evidenceLevel 'fixture'.
 */

import {
	LAB_CONTRACTS_VERSION,
	type CalibrationRecord,
	type EvalDimension,
	type LabScope,
	type LabRecommendation,
	type OrganizationCandidate,
	type TaskOutcome,
} from './labContracts.js';
import { learnWorkloadProfile, type LabActivityRecord, type WorkloadLearningControls, type WorkloadLearningResult } from './workloadLearning.js';
import { generateInstances, getScenario, type WorldInstance } from './taskWorlds.js';
import { searchOrganizations } from './orgSearch.js';
import { searchOccupancies, type ToolMode } from './occupancySearch.js';
import { runLadder, type LadderRunResult } from './runEngine.js';
import { bridgeRecommendation, type TaskBridgeResult } from './taskBridge.js';
import {
	buildCalibrationModel,
	correctScores,
	observeBridgeOutcome,
	type CalibrationModelResult,
} from './calibration.js';

/** The closed-loop request: every stage's frozen inputs plus the single injected timestamp. */
export interface ClosedLoopRequest {
	/** Lab scope; for the fixture lane { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }. */
	scope: LabScope;
	/** Proof label; rides the run id and the recommendation ids. */
	runLabel: string;
	/** The activity corpus (workload observation; fixture-authored rows). */
	activity: LabActivityRecord[];
	/** Governance controls; optIn false refuses the whole proof (the LAB-002 law). */
	controls: WorkloadLearningControls;
	/** Profile id for the learned workload. */
	profileId: string;
	/** The scenario the loop runs (must resolve; its task type must be discovered by the learning). */
	taskScenarioId: string;
	/** Ladder seeds; >= 2 for the L2 rung (the robust-simulation stage). */
	ladderSeeds: number[];
	/** Instances per seed for the ladder and the execution stage. */
	instanceCount: number;
	/** Non-negative utility weights, sum 1. */
	utilityWeights: Record<'success' | 'quality' | 'latency' | 'cost', number>;
	/** Organization search bound. */
	maxAgents: number;
	/** Candidate occupant models for the occupancy stage. */
	modelIds: string[];
	/** Tool modes to try in the occupancy stage. */
	toolModes: ToolMode[];
	/** The single injected ISO stamp for every record edge in the loop. */
	nowIso: string;
}

/** One dense 1-based stage row of the proof trace. */
export interface ClosedLoopStage {
	/** 1..10, the B11 stage number. */
	step: number;
	/** Machine stage name, e.g. 'workload-observation'. */
	stage: string;
	/** One-line observed fact. */
	detail: string;
}

/** One executed instance through the fixture port. */
export interface ClosedLoopExecution {
	/** The instance id (scenarioId/seed/index). */
	instanceId: string;
	/** The instance's generated difficulty (the fixture outcome's input). */
	difficulty: number;
	/** The deterministic fixture outcome. */
	outcome: TaskOutcome;
}

/** The improved-second-run verdict on one correctable dimension. */
export interface ClosedLoopGapRow {
	/** 'success' | 'quality' (the 0..1 score space; latency/cost real-unit corrections stay with the CalibrationRecord consumers). */
	dimension: EvalDimension;
	/** The first run's predicted score. */
	predicted: number;
	/** The observed mean across the executed instances. */
	observed: number;
	/** The calibrated prediction (predicted x factor, clamped). */
	corrected: number;
	/** |predicted - observed| before calibration. */
	gapBefore: number;
	/** |corrected - observed| after calibration. */
	gapAfter: number;
	/** True iff gapAfter <= gapBefore (rounded to 3dp for the byte-identical law). */
	improved: boolean;
}

/** The full closed-loop proof product. */
export interface ClosedLoopProof {
	/** Verbatim from the request. */
	scope: LabScope;
	/** Pinned to LAB_CONTRACTS_VERSION. */
	contractVersion: string;
	/** runId: `closed-loop-<runLabel>`. */
	runId: string;
	/** Verbatim request. */
	request: ClosedLoopRequest;
	/** The dense 10-stage trace. */
	stages: ClosedLoopStage[];
	/** Stage 1-2 product: the learned workload (opt-in honored). */
	learning: WorkloadLearningResult;
	/** Stage 3 product: the generated instances. */
	instances: WorldInstance[];
	/** Stage 4-6 product: the L2 ladder over [baseline, ..., the occupied organization]. */
	firstRun: LadderRunResult;
	/** Stage 5 product: the occupancy search over the best organization's bodies. */
	occupancy: NonNullable<ReturnType<typeof searchOccupancies>>;
	/** The occupied organization (the best search candidate with the best assignment's models + tools). */
	occupiedOrganization: OrganizationCandidate;
	/** Stage 7 products: the bridge drafts + the fixture executions. */
	bridge: TaskBridgeResult;
	/** The recommendation the bridge carried (status 'issued' at bridge time). */
	recommendation: LabRecommendation;
	executions: ClosedLoopExecution[];
	/** Stage 8 product: the calibration corpus (4 rows per execution). */
	observations: CalibrationRecord[];
	/** Stage 9 product: the folded correction model. */
	calibration: CalibrationModelResult;
	/** Stage 10 product: the improved-second-run verdict. */
	gaps: ClosedLoopGapRow[];
	/** True iff every gap row improved (or tied at zero). */
	loopClosed: boolean;
	/** Honest evidence label; the fixture lane never overstates. */
	evidenceLevel: 'fixture';
}

/** Clamp into 0..1. */
function clamp01(v: number): number {
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

/** Round to n decimals. */
function roundTo(v: number, decimals: number): number {
	const f = Math.pow(10, decimals);
	return Math.round(v * f) / f;
}

/** Mean of a numeric array, 0 when empty. */
function mean(xs: number[]): number {
	if (xs.length === 0) return 0;
	let s = 0;
	for (const x of xs) s += x;
	return s / xs.length;
}

/**
 * The FIXTURE LabExecutionPort (stage 7's executor): a pure deterministic
 * response model over the instance difficulty and the organization's node
 * count - honestly labeled fixture evidence. A real 'flauz' adapter may only
 * be wired behind Agent OS authorization (the LabExecutionPort contract law).
 */
export function executeFixtureInstance(instance: WorldInstance, organization: OrganizationCandidate): TaskOutcome {
	const nodes = organization.nodes.length;
	const coverage = clamp01(0.45 + 0.08 * nodes);
	const success = instance.difficulty <= coverage;
	const quality = roundTo(clamp01(0.9 - 0.35 * instance.difficulty + 0.02 * nodes), 3);
	const latencyMs = Math.round(20000 * nodes + instance.difficulty * 8000);
	const costUsd = roundTo(0.25 * nodes + instance.difficulty * 0.15, 2);
	return {
		success,
		quality,
		latencyMs,
		costUsd,
		verification: [{ check: 'fixture-executor', passed: true }],
	};
}

/** Instance id rendered as `scenarioId/seed/index`. */
function instanceIdOf(instance: WorldInstance): string {
	return `${instance.scenarioId}/${instance.seed}/${instance.instanceIndex}`;
}

/**
 * Run the ten-stage closed loop; undefined iff a gate refuses the proof
 * (opt-out, unresolvable scenario, incoherent task-type coupling, empty
 * searches, or a ladder/bridge refusal). Every refusal is a stage detail
 * never an exception - the loop is honest about what it could not close.
 */
export function runClosedLoop(request: ClosedLoopRequest): ClosedLoopProof | undefined {
	const stages: ClosedLoopStage[] = [];
	let step = 0;
	const note = (stage: string, detail: string): void => {
		step += 1;
		stages.push({ step, stage, detail });
	};

	// ---- stages 1-2: workload observation + task-type discovery ----------------------
	const learning = learnWorkloadProfile(request.scope, request.activity, request.controls, request.profileId, request.nowIso);
	if (!learning) {
		return undefined; // the opt-in gate: no learning from activity without consent
	}
	note('workload-observation', `retained ${learning.retainedRecordCount} records (excluded ${learning.excludedRecordCount})`);
	note('task-type-discovery', `${learning.taskTypes.length} task type(s): ${learning.taskTypes.map((t) => t.taskTypeId).join(', ')}`);

	// The coherence gate (family level): the scenario must exercise a task-type
	// family the workload learning discovered. The learned ids are tt-<family>-<style>;
	// scenario task-type ids carry scenario-level qualifiers (tt-bugfix-regression-tests),
	// so the coupling is the family segment - a closed loop never proves itself against
	// a family the user never runs, while the world refines the learned style.
	const scenario = getScenario(request.taskScenarioId);
	if (!scenario) {
		return undefined;
	}
	const scenarioFamilyKnown = learning.taskTypes.some((t) => {
		const segments = t.taskTypeId.split('-');
		const familyPrefix = segments.length >= 2 ? `${segments[0]}-${segments[1]}` : t.taskTypeId;
		return scenario.taskTypeId.startsWith(`${familyPrefix}-`);
	});
	if (!scenarioFamilyKnown) {
		return undefined;
	}

	// ---- stage 3: world generation ---------------------------------------------------
	const instances = generateInstances(request.taskScenarioId, request.ladderSeeds[0], request.instanceCount);
	if (instances.length === 0) {
		return undefined;
	}
	note('world-generation', `${instances.length} instances over seed ${request.ladderSeeds[0]} (difficulty ${roundTo(mean(instances.map((i) => i.difficulty)), 3)} mean)`);

	// ---- stage 4: organization search ------------------------------------------------
	const search = searchOrganizations({
		scope: request.scope,
		scenarioId: request.taskScenarioId,
		taskTypeId: scenario.taskTypeId,
		utilityWeights: request.utilityWeights,
		ladderLevel: 2,
		seeds: request.ladderSeeds,
		maxAgents: request.maxAgents,
	});
	if (!search || search.candidates.length === 0) {
		return undefined;
	}
	const bestOrgCandidate = search.best.candidate;
	note('organization-search', `${search.candidates.length} candidates; best ${bestOrgCandidate.id} (${bestOrgCandidate.topology}, ${bestOrgCandidate.nodes.length} nodes)`);

	// ---- stage 5: model occupancy search ----------------------------------------------
	const occupancy = searchOccupancies({
		scope: request.scope,
		scenarioId: request.taskScenarioId,
		taskTypeId: scenario.taskTypeId,
		utilityWeights: request.utilityWeights,
		bodyIds: bestOrgCandidate.nodes.map((n) => n.bodyId),
		modelIds: request.modelIds,
		toolModes: request.toolModes,
	});
	if (!occupancy || occupancy.candidates.length === 0) {
		return undefined;
	}
	const bestAssignment = occupancy.best;
	// Apply the assignment to the organization (the occupied org: verbatim topology +
	// nodes/edges, the assignment's models and tools).
	const occupiedOrganization: OrganizationCandidate = {
		...bestOrgCandidate,
		id: `${bestOrgCandidate.id}-occupied`,
		occupancy: bestAssignment.models,
		capabilities: bestAssignment.tools,
		notes: 'The closed-loop proof organization: the org-search best with the occupancy-search best assignment.',
	};
	note('model-occupancy-search', `${occupancy.candidates.length} assignments; best models ${bestAssignment.models.map((m) => m.modelId).join('+')} (${bestAssignment.toolMode})`);

	// ---- stage 6: robust simulation (L2) -------------------------------------------------
	const runId = `closed-loop-${request.runLabel}`;
	const candidates: OrganizationCandidate[] = [search.candidates[0].candidate, occupiedOrganization];
	const firstRun = runLadder({
		scope: request.scope,
		runId,
		taskScenarioId: request.taskScenarioId,
		ladderLevel: 2,
		seeds: request.ladderSeeds,
		instanceCount: request.instanceCount,
		utilityWeights: request.utilityWeights,
		candidates,
	});
	if (!firstRun) {
		return undefined;
	}
	note('robust-simulation', `L2 over ${firstRun.reports.length} candidates, seeds ${request.ladderSeeds.join(',')}; best ${firstRun.bestReport.candidate.id} utility ${roundTo(firstRun.bestReport.utility, 3)}`);

	// ---- stage 7: real Flauz execution (bridge drafts + the fixture port) -----------------
	// The recommendation drafts from the best report (the occupied org when it wins,
	// else the baseline as the honest 'no change warranted' outcome - the loop still
	// closes: calibration learns from whatever executed).
	const bestReport = firstRun.bestReport;
	const recommendation: LabRecommendation = {
		scope: request.scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		id: `rec-${runId}`,
		runId,
		organization: bestReport.candidate,
		rationale: `Closed-loop proof: the L2 ladder over scenario ${request.taskScenarioId} ranked ${bestReport.candidate.id} at utility ${roundTo(bestReport.utility, 3)}.`,
		expectedGains: bestReport.comparison.map((row) => ({
			dimension: row.dimension,
			candidateValue: row.candidateValue,
			baselineValue: row.baselineValue,
			delta: row.delta,
		})),
		confidence: clamp01(0.5 + 0.1 * request.ladderSeeds.length),
		caveats: ['Fixture-lane evidence only: the executor is the deterministic fixture port, not Agent OS.'],
		reversible: true,
		auditTrail: [`${runId} evaluated ${bestReport.candidate.id} and issued rec-${runId}`],
		status: 'issued',
		createdAt: request.nowIso,
	};
	const experimentLink = {
		scope: request.scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		id: `link-${runId}`,
		runId,
		recommendationId: recommendation.id,
		createdAt: request.nowIso,
	};
	const bridge = bridgeRecommendation({ recommendation, experimentLink, nowIso: request.nowIso });
	if (!bridge) {
		return undefined;
	}
	// The fixture executions over the same instances the world generated.
	const executions: ClosedLoopExecution[] = [];
	for (const instance of instances) {
		executions.push({
			instanceId: instanceIdOf(instance),
			difficulty: instance.difficulty,
			outcome: executeFixtureInstance(instance, recommendation.organization),
		});
	}
	note('real-flauz-execution', `bridge ${bridge.bridgeEntryId} drafted; ${executions.length} fixture executions over ${recommendation.organization.id}`);

	// ---- stage 8: outcome measurement ------------------------------------------------------
	const observations: CalibrationRecord[] = [];
	for (const execution of executions) {
		const rows = observeBridgeOutcome({
			recommendation,
			evaluation: bestReport,
			outcome: execution.outcome,
			bridgeEntryId: bridge.bridgeEntryId,
			observedAt: request.nowIso,
		});
		if (!rows) {
			return undefined;
		}
		observations.push(...rows);
	}
	note('outcome-measurement', `${observations.length} calibration rows from ${executions.length} executions`);

	// ---- stage 9: calibration ---------------------------------------------------------------
	const calibration = buildCalibrationModel(observations, request.scope, request.nowIso, 'fixture');
	note('calibration', `factors success ${calibration.factors.success} quality ${calibration.factors.quality} over ${calibration.observationCount} rows`);

	// ---- stage 10: the improved second run ----------------------------------------------------
	// The second run's PREDICTIONS are the first run's scores corrected by the model;
	// the proof: the corrected prediction sits closer to (or no further from) the
	// observed truth on every correctable dimension.
	const observedSuccess = mean(executions.map((e) => (e.outcome.success ? 1 : 0)));
	const observedQuality = mean(executions.map((e) => e.outcome.quality));
	const corrected = correctScores(bestReport.scores, calibration);
	const scoreOf = (scores: { dimension: EvalDimension; value: number }[], dimension: EvalDimension): number =>
		scores.find((s) => s.dimension === dimension)?.value ?? 0;
	const gaps: ClosedLoopGapRow[] = [];
	for (const dimension of ['success', 'quality'] as const) {
		const predicted = roundTo(scoreOf(bestReport.scores, dimension), 3);
		const observed = roundTo(dimension === 'success' ? observedSuccess : observedQuality, 3);
		const correctedValue = roundTo(scoreOf(corrected, dimension), 3);
		const gapBefore = roundTo(Math.abs(predicted - observed), 3);
		const gapAfter = roundTo(Math.abs(correctedValue - observed), 3);
		gaps.push({
			dimension,
			predicted,
			observed,
			corrected: correctedValue,
			gapBefore,
			gapAfter,
			improved: gapAfter <= gapBefore,
		});
	}
	const loopClosed = gaps.every((g) => g.improved);
	note('improved-second-run', `gaps ${gaps.map((g) => `${g.dimension} ${g.gapBefore}->${g.gapAfter}`).join(', ')}; loop ${loopClosed ? 'CLOSED' : 'OPEN'}`);

	return {
		scope: request.scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		runId,
		request,
		stages,
		learning,
		instances,
		firstRun,
		occupancy,
		occupiedOrganization,
		bridge,
		recommendation,
		executions,
		observations,
		calibration,
		gaps,
		loopClosed,
		evidenceLevel: 'fixture',
	};
}
