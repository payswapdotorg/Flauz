/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-004 (Flauz, TL-B lane): the fixture Agent Body library plus the Body + Model +
 * Capabilities instantiation helpers.
 *
 * An Agent Body is a model-independent executable structure: role, input/output contract,
 * tools, permissions, memory, communication, capabilities, budget, latency and evaluation
 * hooks. Bodies never select models: model identity stays under Model Fabric authority and
 * occupancy search is LAB-005+, so `instantiateBody` only records the assignment it is
 * handed. This module is deliberately NOT a second model router.
 *
 * Placement follows DL-84 (P2-FIX-114): the Lab module tree lives on the fork-safe additive
 * path `build/flauz/lab/`, so this file is `build/flauz/lab/common/agentBodies.ts` (NOT
 * src/vs/) and imports the frozen LAB-001 contracts from `./labContracts.js`.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` anywhere in this module.
 * The catalog is static data and every helper below is a pure function of its inputs.
 */

import { LAB_CONTRACTS_VERSION, type AgentBodyDescriptor, type BodyArchetype, type OrganizationCandidate, type ModelOccupancy, type CapabilityAllocation, type LabScope } from './labContracts.js';

/** The fixture Agent Body catalog: 9 model-independent bodies covering all 6 archetypes, coder twice. */
export const AGENT_BODY_CATALOG: AgentBodyDescriptor[] = [
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-solo-generalist',
		name: 'Solo Generalist',
		archetype: 'planner',
		description: 'End-to-end workhorse for single-node fixture organizations: plans, implements and self-reviews alone. Archetype is planner because a body with no collaborators must decompose its own work first, while breadth lives in the capabilities map rather than the archetype. Budget rationale: mid-range 0.8 USD / 300 s because it carries an entire task alone with no collaborators to split cost or latency.',
		role: 'end-to-end solo task execution',
		inputContract: 'task brief with goal, constraints and workspace paths',
		outputContract: 'completed diff with a self-review note and test evidence',
		tools: ['tool:fs.read', 'tool:fs.write', 'tool:shell.exec', 'tool:web.search'],
		permissions: ['perm:fs.workspace', 'perm:shell.sandboxed', 'perm:net.egress'],
		memory: 'session',
		communication: ['channel:direct'],
		capabilities: { 'planning-depth': 0.5, 'code-writing': 0.55, 'context-synthesis': 0.6, 'tool-use': 0.5, 'communication': 0.5 },
		budget: { maxCostUsd: 0.8, maxLatencyMs: 300_000 },
		evaluationHooks: ['diff-acceptance', 'test-pass-rate'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-planner-lead',
		name: 'Planner Lead',
		archetype: 'planner',
		description: 'Organization lead for multi-node fixture orgs: decomposes goals into delegated work packages, tracks open threads and replans when a worker reports a blocker. Budget rationale: 1.2 USD with a tight 120 s latency cap because the whole organization stalls while the lead replans, so replanning must stay cheap and fast.',
		role: 'organization lead: decomposition and delegation',
		inputContract: 'goal statement plus organization status digests',
		outputContract: 'ordered work packages with acceptance criteria per package',
		tools: ['tool:fs.read', 'tool:code.search', 'tool:web.search'],
		permissions: ['perm:fs.workspace', 'perm:net.egress'],
		memory: 'persistent',
		communication: ['channel:direct', 'channel:broadcast', 'proto:task-delegation'],
		capabilities: { 'planning-depth': 0.9, 'context-synthesis': 0.75, 'communication': 0.8, 'exploration': 0.6, 'tool-use': 0.5 },
		budget: { maxCostUsd: 1.2, maxLatencyMs: 120_000 },
		evaluationHooks: ['plan-acceptance', 'delegation-fidelity'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-implementer',
		name: 'Implementer',
		archetype: 'coder',
		description: 'Writes and lands the code for one delegated work package, including its tests. Budget rationale: the cost and latency anchor of the catalog at 1.5 USD / 600 s because implementation dominates wall-clock and token spend in every fixture organization.',
		role: 'work-package implementation',
		inputContract: 'work package with acceptance criteria and file scope',
		outputContract: 'diff plus tests, self-checked against the package criteria',
		tools: ['tool:fs.read', 'tool:fs.write', 'tool:shell.exec', 'tool:code.search', 'tool:test.run'],
		permissions: ['perm:fs.workspace', 'perm:shell.sandboxed'],
		memory: 'session',
		communication: ['proto:task-delegation', 'channel:direct'],
		capabilities: { 'code-writing': 0.9, 'debugging': 0.7, 'test-design': 0.6, 'tool-use': 0.75, 'planning-depth': 0.35 },
		budget: { maxCostUsd: 1.5, maxLatencyMs: 600_000 },
		evaluationHooks: ['diff-acceptance', 'test-pass-rate', 'lint-clean'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-code-reviewer',
		name: 'Code Reviewer',
		archetype: 'reviewer',
		description: 'Critiques diffs for correctness, maintainability and contract drift before merge; it reports findings and never writes the fix itself. Budget rationale: bounded 0.5 USD / 120 s because review input is diff-sized and a stale review blocks the pipeline.',
		role: 'pre-merge diff critique',
		inputContract: 'diff under review plus the package acceptance criteria',
		outputContract: 'structured findings with severity and file/line anchors',
		tools: ['tool:fs.read', 'tool:git.diff', 'tool:code.search'],
		permissions: ['perm:fs.workspace'],
		memory: 'session',
		communication: ['proto:review-request', 'channel:direct'],
		capabilities: { 'review-rigor': 0.9, 'context-synthesis': 0.7, 'communication': 0.75, 'code-writing': 0.4 },
		budget: { maxCostUsd: 0.5, maxLatencyMs: 120_000 },
		evaluationHooks: ['review-precision', 'review-recall'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-verifier',
		name: 'Verifier',
		archetype: 'verifier',
		description: 'Independently re-runs claimed evidence (tests, commands, checks) and issues a verdict; memory is none so verdicts stay reproducible run over run. Budget rationale: cheap 0.4 USD / 180 s because verification re-executes known commands instead of exploring.',
		role: 'independent claim verification',
		inputContract: 'claim plus the exact commands and evidence to re-run',
		outputContract: 'verdict with re-run log excerpts: pass or fail with reasons',
		tools: ['tool:fs.read', 'tool:shell.exec', 'tool:test.run'],
		permissions: ['perm:fs.workspace', 'perm:shell.sandboxed'],
		memory: 'none',
		communication: ['proto:verdict-report'],
		capabilities: { 'review-rigor': 0.8, 'test-design': 0.75, 'tool-use': 0.65, 'debugging': 0.6, 'code-writing': 0.35 },
		budget: { maxCostUsd: 0.4, maxLatencyMs: 180_000 },
		evaluationHooks: ['verdict-accuracy', 'test-pass-rate'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-researcher',
		name: 'Researcher',
		archetype: 'researcher',
		description: 'Gathers and compresses external and in-repo context into a cited brief that downstream bodies plan against. Budget rationale: moderate 0.6 USD / 240 s because search-heavy work has bounded token volume but must tolerate cold fetch latency.',
		role: 'context gathering and compression',
		inputContract: 'research question plus scope limits and forbidden sources',
		outputContract: 'cited brief with findings ranked by relevance',
		tools: ['tool:web.search', 'tool:web.fetch', 'tool:fs.read', 'tool:code.search'],
		permissions: ['perm:net.egress', 'perm:fs.workspace'],
		memory: 'session',
		communication: ['proto:research-brief', 'channel:direct'],
		capabilities: { 'context-synthesis': 0.9, 'exploration': 0.85, 'communication': 0.7, 'tool-use': 0.6, 'planning-depth': 0.4 },
		budget: { maxCostUsd: 0.6, maxLatencyMs: 240_000 },
		evaluationHooks: ['brief-citation-fidelity', 'brief-utility'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-integrator',
		name: 'Integrator',
		archetype: 'integrator',
		description: 'Merges completed work packages into a coherent whole, resolving conflicts and interface drift; persistent memory records merge decisions so reruns stay consistent. Budget rationale: 1.0 USD / 480 s because conflict resolution can force re-reading most of the touched surface.',
		role: 'merge and interface reconciliation',
		inputContract: 'completed work packages with declared interface changes',
		outputContract: 'integrated tree with recorded conflict resolutions',
		tools: ['tool:fs.read', 'tool:fs.write', 'tool:git.diff', 'tool:shell.exec', 'tool:test.run'],
		permissions: ['perm:fs.workspace', 'perm:shell.sandboxed'],
		memory: 'persistent',
		communication: ['proto:handoff-acceptance', 'channel:direct', 'channel:broadcast'],
		capabilities: { 'code-writing': 0.7, 'debugging': 0.75, 'context-synthesis': 0.7, 'tool-use': 0.7, 'review-rigor': 0.5 },
		budget: { maxCostUsd: 1.0, maxLatencyMs: 480_000 },
		evaluationHooks: ['merge-conflict-rate', 'diff-acceptance', 'test-pass-rate'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-oncall-triager',
		name: 'On-Call Triager',
		archetype: 'researcher',
		description: 'Rapid incident triage: correlates logs and symptoms, bounds the blast radius and pages the owning body. Archetype is researcher because triage is investigation under time pressure, not implementation. Budget rationale: 0.3 USD at the catalog latency floor of 15 s because page latency is the entire job.',
		role: 'incident classification and routing',
		inputContract: 'incident page with raw signals and a recent log tail',
		outputContract: 'triage card: severity, blast radius, routed owner, next action',
		tools: ['tool:logs.tail', 'tool:code.search', 'tool:shell.exec', 'tool:web.search'],
		permissions: ['perm:logs.read', 'perm:shell.sandboxed', 'perm:net.egress'],
		memory: 'persistent',
		communication: ['proto:incident-page', 'channel:broadcast'],
		capabilities: { 'exploration': 0.8, 'context-synthesis': 0.75, 'debugging': 0.7, 'communication': 0.8, 'tool-use': 0.6 },
		budget: { maxCostUsd: 0.3, maxLatencyMs: 15_000 },
		evaluationHooks: ['triage-latency', 'routing-accuracy'],
		modelAgnostic: true,
	},
	{
		scope: { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' },
		contractVersion: LAB_CONTRACTS_VERSION,
		id: 'body-refactor-sweeper',
		name: 'Refactor Sweeper',
		archetype: 'coder',
		description: 'Mechanical, low-risk hygiene sweeps across a wide surface (dead code, naming, import order); memory is none so sweeps stay deterministic and idempotent. Budget rationale: 0.4 USD / 240 s because sweeps read wide, write small and must be cheap to rerun.',
		role: 'wide-surface mechanical refactoring',
		inputContract: 'sweep rule set plus file scope and exclusion list',
		outputContract: 'sweep diff with per-rule change counts',
		tools: ['tool:fs.read', 'tool:fs.write', 'tool:code.search', 'tool:test.run', 'tool:shell.exec'],
		permissions: ['perm:fs.workspace', 'perm:shell.sandboxed'],
		memory: 'none',
		communication: ['proto:task-delegation'],
		capabilities: { 'code-writing': 0.65, 'tool-use': 0.8, 'review-rigor': 0.45, 'test-design': 0.4, 'debugging': 0.35 },
		budget: { maxCostUsd: 0.4, maxLatencyMs: 240_000 },
		evaluationHooks: ['sweep-idempotency', 'diff-acceptance', 'lint-clean'],
		modelAgnostic: true,
	},
];

/** Pure lookup of a fixture body by id; undefined when the id is not in the catalog. */
export function getBody(bodyId: string): AgentBodyDescriptor | undefined {
	return AGENT_BODY_CATALOG.find(body => body.id === bodyId);
}

/** All fixture bodies of one archetype in catalog order; empty when no body matches. */
export function listBodiesByArchetype(archetype: BodyArchetype): AgentBodyDescriptor[] {
	return AGENT_BODY_CATALOG.filter(body => body.archetype === archetype);
}

/** A body seated into an organization node: the body itself, its model occupant and its granted tools. */
export interface BodyInstantiation {
	body: AgentBodyDescriptor;
	occupancy: ModelOccupancy; // the model seated in this body
	capabilities: CapabilityAllocation; // the tools granted to this body
}

/** Inputs for `instantiateBody`: the node, the seated model and the requested tools. */
export interface InstantiateOptions {
	nodeId: string; // organization node the body occupies
	modelId: string; // the model occupant: identity stays under Model Fabric authority, this helper never routes models, it only records the assignment
	toolIds: string[]; // requested tools
	allowedToolIds?: string[]; // when provided, requested tools are filtered to this allow-list: the Lab never silently grants permissions
}

/** Instantiate Body + Model + Capabilities: records the given model assignment (never routes models) and grants requested tools filtered to (allowedToolIds ?? body.tools) and always to body.tools, which is the ceiling; undefined iff bodyId is unknown. */
export function instantiateBody(bodyId: string, options: InstantiateOptions): BodyInstantiation | undefined {
	const body = getBody(bodyId);
	if (body === undefined) {
		return undefined;
	}
	// body.tools is always the grant ceiling; the allow-list can only narrow it further.
	const ceiling = body.tools;
	const allowList = options.allowedToolIds ?? ceiling;
	const seenToolIds = new Set<string>();
	const toolIds: string[] = [];
	for (const toolId of options.toolIds) {
		if (ceiling.includes(toolId) && allowList.includes(toolId) && !seenToolIds.has(toolId)) {
			seenToolIds.add(toolId);
			toolIds.push(toolId);
		}
	}
	return {
		body,
		occupancy: { nodeId: options.nodeId, modelId: options.modelId },
		capabilities: { nodeId: options.nodeId, toolIds },
	};
}

/** Purely assemble an OrganizationCandidate from instantiations; undefined iff instantiations are empty, node ids are duplicated, or an edge references an unknown node id. */
export function assembleOrganization(
	scope: LabScope,
	id: string,
	name: string,
	topology: 'single' | 'pipeline' | 'hierarchical' | 'hub-and-spoke',
	instantiations: BodyInstantiation[],
	edges?: { fromNodeId: string; toNodeId: string; kind: 'delegation' | 'review' | 'handoff' }[],
	leadNodeId?: string, // hierarchical/hub-and-spoke: reportsTo target; pipeline: chain head; single: ignored
): OrganizationCandidate | undefined {
	if (instantiations.length === 0) {
		return undefined;
	}
	const nodeIds = instantiations.map(instantiation => instantiation.occupancy.nodeId);
	const knownNodeIds = new Set<string>(nodeIds);
	if (knownNodeIds.size !== nodeIds.length) {
		return undefined;
	}
	if (edges !== undefined && edges.some(edge => !knownNodeIds.has(edge.fromNodeId) || !knownNodeIds.has(edge.toNodeId))) {
		return undefined;
	}
	// Single ignores leadNodeId entirely; an explicit valid leadNodeId wins otherwise, with the
	// first instantiation node as the deterministic fallback lead.
	const lead = topology === 'single' ? undefined : (leadNodeId !== undefined && knownNodeIds.has(leadNodeId) ? leadNodeId : nodeIds[0]);
	const nodes: OrganizationCandidate['nodes'] = instantiations.map(instantiation => {
		const node: OrganizationCandidate['nodes'][number] = {
			id: instantiation.occupancy.nodeId,
			bodyId: instantiation.body.id,
			role: instantiation.body.role,
		};
		if (lead !== undefined && (topology === 'hierarchical' || topology === 'hub-and-spoke') && node.id !== lead) {
			node.reportsTo = lead;
		}
		return node;
	});
	// Explicit edges (even an empty list) are used verbatim; synthesis only runs when edges are omitted.
	// Pipeline chains in lead order: the lead first, remaining nodes in instantiation order.
	// Hierarchical synthesizes delegation edges from the lead to every other node.
	// Hub-and-spoke synthesizes a delegation edge from the lead to every spoke and a handoff back.
	const chainOrder = lead !== undefined ? [lead, ...nodeIds.filter(nodeId => nodeId !== lead)] : nodeIds;
	const candidateEdges: OrganizationCandidate['edges'] = [];
	if (edges !== undefined) {
		for (const edge of edges) {
			candidateEdges.push({ from: edge.fromNodeId, to: edge.toNodeId, kind: edge.kind });
		}
	} else if (topology === 'pipeline') {
		for (let i = 0; i + 1 < chainOrder.length; i++) {
			candidateEdges.push({ from: chainOrder[i], to: chainOrder[i + 1], kind: 'handoff' });
		}
	} else if (topology === 'hierarchical') {
		for (const nodeId of nodeIds) {
			if (lead !== undefined && nodeId !== lead) {
				candidateEdges.push({ from: lead, to: nodeId, kind: 'delegation' });
			}
		}
	} else if (topology === 'hub-and-spoke') {
		for (const nodeId of nodeIds) {
			if (lead !== undefined && nodeId !== lead) {
				candidateEdges.push({ from: lead, to: nodeId, kind: 'delegation' });
				candidateEdges.push({ from: nodeId, to: lead, kind: 'handoff' });
			}
		}
	}
	return {
		scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		id,
		name,
		topology,
		nodes,
		edges: candidateEdges,
		occupancy: instantiations.map(instantiation => instantiation.occupancy),
		capabilities: instantiations.map(instantiation => instantiation.capabilities),
		notes: lead === undefined
			? `Lab fixture organization (LAB-004); assembled by agentBodies.assembleOrganization; topology: ${topology}`
			: `Lab fixture organization (LAB-004); assembled by agentBodies.assembleOrganization; topology: ${topology}; lead: ${lead}`,
	};
}

/** Per required capability: the strongest node in the organization and whether that strength meets the required level. */
export interface CapabilityCoverage {
	capabilityId: string;
	requiredLevel: number; // max requiredLevel across bodies needing it
	bestNodeId: string; // node whose body has the highest capability score
	bestScore: number;
	covered: boolean; // bestScore >= requiredLevel
}

/** Coverage report for an organization against required capability levels, one row per required entry in input order; score ties keep the earliest node, and the gap for uncovered rows is requiredLevel minus bestScore. */
export function capabilityCoverage(org: OrganizationCandidate, required: { capabilityId: string; requiredLevel: number }[]): CapabilityCoverage[] {
	return required.map(requirement => {
		let bestNodeId = '';
		let bestScore = 0;
		let found = false;
		for (const node of org.nodes) {
			const body = getBody(node.bodyId);
			const score = body?.capabilities[requirement.capabilityId] ?? 0;
			if (!found || score > bestScore) {
				found = true;
				bestNodeId = node.id;
				bestScore = score;
			}
		}
		return {
			capabilityId: requirement.capabilityId,
			requiredLevel: requirement.requiredLevel,
			bestNodeId,
			bestScore,
			covered: bestScore >= requirement.requiredLevel,
		};
	});
}

// Fixture evidence, honestly labeled: the numbers below are authored illustrations, not
// measurements from a live harness. Every score is at or below its body capability map value
// and each catalog body carries 2-3 rows. Replace with measured numbers once the Lab harness lands.
/** Static benchmark-style table over the fixture catalog: fixture evidence, NOT live measurements. */
export const BODY_BENCHMARKS: { bodyId: string; capabilityId: string; score: number; samples: number }[] = [
	{ bodyId: 'body-solo-generalist', capabilityId: 'planning-depth', score: 0.45, samples: 24 },
	{ bodyId: 'body-solo-generalist', capabilityId: 'code-writing', score: 0.5, samples: 24 },
	{ bodyId: 'body-solo-generalist', capabilityId: 'context-synthesis', score: 0.55, samples: 18 },
	{ bodyId: 'body-planner-lead', capabilityId: 'planning-depth', score: 0.85, samples: 16 },
	{ bodyId: 'body-planner-lead', capabilityId: 'communication', score: 0.75, samples: 16 },
	{ bodyId: 'body-planner-lead', capabilityId: 'context-synthesis', score: 0.7, samples: 12 },
	{ bodyId: 'body-implementer', capabilityId: 'code-writing', score: 0.85, samples: 40 },
	{ bodyId: 'body-implementer', capabilityId: 'debugging', score: 0.65, samples: 40 },
	{ bodyId: 'body-implementer', capabilityId: 'test-design', score: 0.55, samples: 28 },
	{ bodyId: 'body-code-reviewer', capabilityId: 'review-rigor', score: 0.85, samples: 22 },
	{ bodyId: 'body-code-reviewer', capabilityId: 'communication', score: 0.7, samples: 22 },
	{ bodyId: 'body-verifier', capabilityId: 'review-rigor', score: 0.75, samples: 30 },
	{ bodyId: 'body-verifier', capabilityId: 'test-design', score: 0.7, samples: 30 },
	{ bodyId: 'body-verifier', capabilityId: 'tool-use', score: 0.6, samples: 30 },
	{ bodyId: 'body-researcher', capabilityId: 'context-synthesis', score: 0.85, samples: 20 },
	{ bodyId: 'body-researcher', capabilityId: 'exploration', score: 0.8, samples: 20 },
	{ bodyId: 'body-researcher', capabilityId: 'communication', score: 0.65, samples: 15 },
	{ bodyId: 'body-integrator', capabilityId: 'debugging', score: 0.7, samples: 14 },
	{ bodyId: 'body-integrator', capabilityId: 'code-writing', score: 0.65, samples: 14 },
	{ bodyId: 'body-integrator', capabilityId: 'context-synthesis', score: 0.65, samples: 10 },
	{ bodyId: 'body-oncall-triager', capabilityId: 'exploration', score: 0.75, samples: 36 },
	{ bodyId: 'body-oncall-triager', capabilityId: 'communication', score: 0.75, samples: 36 },
	{ bodyId: 'body-refactor-sweeper', capabilityId: 'tool-use', score: 0.75, samples: 26 },
	{ bodyId: 'body-refactor-sweeper', capabilityId: 'code-writing', score: 0.6, samples: 26 },
	{ bodyId: 'body-refactor-sweeper', capabilityId: 'review-rigor', score: 0.4, samples: 18 },
];
