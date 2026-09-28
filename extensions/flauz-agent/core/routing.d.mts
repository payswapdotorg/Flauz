/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/routing.mjs` (multi-agent routing on the A2A
 * seam). Hand-written per the zero-dependency discipline.
 */

import type { OrchestrationStore } from './orchStore.d.mts';

export declare const CLAIM_NOTICE_TTL_MS: number;

export interface A2aBusPort {
	post(input: { message: { kind: string; from: string; to: string; payload: Record<string, unknown> } }): { id: string; seq: number; message: unknown } | Promise<{ id: string; seq: number; message: unknown }>;
}

export declare function rankAgentsByCapability(candidates: Array<{ agentId: string; capabilities: string[] }>, hints?: { requiredCapability?: string; allowedAgents?: string[] }): { qualified: string[]; rejected: Array<{ agentId: string; reason: string }> };
export declare function pickByLoad(candidates: Array<{ agentId: string; load: number }>): { agentId: string; load: number };
export declare function buildTaskDelegation(store: OrchestrationStore, input: { graphId: string; stepId: string }): { taskId: string; taskDescription: string; prompt: string };
export declare function delegateStep(store: OrchestrationStore, bus: A2aBusPort, input: {
	graphId: string;
	stepId: string;
	targetAgent: string;
	reason: 'capability-match' | 'load-balance' | 'operator-choice';
	details?: Record<string, unknown>;
	fromAgent?: string;
	workflowId?: string;
	actor?: string;
	origin?: string;
}): Promise<{ decisionRowId: string; messageId: string; attempt: number; idempotencyKey: string; receiptRowId: string; message: unknown }>;
export declare function ingestResultReport(store: OrchestrationStore, input: { graphId: string; stepId: string; messageId: string; outcome: 'ok' | 'failed' | 'cancelled'; summary: string; evidenceIds?: string[]; fromAgent?: string }): Promise<{ receiptRowId: string; origin: string }>;
export declare function buildSteeringRelay(store: OrchestrationStore, input: { graphId: string; stepId: string; message: string }): { taskId: string; message: string };
export declare function mirrorResourceClaim(bus: A2aBusPort, input: { action: 'acquire' | 'release' | 'expire'; resource: string; holder: string; leaseUntil?: number | null; fromAgent?: string; toAgent?: string }): Promise<{ messageId: string; leaseUntil: number | null }>;
export declare function stepResourceId(graphId: string, stepId: string): string;
