/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 * LAB-006 occupancySearch  -  model/tool/capability occupancy search, fixture lane.
 *
 * DETERMINISM LAW: this module is a PURE DETERMINISTIC ENUMERATION  -  no Math.random, no
 * Date.now / new Date(); the same request yields a byte-identical result.
 *
 * NO SECOND MODEL ROUTER: MODEL_FIXTURES is comparison data only  -  the Model Fabric keeps
 * routing authority; this module only RECORDS assignments and computes comparisons. A missing
 * capability becomes an EXPLICIT CapabilityRequirement  -  never an improvised agent behavior.
 *--------------------------------------------------------------------------------------------*/

import { LAB_CONTRACTS_VERSION, type LabScope, type ModelOccupancy, type CapabilityAllocation, type CapabilityRequirement, type EvalScore, type LabEvidenceLevel } from './labContracts.js';
import { getBody } from './agentBodies.js';

/** Fixture model descriptor  -  authored comparison data for the lab fixture lane, never a routing decision. */
export interface ModelFixture {
	id: string;                 // 'model-fixture-m', 'model-fixture-s', 'model-fixture-l', 'model-fixture-xl'
	name: string;
	description: string;        // honest one-liner: authored fixture, not a measurement
	qualityMultiplier: number;  // 0.8..1.3
	latencyMultiplier: number;  // 0.7..1.5
	costUsdPerTask: number;     // 0.05..0.8
	capabilityBonus: Record<string, number>; // 0..0.25 boosts on capability ids
}

/** Fixture model catalog  -  4 entries, one coherent story per size class; comparison data ONLY (the Model Fabric owns routing; this module never routes). */
export const MODEL_FIXTURES: ModelFixture[] = [
	{
		id: 'model-fixture-m',
		name: 'Fixture Model M',
		description: 'Authored fixture stand-in for a small, fast, cheap model; comparison data only, not a measurement.',
		qualityMultiplier: 0.85,
		latencyMultiplier: 0.7,
		costUsdPerTask: 0.05,
		capabilityBonus: { 'context-synthesis': 0.05, 'exploration': 0.05 },
	},
	{
		id: 'model-fixture-s',
		name: 'Fixture Model S',
		description: 'Authored fixture stand-in for a small balanced model; comparison data only, not a measurement.',
		qualityMultiplier: 0.95,
		latencyMultiplier: 0.85,
		costUsdPerTask: 0.12,
		capabilityBonus: { 'code-writing': 0.05, 'debugging': 0.05, 'test-design': 0.05 },
	},
	{
		id: 'model-fixture-l',
		name: 'Fixture Model L',
		description: 'Authored fixture stand-in for a large capable model; comparison data only, not a measurement.',
		qualityMultiplier: 1.1,
		latencyMultiplier: 1.15,
		costUsdPerTask: 0.35,
		capabilityBonus: { 'code-writing': 0.12, 'debugging': 0.12, 'context-synthesis': 0.1, 'planning-depth': 0.1 },
	},
	{
		id: 'model-fixture-xl',
		name: 'Fixture Model XL',
		description: 'Authored fixture stand-in for a frontier-scale model; comparison data only, not a measurement.',
		qualityMultiplier: 1.3,
		latencyMultiplier: 1.5,
		costUsdPerTask: 0.8,
		capabilityBonus: { 'code-writing': 0.2, 'debugging': 0.2, 'planning-depth': 0.25, 'context-synthesis': 0.2, 'review-rigor': 0.15 },
	},
];

/** Fixture tool -> capability map for the 9 catalog tool ids (which capabilities a granted tool exercises). */
export const TOOL_CAPABILITY_FIXTURES: Record<string, string[]> = {
	'tool:fs.read': ['context-synthesis', 'exploration'],
	'tool:fs.write': ['code-writing'],
	'tool:code.search': ['context-synthesis', 'exploration'],
	'tool:shell.exec': ['tool-use', 'debugging'],
	'tool:test.run': ['test-design', 'tool-use'],
	'tool:git.diff': ['review-rigor', 'context-synthesis'],
	'tool:logs.tail': ['debugging', 'context-synthesis'],
	'tool:web.search': ['exploration', 'planning-depth'],
	'tool:web.fetch': ['exploration', 'tool-use'],
};

