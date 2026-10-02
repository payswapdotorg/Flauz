/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-010 unit tests for the pure task bridge adapter. Authored in the sandbox pod and NOT run against
 * the repo toolchain here (labContracts.ts and the test harness live on Flauz main) - TL runs the real gate.
 * Deterministic by construction: frozen literal fixtures, injected nowIso, no clock or random sources.
 */

import assert from 'assert';
import { BRIDGE_STEP_TOOL_ID, bridgeRecommendation, type BridgeRequestInput, type TaskBridgeResult } from '../../common/taskBridge.js';

type RecommendationFixture = BridgeRequestInput['recommendation'];
type LinkFixture = BridgeRequestInput['experimentLink'];

const nowIso = '2026-02-01T10:00:00.000Z';

const pipelineScope: RecommendationFixture['scope'] = { workspaceId: 'ws-flauz-lab', tenantId: 'tenant-flauz' };

const pipelineRecommendation: RecommendationFixture = {
        scope: pipelineScope,
        contractVersion: '1.0.0',
        id: 'rec-pipeline-001',
        runId: 'run-lab-007',
        organization: {
                scope: pipelineScope,
                contractVersion: '1.0.0',
                id: 'org-pipeline-001',
                name: 'Draft-review-publish pipeline',
                topology: 'pipeline',
                nodes: [
                        { id: 'node-drafter', bodyId: 'body-drafter', role: 'drafter' },
                        { id: 'node-reviewer', bodyId: 'body-reviewer', role: 'reviewer', reportsTo: 'node-drafter' },
                        { id: 'node-publisher', bodyId: 'body-publisher', role: 'publisher', reportsTo: 'node-reviewer' },
                ],
                edges: [
                        { from: 'node-drafter', to: 'node-reviewer', kind: 'handoff' },
                        { from: 'node-drafter', to: 'node-publisher', kind: 'delegation' },
                        { from: 'node-reviewer', to: 'node-publisher', kind: 'review' },
                ],
                occupancy: [
                        { nodeId: 'node-drafter', modelId: 'glm-4.7-air' },
                        { nodeId: 'node-reviewer', modelId: 'glm-4.7' },
                        { nodeId: 'node-publisher', modelId: 'glm-4.7-flash' },
                ],
                capabilities: [
                        { nodeId: 'node-drafter', toolIds: ['flauz.workspace.createTask'] },
                        { nodeId: 'node-reviewer', toolIds: ['flauz.workspace.appendEvidence'] },
                        { nodeId: 'node-publisher', toolIds: ['flauz.workspace.appendEvent'] },
                ],
                notes: 'Fixture for the 3-node pipeline scenario.',
        },
        rationale: 'A draft-review-publish pipeline raises review quality while keeping latency inside the baseline envelope.',
        expectedGains: [
                { dimension: 'success', candidateValue: 0.94, baselineValue: 0.88, delta: 0.06 },
                { dimension: 'quality', candidateValue: 4.6, baselineValue: 4.1, delta: 0.5 },
                { dimension: 'latency', candidateValue: 1200, baselineValue: 1500, delta: 300 },
                { dimension: 'cost', candidateValue: 0.8, baselineValue: 1.1, delta: 0.3 },
        ],
        confidence: 0.82,
        caveats: ['Latency was measured on the staging workspace only.', 'The cost model excludes storage.'],
        reversible: true,
        auditTrail: ['run-lab-007 evaluated org-pipeline-001 and issued rec-pipeline-001'],
        status: 'issued',
        createdAt: '2026-01-15T09:30:00.000Z',
};

const pipelineLink: LinkFixture = {
        scope: pipelineScope,
        contractVersion: '1.0.0',
        id: 'link-pipeline-001',
        runId: 'run-lab-007',
        recommendationId: 'rec-pipeline-001',
        createdAt: '2026-01-15T09:30:00.000Z',
};

const singleScope: RecommendationFixture['scope'] = { workspaceId: 'ws-flauz-solo', tenantId: 'tenant-flauz' };

