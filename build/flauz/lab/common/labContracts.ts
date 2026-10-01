/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Engineering Lab contracts: versioned data contracts, constants, and pure guards for the
 * Flauz Engineering Lab. Zero-dependency by law — this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`/`new Date()` inside Lab engine code.
 * All randomness flows through seeded RNG inputs (seeds are explicit contract fields);
 * timestamps are plain strings set only at persistence edges.
 *
 * SCOPING LAW: Lab state is workspace/tenant scoped — every persisted record carries
 * `scope: LabScope` and `contractVersion: string`.
 */

/**
 * Version of this contract set; a record is current only when its `contractVersion` matches exactly.
 */
export const LAB_CONTRACTS_VERSION = '1.0.0';

/**
 * Workspace/tenant scoping tuple attached to every persisted Lab record.
 */
export interface LabScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * One normalized workload signal feeding a WorkloadProfile.
 */
export interface WorkloadSignal {
	kind: string;
	label: string;
	weight: number; // 0..1
	value: number; // 0..1
}

/**
 * Fixture or learned workload profile driving Lab experiment selection.
 */
export interface WorkloadProfile {
	scope: LabScope;
	contractVersion: string;
	id: string;
	name: string;
	description: string;
	signals: WorkloadSignal[];
	taskMix: { taskTypeId: string; share: number }[]; // shares sum ~1
	budgetUsdPerTask: number;
	latencySlaMinutes: number;
	source: 'fixture' | 'learned';
	learning: { optIn: boolean; retentionDays: number; exportable: boolean }; // user governance; LAB-002 fills the learner
}

/**
 * Descriptor of one task type in the Lab taxonomy.
 */
export interface TaskTypeDescriptor {
	scope: LabScope;
	contractVersion: string;
	id: string;
	name: string;
	family: 'implementation' | 'review' | 'investigation' | 'maintenance';
	complexity: number; // 0..1
	contextNeeds: number; // 0..1
	verificationStyle: 'tests' | 'review' | 'runtime-check' | 'diff-inspection';
	typicalTools: string[];
	typicalObstacles: string[];
}

/**
 * World-scoped task generator configuration.
 */
export interface TaskScenario {
	scope: LabScope;
	contractVersion: string;
	id: string;
	worldId: string;
	taskTypeId: string;
	name: string;
	description: string;
	difficultyBase: number; // 0..1
	instanceCount: number;
	perturbations: string[];
}

/**
 * Evidence ladder level: 0 closed-form, 1 instance sim, 2 multi-seed robustness.
 */
export type LadderLevel = 0 | 1 | 2;

/**
 * Lab-level experiment scenario binding a task scenario to ladder level, seeds, and utility weights.
 */
export interface LabScenario {
	scope: LabScope;
	contractVersion: string;
	id: string;
	name: string;
	description: string;
	taskScenarioId: string;
	ladderLevel: LadderLevel;
	seeds: number[];
	utilityWeights: Record<'success' | 'quality' | 'latency' | 'cost', number>; // non-negative, sum 1
}

/**
 * Evidence level for a world model; never overstate it.
 */
export type LabEvidenceLevel = 'fixture' | 'simulated' | 'local-real' | 'runtime-real' | 'live-provider' | 'production-real';

/**
 * Provenance record for one world model version (world-scoped, hence no LabScope).
 */
export interface WorldModelVersion {
	worldId: string;
	version: string;
	domain: string; // e.g. 'software-engineering'
	seedPolicy: 'fixed' | 'sweep';
	evidenceLevel: LabEvidenceLevel;
	provenance: string;
}

/**
 * Model-independent agent body archetype.
 */
export type BodyArchetype = 'planner' | 'coder' | 'reviewer' | 'verifier' | 'researcher' | 'integrator';

/**
 * Model-independent agent body definition; the Lab composes bodies into organizations.
 */
export interface AgentBodyDescriptor {
	scope: LabScope;
	contractVersion: string;
	id: string;
	name: string;
	archetype: BodyArchetype;
	description: string;
	role: string;
	inputContract: string;
	outputContract: string;
	tools: string[];
	permissions: string[];
	memory: 'none' | 'session' | 'persistent';
	communication: string[];
	capabilities: Record<string, number>; // capabilityId -> 0..1
	budget: { maxCostUsd: number; maxLatencyMs: number };
	evaluationHooks: string[];
	modelAgnostic: true;
}

/**
 * Topology shape of an organization candidate.
 */
export type OrgTopology = 'single' | 'pipeline' | 'hierarchical' | 'hub-and-spoke';

/**
 * One node in an organization candidate.
 */
export interface OrgNode {
	id: string;
	bodyId: string;
	role: string;
	reportsTo?: string;
}

/**
 * One directed edge in an organization candidate.
 */
export interface OrgEdge {
	from: string;
	to: string;
	kind: 'delegation' | 'review' | 'handoff';
}

/**
 * Assignment of a model to one organization node.
 */
export interface ModelOccupancy {
	nodeId: string;
	modelId: string;
}

/**
 * Assignment of tools to one organization node.
 */
export interface CapabilityAllocation {
	nodeId: string;
	toolIds: string[];
}

/**
 * A candidate multi-agent organization: topology + model occupancy + capability allocation.
 */
export interface OrganizationCandidate {
	scope: LabScope;
	contractVersion: string;
	id: string;
	name: string;
	topology: OrgTopology;
	nodes: OrgNode[];
	edges: OrgEdge[];
	occupancy: ModelOccupancy[];
	capabilities: CapabilityAllocation[];
	notes?: string;
}

/**
 * A capability requirement; the Lab never silently grants permissions.
 */
export interface CapabilityRequirement {
	scope: LabScope;
	contractVersion: string;
	id: string;
	capabilityId: string;
	requiredLevel: number; // 0..1
	status: 'unavailable' | 'acquisition-path' | 'verification' | 'available';
	providerPath?: string;
	version?: string;
	grantRequiresApproval: true;
}

/**
 * Lifecycle status of a Lab run.
 */
export type LabRunStatus = 'draft' | 'queued' | 'running' | 'evaluated' | 'recommended' | 'failed';

/**
 * One experiment run through the Lab.
 */
export interface LabRun {
	scope: LabScope;
	contractVersion: string;
	id: string;
	spec: { workloadId: string; taskTypeId: string; scenarioId: string; ladderLevel: LadderLevel; seeds: number[] };
	status: LabRunStatus;
	worldModel: WorldModelVersion;
	createdAt: string;
	completedAt?: string;
	error?: string;
}

/**
 * Legal LabRun status transitions; an empty list marks a terminal status.
 */
export const labRunStatusTransitions: Record<LabRunStatus, LabRunStatus[]> = {
	draft: ['queued'],
	queued: ['running', 'failed'],
	running: ['evaluated', 'failed'],
	evaluated: ['recommended', 'failed'],
	recommended: [],
	failed: [],
};

/**
 * Pure lookup: reports whether `from` -> `to` is a legal LabRun status transition.
 */
export function canTransitionLabRunStatus(from: LabRunStatus, to: LabRunStatus): boolean {
	return labRunStatusTransitions[from].includes(to);
}

/**
 * Dimension an evaluation can score.
 */
export type EvalDimension = 'success' | 'quality' | 'latency' | 'cost';

/**
 * One scored dimension of an evaluation.
 */
export interface EvalScore {
	dimension: EvalDimension;
	value: number;
	unit?: string;
}

/**
 * Candidate-vs-baseline delta on one dimension; positive ALWAYS means better.
 */
export interface BaselineComparison {
	dimension: EvalDimension;
	candidateValue: number;
	baselineValue: number;
	delta: number; // candidate-baseline for quality/success, baseline-candidate for latency/cost
}

/**
 * Robustness statistics across seeds and perturbations.
 */
export interface RobustnessReport {
	seedsEvaluated: number;
	perturbations: string[];
	seedVariance: { dimension: EvalDimension; variance: number }[];
	worstCase: { dimension: EvalDimension; value: number }[];
	uncertainty: { dimension: EvalDimension; low: number; high: number; confidence: number }[];
}

/**
 * Evaluation report for a run, always computed against a single-agent baseline.
 */
export interface EvaluationReport {
	scope: LabScope;
	contractVersion: string;
	id: string;
	runId: string;
	candidate: OrganizationCandidate;
	scores: EvalScore[];
	utility: number;
	comparison: BaselineComparison[];
	robustness?: RobustnessReport; // present iff ladderLevel >= 2
	ensembleAgreement?: number;
	oodDistance?: number;
	costUsd: number;
	latencyMs: number;
	safetyCompliance: { check: string; passed: boolean }[];
	reproducible: { seed: number; artifactHash?: string }[];
	evidenceLevel: LabEvidenceLevel; // a fixture run MUST be labeled 'fixture' — never overstate
}

/**
 * One calibration observation linking predicted to observed performance.
 */
export interface CalibrationRecord {
	scope: LabScope;
	contractVersion: string;
	id: string;
	recommendationId: string;
	dimension: EvalDimension;
	predicted: number;
	observed: number;
	factor: number; // observed/predicted, clamped 0.5..2.0
	observedAt: string;
}

/**
 * A reversible, auditable recommendation issued by the Lab.
 */
export interface LabRecommendation {
	scope: LabScope;
	contractVersion: string;
	id: string;
	runId: string;
	organization: OrganizationCandidate;
	rationale: string;
	expectedGains: BaselineComparison[];
	confidence: number; // 0..1
	caveats: string[];
	reversible: true;
	auditTrail: string[];
	status: 'issued' | 'applied' | 'reverted';
	createdAt: string;
}

/**
 * Closed-loop link chaining a run to its evaluation, recommendation, and field observations.
 */
export interface ExperimentLink {
	scope: LabScope;
	contractVersion: string;
	id: string;
	runId: string;
	evaluationId?: string;
	recommendationId?: string;
	bridgeEntryId?: string;
	observationId?: string;
	createdAt: string;
}

/**
 * Request payload for executing one task instance through the execution port.
 */
export interface ExecutionRequest {
	instanceId: string;
	scenarioSeed: number;
	organization: OrganizationCandidate;
}

/**
 * Outcome of one executed task instance.
 */
export interface TaskOutcome {
	success: boolean;
	quality: number;
	latencyMs: number;
	costUsd: number;
	verification: { check: string; passed: boolean }[];
}

/**
 * The Lab's ONLY door to task execution: a real 'flauz' adapter may only be wired behind Agent OS authorization/approvals/leases/browser policy/environment trust — the Lab NEVER bypasses Agent OS.
 */
export interface LabExecutionPort {
	readonly id: string;
	readonly mode: 'fixture' | 'flauz';
	executeTask(req: ExecutionRequest): Promise<TaskOutcome>;
}

/**
 * Guard: true iff the record pins the exact current LAB_CONTRACTS_VERSION.
 */
export function isVersionedLabRecord(record: { contractVersion?: string }): boolean {
	return record.contractVersion === LAB_CONTRACTS_VERSION;
}

/**
 * Guard: true iff all four utility weights are non-negative and sum to ~1 (0.999..1.001).
 */
export function isValidUtilityWeights(w: Record<'success' | 'quality' | 'latency' | 'cost', number>): boolean {
	let sum = 0;
	for (const weight of [w.success, w.quality, w.latency, w.cost]) {
		if (weight < 0) {
			return false;
		}
		sum += weight;
	}
	return sum >= 0.999 && sum <= 1.001;
}
