/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-005 (Flauz lab, TL-B lane): deterministic organization search over the LAB-004 fixture
 * body catalog  -  candidate enumeration, fixture utility scoring, ranking and a search trace.
 *
 * DETERMINISM LAW: this module contains no Math.random, no Date.now and no new Date(), no
 * sampling and no environment reads of any kind  -  the search is a PURE DETERMINISTIC
 * ENUMERATION, so the same OrgSearchRequest always yields a byte-identical OrgSearchResult
 * (same candidates, same order, same trace). The difficulty and required-capability tables
 * are fixture constants (the LAB-003 world seam). Every occupancy records the FIXED fixture
 * model id (FIXTURE_MODEL_ID)  -  this module is NOT a second model router; the Model Fabric
 * keeps routing authority. Multi-seed robustness evaluation is LAB-007 and out of scope here;
 * `seeds` is recorded for provenance only and never influences the search.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type OrganizationCandidate, type EvalScore, type LadderLevel, type LabEvidenceLevel } from './labContracts.js';
import { AGENT_BODY_CATALOG, instantiateBody, assembleOrganization, capabilityCoverage, type BodyInstantiation } from './agentBodies.js';

/** Fixture difficulty per scenario id (the LAB-003 world seam); unknown ids fall back to '_default' (0.5). */
export const FIXTURE_SCENARIO_DIFFICULTY: Record<string, number> = {
	'scenario-se-bugfix-regression': 0.45,
	'scenario-se-feature-addition': 0.6,
	'scenario-se-flaky-investigation': 0.5,
	'_default': 0.5,
};

/** The fixed fixture model id seated in every occupancy (no second router  -  the Model Fabric owns routing). */
export const FIXTURE_MODEL_ID = 'model-fixture-m';

/** Required capabilities per task type id (LAB-002 tt-<family>-<style> convention); unknown ids fall back to '_default'. */
export const FIXTURE_REQUIRED_CAPABILITIES: Record<string, { capabilityId: string; requiredLevel: number }[]> = {
	'tt-bugfix-regression': [
		{ capabilityId: 'code-writing', requiredLevel: 0.6 },
		{ capabilityId: 'debugging', requiredLevel: 0.7 },
		{ capabilityId: 'test-design', requiredLevel: 0.4 },
	],
	'tt-feature-addition': [
		{ capabilityId: 'planning', requiredLevel: 0.5 },
		{ capabilityId: 'code-writing', requiredLevel: 0.7 },
		{ capabilityId: 'test-design', requiredLevel: 0.5 },
		{ capabilityId: 'code-review', requiredLevel: 0.4 },
	],
	'tt-flaky-investigation': [
		{ capabilityId: 'research', requiredLevel: 0.5 },
		{ capabilityId: 'debugging', requiredLevel: 0.6 },
		{ capabilityId: 'test-design', requiredLevel: 0.3 },
	],
	'_default': [
		{ capabilityId: 'code-writing', requiredLevel: 0.5 },
		{ capabilityId: 'debugging', requiredLevel: 0.4 },
	],
};

/** Organization search request (fixture lane); consumed deterministically and never mutated. */
export interface OrgSearchRequest {
	scope: LabScope; // { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }
	scenarioId: string; // fixture difficulty lookup
	taskTypeId: string; // required-capability lookup
	utilityWeights: Record<'success' | 'quality' | 'latency' | 'cost', number>; // non-negative, sum 1
	ladderLevel: LadderLevel; // recorded on results (0/1/2); the search itself is level-agnostic
	seeds: number[]; // recorded for provenance (multi-seed evaluation is LAB-007)
	maxAgents: number; // search bound, clamped to 1..5
}

/** One scored candidate (fixture evidence, honestly labeled). */
export interface ScoredCandidate {
	candidate: OrganizationCandidate; // the assembled organization (LAB-004 bodies, fixture model)
	scores: EvalScore[]; // success, quality (0..1 higher-better), latency, cost (0..1 LOWER-better)
	utility: number; // w.success*s + w.quality*q + w.latency*(1-latency) + w.cost*(1-cost)
	coveredCapabilities: number; // count of required capabilities covered
	evidenceLevel: LabEvidenceLevel; // always 'fixture' in this lane
}