const singleRecommendation: RecommendationFixture = {
        scope: singleScope,
        contractVersion: '1.0.0',
        id: 'rec-single-042',
        runId: 'run-lab-011',
        organization: {
                scope: singleScope,
                contractVersion: '1.0.0',
                id: 'org-single-042',
                name: 'Single body operator',
                topology: 'single',
                nodes: [
                        { id: 'node-solo', bodyId: 'body-solo', role: 'solo-operator' },
                ],
                edges: [],
                occupancy: [
                        { nodeId: 'node-solo', modelId: 'glm-4.7-air' },
                ],
                capabilities: [
                        { nodeId: 'node-solo', toolIds: ['flauz.workspace.createTask'] },
                ],
        },
        rationale: 'A single body already meets the baseline on every dimension, so no topology change is warranted.',
        expectedGains: [
                { dimension: 'success', candidateValue: 0.9, baselineValue: 0.9, delta: 0 },
                { dimension: 'quality', candidateValue: 4.0, baselineValue: 4.0, delta: 0 },
                { dimension: 'latency', candidateValue: 900, baselineValue: 900, delta: 0 },
                { dimension: 'cost', candidateValue: 0.5, baselineValue: 0.6, delta: 0.1 },
        ],
        confidence: 0.7,
        caveats: ['Three of the four dimensions are neutral.'],
        reversible: true,
        auditTrail: ['run-lab-011 evaluated org-single-042 and issued rec-single-042'],
        status: 'issued',
        createdAt: '2026-01-20T14:05:00.000Z',
};

const singleLink: LinkFixture = {
        scope: singleScope,
        contractVersion: '1.0.0',
        id: 'link-single-042',
        runId: 'run-lab-011',
        recommendationId: 'rec-single-042',
        createdAt: '2026-01-20T14:05:00.000Z',
};

/** Simulate a legacy 'saved' status that sits outside the frozen status union (the bridge must still refuse it). */
function withStatus(recommendation: RecommendationFixture, status: string): RecommendationFixture {
        return { ...recommendation, status: status as RecommendationFixture['status'] };
}

/** Bridge the pipeline scenario or throw (the positive-path fixture must always bridge). */
function bridgePipeline(): TaskBridgeResult {
        const result = bridgeRecommendation({ recommendation: pipelineRecommendation, experimentLink: pipelineLink, nowIso });
        if (result === undefined) {
                throw new Error('the pipeline fixture must bridge');
        }
        return result;
}

/** Bridge the single scenario or throw (the positive-path fixture must always bridge). */
function bridgeSingle(): TaskBridgeResult {
        const result = bridgeRecommendation({ recommendation: singleRecommendation, experimentLink: singleLink, nowIso });
        if (result === undefined) {
                throw new Error('the single fixture must bridge');
        }
        return result;
}

/** Compute the bridgeEntryId for an ad hoc (recommendation, link) pair or throw. */
function bridgeEntryIdOf(recommendation: RecommendationFixture, link: LinkFixture): string {
        const result = bridgeRecommendation({ recommendation, experimentLink: link, nowIso });
        if (result === undefined) {
                throw new Error('fixture must bridge');
        }
        return result.bridgeEntryId;
}