/** Required capabilities per task type id, fixture lane (same convention as the org-search wave); unknown ids fall back to the '_default' entries. */
export const OCCUPANCY_REQUIRED_CAPABILITIES: Record<string, { capabilityId: string; requiredLevel: number }[]> = {
	'tt-bugfix-regression-tests': [
		{ capabilityId: 'code-writing', requiredLevel: 0.6 },
		{ capabilityId: 'debugging', requiredLevel: 0.7 },
		{ capabilityId: 'test-design', requiredLevel: 0.4 },
	],
	'tt-feature-addition-tests': [
		{ capabilityId: 'code-writing', requiredLevel: 0.7 },
		{ capabilityId: 'planning-depth', requiredLevel: 0.5 },
		{ capabilityId: 'test-design', requiredLevel: 0.4 },
		{ capabilityId: 'context-synthesis', requiredLevel: 0.4 },
	],
	'tt-flaky-investigation-runtime-check': [
		{ capabilityId: 'debugging', requiredLevel: 0.6 },
		{ capabilityId: 'context-synthesis', requiredLevel: 0.5 },
		{ capabilityId: 'tool-use', requiredLevel: 0.5 },
	],
	'_default': [
		{ capabilityId: 'code-writing', requiredLevel: 0.5 },
		{ capabilityId: 'debugging', requiredLevel: 0.5 },
		{ capabilityId: 'context-synthesis', requiredLevel: 0.4 },
	],
};

/** Fixture difficulty per scenario id (same values as the org-search wave's table); unknown ids fall back to the '_default' value. */
export const OCCUPANCY_SCENARIO_DIFFICULTY: Record<string, number> = {
	'scenario-se-bugfix-regression': 0.45,
	'scenario-se-feature-addition': 0.6,
	'scenario-se-flaky-investigation': 0.5,
	'_default': 0.5,
};

/** Tool grant variant: 'all' = the body's full tools; 'lean' = the first ceil(tools/2) tools in body order. */
export type ToolMode = 'all' | 'lean';

/** Occupancy search request: one organization (bodies in node order), candidate models, tool modes, and utility weights. */
export interface OccupancySearchRequest {
	scope: LabScope;                                    // { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }
	scenarioId: string;
	taskTypeId: string;
	utilityWeights: Record<'success' | 'quality' | 'latency' | 'cost', number>; // non-negative, sum 1
	bodyIds: string[];                                  // the org's bodies, node order, 1..3, must all exist
	modelIds: string[];                                 // candidate models, subset of MODEL_FIXTURES ids, 1..4, no duplicates
	toolModes: ToolMode[];                              // variants to try, non-empty, no duplicates
}

/** One enumerated assignment: per-node body/model/tools + fixture scoring + explicit gaps. */
export interface ScoredAssignment {
	bodyIds: string[];                                  // verbatim from the request (node order)
	models: ModelOccupancy[];                           // one per node: { nodeId: 'node-<i>', modelId }
	tools: CapabilityAllocation[];                      // one per node: tool grants per ToolMode
	toolMode: ToolMode;
	scores: EvalScore[];                                // success, quality (0..1 higher-better); latency, cost (0..1 LOWER-better)
	utility: number;                                    // w.success*s + w.quality*q + w.latency*(1-latency) + w.cost*(1-cost)
	gaps: CapabilityRequirement[];                      // required capabilities no node covers -> EXPLICIT requirements, never improvised
	evidenceLevel: LabEvidenceLevel;                    // 'fixture'
}

/** One deterministic pipeline trace step; steps are dense 1-based and ordered 'enumerate' -> 'score' -> 'rank'. */
export interface OccupancySearchStep {
	step: number;
	kind: 'enumerate' | 'score' | 'rank';
	detail: string;
}