/** One search-trace step (provenance: what the search did, in order). */
export interface SearchStep {
	step: number; // 1-based, dense
	kind: 'enumerate' | 'score' | 'rank';
	detail: string;
}

/** Full search result: verbatim request echo, the always-present baseline, ranked candidates, best and trace. */
export interface OrgSearchResult {
	scope: LabScope; // copied verbatim from the request
	contractVersion: string; // LAB_CONTRACTS_VERSION
	request: OrgSearchRequest; // verbatim (snapshot copy, insulated from later caller mutations)
	baseline: ScoredCandidate; // the ALWAYS-present single-agent baseline (body-solo-generalist, topology 'single')
	candidates: ScoredCandidate[]; // ALL scored candidates incl. the baseline, ranked
	best: ScoredCandidate; // candidates[0]
	trace: SearchStep[]; // enumerate -> score -> rank steps
}

/** Catalog body descriptor as carried by a BodyInstantiation (only id and tools are ever read here). */
type BodyDescriptor = BodyInstantiation['body'];

/** Defensively read a catalog body's id  -  the packet freezes the catalog ids, not the descriptor field name. */
function bodyIdOf(body: BodyDescriptor): string {
	const id = (body as { id?: unknown }).id;
	return typeof id === 'string' ? id : '';
}

/** Defensively read a catalog body's own tool ids (passed through verbatim to instantiateBody). */
function bodyToolIdsOf(body: BodyDescriptor): string[] {
	const toolIds = (body as { toolIds?: unknown }).toolIds;
	if (Array.isArray(toolIds)) {
		return toolIds.filter((toolId): toolId is string => typeof toolId === 'string');
	}
	const tools = (body as { tools?: unknown }).tools;
	if (Array.isArray(tools)) {
		const ids: string[] = [];
		for (const tool of tools) {
			if (typeof tool === 'string') {
				ids.push(tool);
			} else if (typeof tool === 'object' && tool !== null && typeof (tool as { id?: unknown }).id === 'string') {
				ids.push((tool as { id: string }).id);
			}
		}
		return ids;
	}
	return [];
}

/** Clamp a value into [0, 1] (all fixture scores are normalized). */
function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Clamp the agent-count search bound into 1..5; non-finite input falls back to 1 so the baseline always survives. */
function clampMaxAgents(maxAgents: number): number {
	if (typeof maxAgents !== 'number' || !Number.isFinite(maxAgents)) {
		return 1;
	}
	return Math.min(5, Math.max(1, Math.floor(maxAgents)));
}

/** All ascending index combinations of [0, count) taken `size` at a time, in canonical lexicographic order. */
function indexCombinations(count: number, size: number): number[][] {
	const combinations: number[][] = [];
	if (size < 1 || size > count) {
		return combinations;
	}
	const current: number[] = [];
	const visit = (start: number, depth: number): void => {
		if (depth === size) {
			combinations.push([...current]);
			return;
		}
		for (let index = start; index <= count - (size - depth); index++) {
			current.push(index);
			visit(index + 1, depth + 1);
			current.pop();
		}
	};
	visit(0, 0);
	return combinations;
}

/** Topologies searched at a given org size: n = 1 is always 'single'; n >= 2 searches the three multi-agent topologies. */
function topologiesForSize(n: number): OrganizationCandidate['topology'][] {
	if (n === 1) {
		return ['single'];
	}
	return ['pipeline', 'hierarchical', 'hub-and-spoke'];
}

/** Deterministic candidate id: org-<scenarioId>-n<n>-<topology>-<comboIndex>. */
function candidateIdOf(scenarioId: string, n: number, topology: OrganizationCandidate['topology'], comboIndex: number): string {
	return `org-${scenarioId}-n${n}-${topology}-${comboIndex}`;
}

/** Readable candidate name, e.g. 'Pipeline(2): body-planner-lead + body-implementer'. */
function candidateNameOf(topology: OrganizationCandidate['topology'], bodyIds: string[]): string {
	const label = topology.charAt(0).toUpperCase() + topology.slice(1);
	return `${label}(${bodyIds.length}): ${bodyIds.join(' + ')}`;
}

