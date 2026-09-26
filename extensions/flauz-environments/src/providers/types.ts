/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Provider adapter contracts (v0). A provider is DESCRIPTOR-LEVEL: it
 * validates a kind-specific connection shape and generates a connection
 * plan. v0 performs NO live connections (sandbox discipline; runners and
 * real-world use execute the plan) -- the plan is the artifact.
 */
import type {
	AgentHostMode,
	EnvironmentCapabilities,
	EnvironmentConnection,
	EnvironmentDescriptor,
	EnvironmentKind,
	TrustPosture,
} from '../api.ts';
import { SCHEMA_ID } from '../api.ts';

/** Schema identifier for emitted connection plans. */
export const CONNECTION_PLAN_SCHEMA_ID = 'flauz.connectionPlan/v0';

/** One concrete step of a plan; `treeRef` cites the tree surface it builds on. */
export interface PlanStep {
	readonly id: string;
	readonly action: string;
	readonly treeRef: string;
}

/** A budgeted phase of the plan. Marks are `code/flauz/*` pair names (DL-23). */
export interface PlanPhase {
	readonly id: string;
	readonly title: string;
	readonly steps: readonly PlanStep[];
	/** Flauz-side choreography budget (PERF 5.5); 0 = not Flauz-budgeted (cold start rides the resolver/container). */
	readonly budgetMs: number;
	readonly marks: readonly string[];
}

/** How the agent host is reached from this environment (AHP). */
export interface AgentHostPlan {
	readonly mode: AgentHostMode;
	/** Present when mode = 'bridged': the externally-running agent host port + token reference. */
	readonly bridge?: {
		readonly bridgePort: number;
		readonly tokenRef: string;
		/** Env var carrying the token to the server (vscode-test-resolver blueprint :26). */
		readonly tokenEnvVar: string;
	};
	readonly treeRef: string;
}

/** The generated connection plan -- the v0 deliverable (no live connection). */
export interface ConnectionPlan {
	readonly $schema: string;
	readonly environmentId: string;
	readonly kind: EnvironmentKind;
	/** Remote authority the resolver resolves (e.g. `ssh-remote+host01`). */
	readonly authority: string;
	readonly resolver: {
		readonly authorityPrefix: string;
		readonly managed: boolean;
		readonly steps: readonly PlanStep[];
	};
	readonly agentHost: AgentHostPlan;
	readonly phases: readonly PlanPhase[];
	readonly budgets: {
		/** PERF 5.5: warm switch (same machine, resolver cached) <= 1.5 s. */
		readonly warmSwitchMs: number;
		/** PERF 5.5: Flauz choreography overhead <= 500 ms on top of cold start. */
		readonly choreographyMs: number;
	};
	readonly notes: readonly string[];
}

/** A descriptor-level environment provider adapter (v0: validation + planning). */
export interface EnvironmentProvider {
	/** Stable provider id (matches the registry's kind dispatch). */
	readonly id: string;
	readonly kind: EnvironmentKind;
	/** Default trust posture applied when a descriptor omits... v0 descriptors carry trust explicitly; defaults document the posture policy (DL-29+ candidate). */
	readonly defaultTrustPosture: TrustPosture;
	/** Default capability flags for the kind (used by tests + policy review). */
	readonly defaultCapabilities: EnvironmentCapabilities;
	/** Validates a kind-specific connection object; returns it typed or throws with a schema-prefixed message. */
	validateConnection(connection: unknown): EnvironmentConnection;
	/** Generates the connection plan for a validated descriptor. */
	buildConnectionPlan(descriptor: EnvironmentDescriptor): ConnectionPlan;
}

/** Descriptor validation error (envelope-schema-prefixed). */
export function envelopeError(message: string): Error {
	return new Error(`${SCHEMA_ID}: ${message}`);
}

/** Plan construction error (plan-schema-prefixed). */
export function planError(message: string): Error {
	return new Error(`${CONNECTION_PLAN_SCHEMA_ID}: ${message}`);
}

export function expectProviderKind(provider: EnvironmentProvider, descriptor: EnvironmentDescriptor): void {
	if (descriptor.kind !== provider.kind) {
		throw planError(`provider '${provider.id}' serves kind '${provider.kind}' but descriptor '${descriptor.id}' has kind '${descriptor.kind}'`);
	}
}