/** Occupancy search result: scope, pinned contract version, verbatim request, baseline, ranked candidates, best, trace. */
export interface OccupancySearchResult {
	scope: LabScope;
	contractVersion: string;                            // LAB_CONTRACTS_VERSION
	request: OccupancySearchRequest;                    // verbatim
	baseline: ScoredAssignment;                         // all nodes on modelIds[0], toolMode 'all' (if 'all' requested, else the first requested mode)  -  always evaluated
	candidates: ScoredAssignment[];                     // ALL assignments incl. baseline, ranked
	best: ScoredAssignment;                             // candidates[0]
	trace: OccupancySearchStep[];                       // enumerate -> score -> rank
}

/** Clamp a value into [0, 1] (scoring-law helper). */
function clamp01(value: number): number {
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
}

/** Return the catalog fixture for a model id, or undefined when the id is unknown. */
function fixtureFor(modelId: string): ModelFixture | undefined {
	return MODEL_FIXTURES.find((fixture) => fixture.id === modelId);
}

/** Assignment signature: model ids joined '+' then the tool mode  -  the deterministic ranking tie-break key. */
function assignmentSignature(modelIds: string[], toolMode: ToolMode): string {
	return `${modelIds.join('+')}+${toolMode}`;
}

/** Grant tools for one body under a tool mode: 'all' = the full ordered tool list; 'lean' = the first ceil(tools/2) tools in body order. */
function grantedTools(bodyId: string, toolMode: ToolMode): string[] {
	const body = getBody(bodyId);
	const tools = body ? body.tools : [];
	if (toolMode === 'lean') {
		return tools.slice(0, Math.ceil(tools.length / 2));
	}
	return [...tools];
}