/** Total order for ranking: utility DESC, then candidate id ASC (ids are unique, so the order is total). */
function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
	if (a.utility !== b.utility) {
		return a.utility > b.utility ? -1 : 1;
	}
	if (a.candidate.id !== b.candidate.id) {
		return a.candidate.id < b.candidate.id ? -1 : 1;
	}
	return 0;
}

/** Utility weights must be finite, non-negative and sum to 1 within 1e-9. */
function isValidUtilityWeights(weights: OrgSearchRequest['utilityWeights']): boolean {
	const values = [weights.success, weights.quality, weights.latency, weights.cost];
	let sum = 0;
	for (const value of values) {
		if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
			return false;
		}
		sum += value;
	}
	return Math.abs(sum - 1) <= 1e-9;
}

/** Assemble one candidate from a body-index set (node-i ids, fixture model, the body's own tools, node-0 lead). */
function assembleCandidate(scope: LabScope, scenarioId: string, n: number, topology: OrganizationCandidate['topology'], comboIndex: number, bodyIndices: number[]): OrganizationCandidate | undefined {
	const instantiations: BodyInstantiation[] = [];
	const bodyIds: string[] = [];
	for (let i = 0; i < bodyIndices.length; i++) {
		const body = AGENT_BODY_CATALOG[bodyIndices[i]];
		if (!body) {
			return undefined;
		}
		const bodyId = bodyIdOf(body);
		const instantiation = instantiateBody(bodyId, {
			nodeId: `node-${i}`,
			modelId: FIXTURE_MODEL_ID,
			toolIds: bodyToolIdsOf(body),
		});
		if (!instantiation) {
			return undefined;
		}
		bodyIds.push(bodyId);
		instantiations.push(instantiation);
	}
	return assembleOrganization(
		scope,
		candidateIdOf(scenarioId, n, topology, comboIndex),
		candidateNameOf(topology, bodyIds),
		topology,
		instantiations,
		undefined,
		'node-0'
	);
}