suite('taskBridge', () => {
        test('refuses a saved recommendation (issued-only law)', () => {
                const result = bridgeRecommendation({ recommendation: withStatus(pipelineRecommendation, 'saved'), experimentLink: pipelineLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses an applied recommendation (never re-bridges)', () => {
                const applied: RecommendationFixture = { ...pipelineRecommendation, status: 'applied' };
                const result = bridgeRecommendation({ recommendation: applied, experimentLink: pipelineLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses a reverted recommendation', () => {
                const reverted: RecommendationFixture = { ...pipelineRecommendation, status: 'reverted' };
                const result = bridgeRecommendation({ recommendation: reverted, experimentLink: pipelineLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses a workspace mismatch between recommendation and experiment link', () => {
                const otherWorkspace: LinkFixture = { ...pipelineLink, scope: { workspaceId: 'ws-flauz-other', tenantId: 'tenant-flauz' } };
                const result = bridgeRecommendation({ recommendation: pipelineRecommendation, experimentLink: otherWorkspace, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses a tenant mismatch between recommendation and experiment link', () => {
                const otherTenant: LinkFixture = { ...pipelineLink, scope: { workspaceId: 'ws-flauz-lab', tenantId: 'tenant-other' } };
                const result = bridgeRecommendation({ recommendation: pipelineRecommendation, experimentLink: otherTenant, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses a contract version mismatch between recommendation and experiment link', () => {
                const olderLink: LinkFixture = { ...pipelineLink, contractVersion: '0.9.0' };
                const result = bridgeRecommendation({ recommendation: pipelineRecommendation, experimentLink: olderLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses inputs stamped with a contract version the bridge does not speak', () => {
                // Both sides agree on 0.9.0, but the bridge only speaks LAB_CONTRACTS_VERSION ('1.0.0'); it never guesses.
                const olderRecommendation: RecommendationFixture = { ...pipelineRecommendation, contractVersion: '0.9.0' };
                const olderLink: LinkFixture = { ...pipelineLink, contractVersion: '0.9.0' };
                const result = bridgeRecommendation({ recommendation: olderRecommendation, experimentLink: olderLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses an organization with no nodes', () => {
                const emptyNodes: RecommendationFixture = {
                        ...pipelineRecommendation,
                        organization: { ...pipelineRecommendation.organization, nodes: [] },
                };
                const result = bridgeRecommendation({ recommendation: emptyNodes, experimentLink: pipelineLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('refuses a node without an occupancy entry (the bridge never guesses a model)', () => {
                const partialOccupancy: RecommendationFixture = {
                        ...pipelineRecommendation,
                        organization: { ...pipelineRecommendation.organization, occupancy: pipelineRecommendation.organization.occupancy.slice(0, 2) },
                };
                const result = bridgeRecommendation({ recommendation: partialOccupancy, experimentLink: pipelineLink, nowIso });
                assert.strictEqual(result, undefined);
        });

        test('shapes the bridgeEntryId as the bridge- prefix plus exactly 8 lowercase hex chars', () => {
                const id = bridgePipeline().bridgeEntryId;
                assert.ok(id.startsWith('bridge-'));
                assert.strictEqual(id.length, 'bridge-'.length + 8);
                assert.ok(/^[0-9a-f]{8}$/.test(id.slice('bridge-'.length)));
        });

        test('recomputes an identical bridgeEntryId for identical inputs', () => {
                assert.strictEqual(bridgeEntryIdOf(pipelineRecommendation, pipelineLink), bridgeEntryIdOf(pipelineRecommendation, pipelineLink));
        });

        test('derives a different bridgeEntryId for a different recommendation id', () => {
                const renamed: RecommendationFixture = { ...pipelineRecommendation, id: 'rec-pipeline-002' };
                assert.notStrictEqual(bridgeEntryIdOf(renamed, pipelineLink), bridgeEntryIdOf(pipelineRecommendation, pipelineLink));
        });

        test('shapes the task request title, owner note, and always-empty changes', () => {
                const taskRequest = bridgePipeline().taskRequest;
                assert.strictEqual(taskRequest.title, 'Flauz Lab recommendation rec-pipeline-001');
                assert.strictEqual(taskRequest.ownerNote, 'Created by the Lab bridge adapter; execution routes through Agent OS approvals');
                assert.deepStrictEqual(taskRequest.changes, []);
        });

        test('emits exactly two initial events (plan then linkage) stamped with the injected ts', () => {
                const events = bridgePipeline().taskRequest.initialEvents;
                assert.strictEqual(events.length, 2);
                assert.strictEqual(events[0].type, 'lab-bridge.plan');
                assert.strictEqual(events[1].type, 'lab-bridge.linkage');
                assert.strictEqual(events[0].actor, 'agent');
                assert.strictEqual(events[1].actor, 'agent');
                assert.strictEqual(events[0].ts, Date.parse(nowIso));
                assert.strictEqual(events[1].ts, Date.parse(nowIso));
        });

        test('carries the plan payload verbatim from the recommendation', () => {
                const plan = bridgePipeline().taskRequest.initialEvents[0].payload;
                assert.strictEqual(plan['recommendationId'], pipelineRecommendation.id);
                assert.strictEqual(plan['runId'], pipelineRecommendation.runId);
                assert.strictEqual(plan['rationale'], pipelineRecommendation.rationale);
                assert.strictEqual(plan['confidence'], pipelineRecommendation.confidence);
                assert.deepStrictEqual(plan['expectedGains'], pipelineRecommendation.expectedGains);
                assert.deepStrictEqual(plan['caveats'], pipelineRecommendation.caveats);
        });

        test('carries the linkage payload from the experiment link and the bridge entry', () => {
                const result = bridgePipeline();
                const linkage = result.taskRequest.initialEvents[1].payload;
                assert.strictEqual(linkage['runId'], pipelineLink.runId);
                assert.strictEqual(linkage['recommendationId'], pipelineRecommendation.id);
                assert.strictEqual(linkage['bridgeEntryId'], result.bridgeEntryId);
                assert.strictEqual(linkage['experimentLinkId'], pipelineLink.id);
        });

        test('builds one dense 1-based step per node in node array order', () => {
                const steps = bridgePipeline().workflowDraft.steps;
                assert.strictEqual(steps.length, pipelineRecommendation.organization.nodes.length);
                assert.deepStrictEqual(steps.map((step) => step.seq), [1, 2, 3]);
                assert.deepStrictEqual(steps.map((step) => step.inputTemplate.bodyId), ['body-drafter', 'body-reviewer', 'body-publisher']);
        });

        test('keeps the ask/abort security law on every step of both scenarios', () => {
                for (const result of [bridgePipeline(), bridgeSingle()]) {
                        for (const step of result.workflowDraft.steps) {
                                assert.strictEqual(step.approval, 'ask');
                                assert.strictEqual(step.onFail, 'abort');
                                assert.strictEqual(step.toolId, BRIDGE_STEP_TOOL_ID);
                        }
                }
        });

        test('resolves modelId from occupancy and carries name, reportsTo, and edgeKinds verbatim', () => {
                const [drafter, reviewer, publisher] = bridgePipeline().workflowDraft.steps;
                assert.strictEqual(drafter.name, 'drafter (body-drafter)');
                assert.strictEqual(reviewer.name, 'reviewer (body-reviewer)');
                assert.strictEqual(publisher.name, 'publisher (body-publisher)');
                assert.strictEqual(drafter.inputTemplate.role, 'drafter');
                assert.strictEqual(reviewer.inputTemplate.role, 'reviewer');
                assert.strictEqual(drafter.inputTemplate.modelId, 'glm-4.7-air');
                assert.strictEqual(reviewer.inputTemplate.modelId, 'glm-4.7');
                assert.strictEqual(publisher.inputTemplate.modelId, 'glm-4.7-flash');
                assert.strictEqual(drafter.inputTemplate.reportsTo, null);
                assert.strictEqual(reviewer.inputTemplate.reportsTo, 'node-drafter');
                assert.strictEqual(publisher.inputTemplate.reportsTo, 'node-reviewer');
                assert.deepStrictEqual(drafter.inputTemplate.edgeKinds, [
                        { to: 'node-reviewer', kind: 'handoff' },
                        { to: 'node-publisher', kind: 'delegation' },
                ]);
                assert.deepStrictEqual(reviewer.inputTemplate.edgeKinds, [{ to: 'node-publisher', kind: 'review' }]);
                assert.deepStrictEqual(publisher.inputTemplate.edgeKinds, []);
        });

        test('exposes exactly one workflow input: labRecommendationId (string, required)', () => {
                const inputs = bridgePipeline().workflowDraft.inputs;
                assert.deepStrictEqual(inputs, [
                        { name: 'labRecommendationId', type: 'string', required: true, description: 'The Lab recommendation this workflow executes' },
                ]);
        });

        test('titles the workflow draft after the recommendation', () => {
                assert.strictEqual(bridgePipeline().workflowDraft.title, 'Lab bridge rec-pipeline-001');
        });

        test('lists exactly three evidence expectations in the canonical order with embedded uris', () => {
                const result = bridgePipeline();
                const expectations = result.evidenceExpectations;
                assert.strictEqual(expectations.length, 3);
                assert.deepStrictEqual(expectations.map((expectation) => expectation.kind), ['command-output', 'changeset', 'note']);
                assert.deepStrictEqual(expectations.map((expectation) => expectation.uri), [
                        `expectation://${result.bridgeEntryId}/run-log`,
                        `expectation://${result.bridgeEntryId}/changes`,
                        `expectation://${result.bridgeEntryId}/outcome`,
                ]);
                assert.deepStrictEqual(expectations.map((expectation) => expectation.note), [
                        'The executed task run log (Agent OS appendEvidence)',
                        'Changes produced by the executed task, if any',
                        'The outcome summary consumed by the LAB-008 observation adapter',
                ]);
        });

        test('shapes the linkage continuation from the inputs', () => {
                const result = bridgePipeline();
                assert.strictEqual(result.linkage.runId, pipelineLink.runId);
                assert.strictEqual(result.linkage.recommendationId, pipelineRecommendation.id);
                assert.strictEqual(result.linkage.bridgeEntryId, result.bridgeEntryId);
                assert.strictEqual(result.linkage.createdAt, nowIso);
        });

        test('carries exactly the three verbatim honesty notes', () => {
                assert.deepStrictEqual(bridgePipeline().notes, [
                        'The Lab never becomes a second execution engine: this adapter shapes requests only.',
                        'Every workflow step requires human approval (ask) - the bridge cannot relax the security boundary.',
                        'Model assignments come verbatim from the recommendation occupancy; the Model Fabric keeps routing authority.',
                ]);
        });

        test('returns deep-equal and JSON-identical results for two identical calls (determinism)', () => {
                const first = bridgeRecommendation({ recommendation: { ...pipelineRecommendation }, experimentLink: { ...pipelineLink }, nowIso });
                const second = bridgeRecommendation({ recommendation: { ...pipelineRecommendation }, experimentLink: { ...pipelineLink }, nowIso });
                if (first === undefined || second === undefined) {
                        throw new Error('the pipeline fixture must bridge');
                }
                assert.deepStrictEqual(first, second);
                assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
        });

        test('honors the contract law: frozen contract version and verbatim scope', () => {
                const result = bridgePipeline();
                // LAB_CONTRACTS_VERSION is frozen at '1.0.0' in labContracts.ts; the test pins the frozen value.
                assert.strictEqual(result.contractVersion, '1.0.0');
                assert.deepStrictEqual(result.scope, pipelineRecommendation.scope);
        });

        test('bridges the single-node organization end to end', () => {
                const result = bridgeSingle();
                assert.strictEqual(result.workflowDraft.title, 'Lab bridge rec-single-042');
                assert.strictEqual(result.workflowDraft.steps.length, 1);
                const step = result.workflowDraft.steps[0];
                assert.strictEqual(step.seq, 1);
                assert.strictEqual(step.name, 'solo-operator (body-solo)');
                assert.strictEqual(step.inputTemplate.modelId, 'glm-4.7-air');
                assert.strictEqual(step.inputTemplate.role, 'solo-operator');
                assert.strictEqual(step.inputTemplate.reportsTo, null);
                assert.deepStrictEqual(step.inputTemplate.edgeKinds, []);
                assert.strictEqual(result.taskRequest.title, 'Flauz Lab recommendation rec-single-042');
                assert.strictEqual(result.taskRequest.initialEvents.length, 2);
                assert.strictEqual(result.evidenceExpectations.length, 3);
                assert.strictEqual(result.notes.length, 3);
        });

        test('yields distinct bridgeEntryIds across the two scenarios', () => {
                assert.notStrictEqual(bridgePipeline().bridgeEntryId, bridgeSingle().bridgeEntryId);
        });
});
