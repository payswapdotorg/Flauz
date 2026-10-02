/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-010 pure bridge adapter: shapes a LabRecommendation into Agent OS task / workflow request drafts.
 * DETERMINISM LAW: no Math.random, no Date.now, no new Date(); the only timestamp source is the injected
 * nowIso edge, so the same request always produces a byte-identical result.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type LabRecommendation, type ExperimentLink } from './labContracts.js';

/** The fixed toolId placeholder for bridge workflow steps (the extension wiring wave maps it through the real ToolRegistryPort). */
export const BRIDGE_STEP_TOOL_ID = 'flauz-lab.bridge.node';

/** One Agent OS task event (shaped to extensions/flauz-agent/src/types.ts TaskEvent; actor 'agent' at request time). */
export interface BridgeTaskEvent {
	ts: number;
	actor: 'agent';
	type: string;
	payload: Record<string, unknown>;
}

/** The Agent OS task creation request draft (shaped to the flauz.workspace.createTask seam). */
export interface AgentTaskRequestDraft {
	title: string; // `Flauz Lab recommendation ${recommendation.id}`
	ownerNote: string; // the honest owner note: the Lab bridges, Agent OS executes
	initialEvents: BridgeTaskEvent[]; // exactly 2: 'lab-bridge.plan' then 'lab-bridge.linkage', both stamped Date.parse(nowIso)
	changes: { uri: string; checkpointRef: null }[]; // ALWAYS empty at request time (no side effects)
}

/** One workflow step draft (shaped to WorkflowSpecStep; the approval law is NON-NEGOTIABLE). */
export interface BridgeWorkflowStepDraft {
	seq: number; // 1-based, node array order
	toolId: string; // BRIDGE_STEP_TOOL_ID (documented placeholder; the wiring wave maps it)
	name: string; // `${node.role} (${node.bodyId})`
	inputTemplate: {
		bodyId: string; // the node's body
		modelId: string; // the node's occupancy model; REQUIRED - the bridge never guesses (refuses when missing)
		role: string;
		reportsTo: string | null; // node.reportsTo ?? null
		edgeKinds: { to: string; kind: string }[]; // the node's outgoing edges verbatim
	};
	approval: 'ask'; // ALWAYS 'ask' - the bridge NEVER relaxes the human gate (roadmap law)
	onFail: 'abort'; // real execution aborts on failure (never 'continue')
}

/** The workflow request draft (WorkflowSpec-shaped; semantic validation against the real tool registry happens in the wiring wave). */
export interface BridgeWorkflowDraft {
	title: string; // `Lab bridge ${recommendation.id}`
	steps: BridgeWorkflowStepDraft[]; // one per candidate node, node array order
	inputs: { name: string; type: 'string'; required: true; description: string; defaultValue?: undefined }[]; // exactly one input: 'labRecommendationId'
}

/** One evidence expectation (shaped to EvidenceRowInput; LAB-008 consumes these after execution). */
export interface BridgeEvidenceExpectation {
	kind: 'command-output' | 'changeset' | 'note';
	uri: string; // `expectation://${bridgeEntryId}/...`
	note: string;
}

/** The full bridge result. */
export interface TaskBridgeResult {
	scope: LabScope; // verbatim from the recommendation
	contractVersion: string; // LAB_CONTRACTS_VERSION
	bridgeEntryId: string; // 'bridge-' + fnv1a32hex(`${recommendation.id}|${experimentLink.id}`) (module-private fnv1a32, 8 hex chars)
	taskRequest: AgentTaskRequestDraft;
	workflowDraft: BridgeWorkflowDraft;
	evidenceExpectations: BridgeEvidenceExpectation[]; // exactly 3, in the canonical order
	linkage: { runId: string; recommendationId: string; bridgeEntryId: string; createdAt: string }; // the ExperimentLink continuation
	notes: string[]; // exactly the 3 verbatim honesty lines
}

/** The bridge request input: an issued recommendation, its experiment link, and the injected nowIso timestamp. */
export interface BridgeRequestInput {
	recommendation: LabRecommendation; // MUST be status 'issued' (saved is not enough; applied/reverted never re-bridge)
	experimentLink: ExperimentLink; // MUST match scope + contractVersion with the recommendation
	nowIso: string; // injected timestamp (determinism law)
}