/** Deterministic organization search (fixture lane); returns undefined iff the utility weights are invalid (negative, or sum not ~1 within 1e-9). */
export function searchOrganizations(request: OrgSearchRequest): OrgSearchResult | undefined {
	if (!isValidUtilityWeights(request.utilityWeights)) {
		return undefined;
	}
	const weights = request.utilityWeights;
	// Verbatim snapshot of the request and scope so later caller mutations cannot alias into the result.
	const scope: LabScope = { workspaceId: request.scope.workspaceId, tenantId: request.scope.tenantId };
	const requestSnapshot: OrgSearchRequest = {
		scope,
		scenarioId: request.scenarioId,
		taskTypeId: request.taskTypeId,
		utilityWeights: { ...request.utilityWeights },
		ladderLevel: request.ladderLevel,
		seeds: [...request.seeds],
		maxAgents: request.maxAgents,
	};
	// Fixture world seam: unknown scenario/task-type ids fall back to the '_default' entries.
	const required = FIXTURE_REQUIRED_CAPABILITIES[request.taskTypeId] ?? FIXTURE_REQUIRED_CAPABILITIES['_default'];
	const difficulty = FIXTURE_SCENARIO_DIFFICULTY[request.scenarioId] ?? FIXTURE_SCENARIO_DIFFICULTY['_default'];
	const catalogIds: string[] = [];
	for (const body of AGENT_BODY_CATALOG) {
		catalogIds.push(bodyIdOf(body));
	}
	const trace: SearchStep[] = [];
	let stepCounter = 0;
	const pushStep = (kind: SearchStep['kind'], detail: string): void => {
		stepCounter += 1;
		trace.push({ step: stepCounter, kind, detail });
	};
	// Enumeration law (deterministic): sizes n = 1..clamp(maxAgents, 1, 5); n = 1 uses only
	// topology 'single' while n >= 2 uses 'pipeline', 'hierarchical' and 'hub-and-spoke'; body
	// sets are the canonical ascending index combinations of the catalog taken n at a time
	// (catalog order); every body set x topology pair assembles exactly ONE candidate via
	// instantiateBody (nodeId 'node-<i>', modelId FIXTURE_MODEL_ID, the body's own tools) and
	// assembleOrganization (leadNodeId 'node-0'). The n = 1 body-solo-generalist 'single'
	// baseline is enumerated first (catalog index 0) and therefore survives every bound.
	const assembled: { candidate: OrganizationCandidate; bodyIds: string[] }[] = [];
	const maxN = clampMaxAgents(request.maxAgents);
	for (let n = 1; n <= maxN; n++) {
		const combinations = indexCombinations(catalogIds.length, n);
		for (const topology of topologiesForSize(n)) {
			for (let comboIndex = 0; comboIndex < combinations.length; comboIndex++) {
				const candidate = assembleCandidate(scope, request.scenarioId, n, topology, comboIndex, combinations[comboIndex]);
				if (!candidate) {
					continue;
				}
				const bodyIds = combinations[comboIndex].map((index) => catalogIds[index]);
				assembled.push({ candidate, bodyIds });
				pushStep('enumerate', `${candidate.id} | bodies: ${bodyIds.join(', ')}`);
			}
		}
	}
	// Fixture scoring law (documented heuristic, deterministic): coverage comes from
	// capabilityCoverage over the assembled org; success grows with coverage and rewards
	// multi-agent shapes; quality rewards the pipeline/hierarchical topologies; latency and
	// cost grow with org size and scenario difficulty and are LOWER-better (utility inverts them).
	const scored: ScoredCandidate[] = [];
	for (const entry of assembled) {
		const org = entry.candidate;
		const n = entry.bodyIds.length;
		let coveredCount = 0;
		for (const row of capabilityCoverage(org, required)) {
			if (row.covered) {
				coveredCount += 1;
			}
		}
		const coverageRatio = required.length > 0 ? coveredCount / required.length : 0;
		const success = clamp01(0.35 + 0.5 * coverageRatio + 0.15 * (n === 1 ? 0 : 1) - 0.25 * difficulty);
		const quality = clamp01(0.3 + 0.4 * coverageRatio + 0.2 * (org.topology === 'pipeline' || org.topology === 'hierarchical' ? 1 : 0) - 0.15 * difficulty);
		const latency = clamp01(0.2 + 0.12 * n + 0.1 * difficulty);
		const cost = clamp01(0.15 + 0.15 * n + 0.1 * difficulty);
		const utility = weights.success * success + weights.quality * quality + weights.latency * (1 - latency) + weights.cost * (1 - cost);
		scored.push({
			candidate: org,
			scores: [
				{ dimension: 'success', value: success, unit: 'normalized' },
				{ dimension: 'quality', value: quality, unit: 'normalized' },
				{ dimension: 'latency', value: latency, unit: 'normalized' },
				{ dimension: 'cost', value: cost, unit: 'normalized' },
			],
			utility,
			coveredCapabilities: coveredCount,
			evidenceLevel: 'fixture',
		});
		pushStep('score', `${org.id} | utility: ${utility.toFixed(6)}`);
	}
	if (scored.length === 0) {
		return undefined; // defensive only: unreachable with the landed 9-body catalog
	}
	// Ranking law: utility DESC with candidate id ASC as the tie-break (lexicographic, total order).
	const ranked = [...scored].sort(compareScored);
	pushStep('rank', `enumerated: ${assembled.length} | scored: ${scored.length} | best: ${ranked[0].candidate.id}`);
	// Baseline law: the n = 1 body-solo-generalist 'single' candidate (enumerated first by law; defensive fallback below).
	let baselineIndex = assembled.findIndex((entry) => entry.candidate.topology === 'single' && entry.bodyIds.length === 1 && entry.bodyIds[0] === 'body-solo-generalist');
	if (baselineIndex < 0) {
		baselineIndex = 0;
	}
	return {
		scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		request: requestSnapshot,
		baseline: scored[baselineIndex],
		candidates: ranked,
		best: ranked[0],
		trace,
	};
}