/** Search every body x model x tool-mode occupancy for a request; returns undefined iff the request shape is invalid. */
export function searchOccupancies(request: OccupancySearchRequest): OccupancySearchResult | undefined {
	// Validation law  -  undefined iff: invalid utility weights (negative or sum not ~1 within 1e-9),
	// bodyIds empty/>3/unknown, modelIds empty/>4/duplicated/unknown, toolModes empty/duplicated.
	const weights = request.utilityWeights;
	const weightSum = weights.success + weights.quality + weights.latency + weights.cost;
	if (weights.success < 0 || weights.quality < 0 || weights.latency < 0 || weights.cost < 0) {
		return undefined;
	}
	if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-9) {
		return undefined;
	}
	if (request.bodyIds.length < 1 || request.bodyIds.length > 3) {
		return undefined;
	}
	for (const bodyId of request.bodyIds) {
		if (getBody(bodyId) === undefined) {
			return undefined;
		}
	}
	if (request.modelIds.length < 1 || request.modelIds.length > 4) {
		return undefined;
	}
	if (new Set(request.modelIds).size !== request.modelIds.length) {
		return undefined;
	}
	for (const modelId of request.modelIds) {
		if (fixtureFor(modelId) === undefined) {
			return undefined;
		}
	}
	if (request.toolModes.length < 1) {
		return undefined;
	}
	if (new Set(request.toolModes).size !== request.toolModes.length) {
		return undefined;
	}
	for (const toolMode of request.toolModes) {
		if (toolMode !== 'all' && toolMode !== 'lean') {
			return undefined;
		}
	}

	const nodes = request.bodyIds.length;

	// Enumeration law  -  the cartesian product of model assignments (each node takes each candidate
	// model; tuples ordered node-major lexicographic on MODEL_FIXTURES order) x tool modes (request
	// order). Every combo is ONE candidate. The baseline combo (modelIds[0] on every node + the
	// 'all' mode if requested, else the first requested mode) is enumerated FIRST and always
	// included. Node ids are 'node-0'..'node-<n-1>'.
	const candidateFixtures = MODEL_FIXTURES.filter((fixture) => request.modelIds.includes(fixture.id));
	let tuples: ModelFixture[][] = [[]];
	for (let node = 0; node < nodes; node++) {
		const widened: ModelFixture[][] = [];
		for (const tuple of tuples) {
			for (const fixture of candidateFixtures) {
				widened.push([...tuple, fixture]);
			}
		}
		tuples = widened;
	}
	const combos: { fixtures: ModelFixture[]; toolMode: ToolMode; signature: string; }[] = [];
	for (const tuple of tuples) {
		const comboModelIds = tuple.map((fixture) => fixture.id);
		for (const toolMode of request.toolModes) {
			combos.push({ fixtures: tuple, toolMode, signature: assignmentSignature(comboModelIds, toolMode) });
		}
	}
	const baselineModelId = request.modelIds[0];
	const baselineToolMode: ToolMode = request.toolModes.includes('all') ? 'all' : request.toolModes[0];
	const baselineSignature = assignmentSignature(Array.from({ length: nodes }, () => baselineModelId), baselineToolMode);
	const baselineIndex = combos.findIndex((combo) => combo.signature === baselineSignature);
	const baselineCombo = baselineIndex >= 0 ? combos[baselineIndex] : undefined;
	if (!baselineCombo) {
		return undefined;
	}
	const orderedCombos = [baselineCombo, ...combos.slice(0, baselineIndex), ...combos.slice(baselineIndex + 1)];

	// Scoring law  -  documented deterministic heuristic on fixture data only: per node per capability
	// score = body.capabilities[cap] (0 if absent) + model.capabilityBonus[cap] (0 if absent) +
	// 0.08 * (count of granted tools whose TOOL_CAPABILITY_FIXTURES lists the capability, capped at
	// 2); org capability = max over nodes; coveredCount = required entries with org capability >=
	// requiredLevel; then the fixture formulas below with difficulty from the scenario table.
	const required = OCCUPANCY_REQUIRED_CAPABILITIES[request.taskTypeId] ?? OCCUPANCY_REQUIRED_CAPABILITIES['_default'] ?? [];
	const difficulty = OCCUPANCY_SCENARIO_DIFFICULTY[request.scenarioId] ?? OCCUPANCY_SCENARIO_DIFFICULTY['_default'] ?? 0.5;
	const scoredCombos: { assignment: ScoredAssignment; signature: string; }[] = [];
	for (const combo of orderedCombos) {
		const models: ModelOccupancy[] = combo.fixtures.map((fixture, index) => ({ nodeId: `node-${index}`, modelId: fixture.id }));
		const tools: CapabilityAllocation[] = request.bodyIds.map((bodyId, index) => ({ nodeId: `node-${index}`, toolIds: grantedTools(bodyId, combo.toolMode) }));
		const orgCapability = new Map<string, number>();
		for (let index = 0; index < nodes; index++) {
			const body = getBody(request.bodyIds[index]);
			const bodyCapabilities = body ? body.capabilities : {};
			const fixture = combo.fixtures[index];
			const grantedToolIds = tools[index].toolIds;
			for (const entry of required) {
				const capabilityId = entry.capabilityId;
				let coveringTools = 0;
				for (const toolId of grantedToolIds) {
					const toolCapabilities = TOOL_CAPABILITY_FIXTURES[toolId] ?? [];
					if (toolCapabilities.includes(capabilityId)) {
						coveringTools++;
					}
				}
				const nodeScore = (bodyCapabilities[capabilityId] ?? 0) + (fixture.capabilityBonus[capabilityId] ?? 0) + 0.08 * Math.min(2, coveringTools);
				const known = orgCapability.get(capabilityId);
				if (known === undefined || nodeScore > known) {
					orgCapability.set(capabilityId, nodeScore);
				}
			}
		}
		let coveredCount = 0;
		for (const entry of required) {
			if ((orgCapability.get(entry.capabilityId) ?? 0) >= entry.requiredLevel) {
				coveredCount++;
			}
		}
		const coverageRatio = coveredCount / required.length;
		const averageQuality = combo.fixtures.reduce((sum, fixture) => sum + fixture.qualityMultiplier, 0) / nodes;
		const averageLatency = combo.fixtures.reduce((sum, fixture) => sum + fixture.latencyMultiplier, 0) / nodes;
		const costSum = combo.fixtures.reduce((sum, fixture) => sum + fixture.costUsdPerTask, 0);
		const quality = clamp01(0.25 + 0.55 * coverageRatio + 0.2 * averageQuality);
		const success = clamp01(0.3 + 0.5 * coverageRatio - 0.2 * difficulty + 0.1 * (nodes > 1 ? 1 : 0));
		const latency = clamp01(0.15 + 0.15 * nodes + 0.25 * (averageLatency - 0.7) + 0.1 * difficulty);
		const cost = clamp01(costSum / 2.4);
		const utility = request.utilityWeights.success * success + request.utilityWeights.quality * quality + request.utilityWeights.latency * (1 - latency) + request.utilityWeights.cost * (1 - cost);

		// Gap law  -  every required capability with org capability < requiredLevel becomes an EXPLICIT
		// CapabilityRequirement row; the module NEVER improvises a behavior to cover it.
		const gaps: CapabilityRequirement[] = [];
		for (const entry of required) {
			if ((orgCapability.get(entry.capabilityId) ?? 0) < entry.requiredLevel) {
				gaps.push({
					scope: { ...request.scope },
					contractVersion: LAB_CONTRACTS_VERSION,
					id: `req-${request.scenarioId}-${entry.capabilityId}`,
					capabilityId: entry.capabilityId,
					requiredLevel: entry.requiredLevel,
					status: 'unavailable',
					grantRequiresApproval: true,
				});
			}
		}

		const assignment: ScoredAssignment = {
			bodyIds: [...request.bodyIds],
			models,
			tools,
			toolMode: combo.toolMode,
			scores: [
				{ dimension: 'success', value: success },
				{ dimension: 'quality', value: quality },
				{ dimension: 'latency', value: latency },
				{ dimension: 'cost', value: cost },
			],
			utility,
			gaps,
			evidenceLevel: 'fixture',
		};
		scoredCombos.push({ assignment, signature: combo.signature });
	}

	// Ranking law  -  utility DESC, tie-break by assignment signature (model ids joined '+' then the tool mode) ASC.
	const ranked = [...scoredCombos].sort((left, right) => {
		if (left.assignment.utility !== right.assignment.utility) {
			return right.assignment.utility - left.assignment.utility;
		}
		return left.signature < right.signature ? -1 : left.signature > right.signature ? 1 : 0;
	});
	const bestEntry = ranked[0];
	if (!bestEntry) {
		return undefined;
	}
	const baselineEntry = scoredCombos.find((entry) => entry.signature === baselineSignature);
	if (!baselineEntry) {
		return undefined;
	}
	const candidates = ranked.map((entry) => entry.assignment);

	// Trace law  -  one 'enumerate' step per candidate (detail = node-models signature + toolMode),
	// one 'score' step per candidate (utility), one final 'rank' step (counts + best signature);
	// steps are dense 1-based.
	const trace: OccupancySearchStep[] = [];
	let stepNumber = 1;
	for (const combo of orderedCombos) {
		trace.push({ step: stepNumber++, kind: 'enumerate', detail: combo.signature });
	}
	for (const entry of scoredCombos) {
		trace.push({ step: stepNumber++, kind: 'score', detail: `${entry.signature} utility=${entry.assignment.utility}` });
	}
	trace.push({ step: stepNumber++, kind: 'rank', detail: `candidates=${ranked.length} best=${bestEntry.signature}` });

	return {
		scope: { ...request.scope },
		contractVersion: LAB_CONTRACTS_VERSION,
		request: {
			scope: { ...request.scope },
			scenarioId: request.scenarioId,
			taskTypeId: request.taskTypeId,
			utilityWeights: { ...request.utilityWeights },
			bodyIds: [...request.bodyIds],
			modelIds: [...request.modelIds],
			toolModes: [...request.toolModes],
		},
		baseline: baselineEntry.assignment,
		candidates,
		best: bestEntry.assignment,
		trace,
	};
}