/** FNV-1a 32-bit hash rendered as exactly 8 lowercase hex chars (deterministic; module-private). */
function fnv1a32hex(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/** True iff both scopes name the same workspace and tenant. */
function sameScope(a: LabScope, b: LabScope): boolean {
	return a.workspaceId === b.workspaceId && a.tenantId === b.tenantId;
}

/** Shape an issued recommendation into Agent OS request drafts, or undefined when a gate refuses the bridge. */
export function bridgeRecommendation(input: BridgeRequestInput): TaskBridgeResult | undefined {
	const { recommendation, experimentLink, nowIso } = input;
	if (recommendation.status !== 'issued') {
		return undefined;
	}
	if (!sameScope(recommendation.scope, experimentLink.scope)) {
		return undefined;
	}
	if (recommendation.contractVersion !== experimentLink.contractVersion) {
		return undefined;
	}
	// The bridge only speaks the contract version it was compiled against; anything else is refused, never guessed.
	if (recommendation.contractVersion !== LAB_CONTRACTS_VERSION) {
		return undefined;
	}
	const organization = recommendation.organization;
	if (organization.nodes.length === 0) {
		return undefined;
	}
	const occupancyById = new Map<string, string>();
	for (const entry of organization.occupancy) {
		occupancyById.set(entry.nodeId, entry.modelId);
	}
	const steps: BridgeWorkflowStepDraft[] = [];
	for (const [index, node] of organization.nodes.entries()) {
		const modelId = occupancyById.get(node.id);
		if (modelId === undefined) {
			return undefined; // modelId resolution failure - the bridge never guesses a model
		}
		steps.push({
			seq: index + 1,
			toolId: BRIDGE_STEP_TOOL_ID,
			name: `${node.role} (${node.bodyId})`,
			inputTemplate: {
				bodyId: node.bodyId,
				modelId,
				role: node.role,
				reportsTo: node.reportsTo ?? null,
				edgeKinds: organization.edges
					.filter((edge) => edge.from === node.id)
					.map((edge) => ({ to: edge.to, kind: edge.kind })),
			},
			approval: 'ask',
			onFail: 'abort',
		});
	}
	const bridgeEntryId = `bridge-${fnv1a32hex(`${recommendation.id}|${experimentLink.id}`)}`;
	const ts = Date.parse(nowIso); // the only timestamp source - the injected edge
	const taskRequest: AgentTaskRequestDraft = {
		title: `Flauz Lab recommendation ${recommendation.id}`,
		ownerNote: 'Created by the Lab bridge adapter; execution routes through Agent OS approvals',
		initialEvents: [
			{
				ts,
				actor: 'agent',
				type: 'lab-bridge.plan',
				payload: {
					recommendationId: recommendation.id,
					runId: recommendation.runId,
					rationale: recommendation.rationale,
					confidence: recommendation.confidence,
					expectedGains: recommendation.expectedGains,
					caveats: recommendation.caveats,
				},
			},
			{
				ts,
				actor: 'agent',
				type: 'lab-bridge.linkage',
				payload: {
					runId: experimentLink.runId,
					recommendationId: recommendation.id,
					bridgeEntryId,
					experimentLinkId: experimentLink.id,
				},
			},
		],
		changes: [],
	};
	const workflowDraft: BridgeWorkflowDraft = {
		title: `Lab bridge ${recommendation.id}`,
		steps,
		inputs: [
			{
				name: 'labRecommendationId',
				type: 'string',
				required: true,
				description: 'The Lab recommendation this workflow executes',
			},
		],
	};
	const evidenceExpectations: BridgeEvidenceExpectation[] = [
		{
			kind: 'command-output',
			uri: `expectation://${bridgeEntryId}/run-log`,
			note: 'The executed task run log (Agent OS appendEvidence)',
		},
		{
			kind: 'changeset',
			uri: `expectation://${bridgeEntryId}/changes`,
			note: 'Changes produced by the executed task, if any',
		},
		{
			kind: 'note',
			uri: `expectation://${bridgeEntryId}/outcome`,
			note: 'The outcome summary consumed by the LAB-008 observation adapter',
		},
	];
	const notes: string[] = [
		'The Lab never becomes a second execution engine: this adapter shapes requests only.',
		'Every workflow step requires human approval (ask) - the bridge cannot relax the security boundary.',
		'Model assignments come verbatim from the recommendation occupancy; the Model Fabric keeps routing authority.',
	];
	return {
		scope: recommendation.scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		bridgeEntryId,
		taskRequest,
		workflowDraft,
		evidenceExpectations,
		linkage: {
			runId: experimentLink.runId,
			recommendationId: recommendation.id,
			bridgeEntryId,
			createdAt: nowIso,
		},
		notes,
	};
}
