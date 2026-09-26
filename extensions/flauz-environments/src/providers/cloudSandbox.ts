/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * `cloud-sandbox` provider (kind: cloud-sandbox) -- E2B-class descriptor,
 * entitlement-free by construction (matrix C-33 / DL-8):
 *
 *   - the in-tree `cloudSandbox*` services
 *     (src/vs/platform/agentHost/common/cloudSandboxAgentHost.ts +
 *     src/vs/workbench/contrib/chat/browser/remoteAgentHost/cloudSandbox*.ts)
 *     are Copilot-entitlement-bound (credential refresh, editor
 *     contribution) and stay REFERENCE-ONLY.
 *   - Flauz cloud sandboxes = provider extensions against the resolver API +
 *     AHP; the sandbox runs an AHP-speaking agent host reached over the
 *     `AgentHostIpcChannels.RemoteProxy` channel
 *     (src/vs/platform/agentHost/common/agentService.ts:66-72).
 *   - read-only cloud sessions are the safe default tier
 *     (cloudSandboxReadOnlySessionHandler.ts -- SECURITY-MODEL 3.4).
 *   - cloud browser panes stream per the PERF 5.3 quality ladder
 *     (fps -> quality -> on-demand snapshots, watermark backpressure).
 *
 * v0 validates the descriptor + generates the plan; NO cloud API call
 * happens in the sandbox (runners execute the plan).
 */
import {
	isCloudSandboxProviderId,
	isNonEmptyString,
	isPlainObject,
	isSecretRef,
	hasKey,
	hasOnlyKeys,
	type EnvironmentCapabilities,
	type EnvironmentConnection,
	type EnvironmentDescriptor,
	type TrustPosture,
} from '../api.ts';
import {
	CONNECTION_PLAN_SCHEMA_ID,
	envelopeError,
	expectProviderKind,
	type ConnectionPlan,
	type EnvironmentProvider,
	type PlanStep,
} from './types.ts';

export const CLOUD_SANDBOX_PROVIDER_ID = 'cloud-sandbox';

/** In-tree setting that gates the (reference-only) MS cloud path -- never used by Flauz sandboxes; cited as the entitlement-coupled contrast (DL-8). */
export const MS_CLOUD_SANDBOX_SETTING = 'chat.agentHost.cloudSandbox.enabled';

export const CLOUD_SANDBOX_DEFAULT_CAPABILITIES: EnvironmentCapabilities = {
	browser: true,
	exec: true,
	agentHost: true,
	terminal: true,
};

export const CLOUD_SANDBOX_DEFAULT_TRUST_POSTURE: TrustPosture = 'untrusted';

const CLOUD_CONNECTION_REQUIRED_KEYS = ['provider', 'apiKeyRef', 'sandboxTemplate'] as const;
const CLOUD_CONNECTION_OPTIONAL_KEYS = ['region'] as const;

export function validateCloudSandboxConnection(connection: unknown): EnvironmentConnection {
	if (!isPlainObject(connection) || !hasOnlyKeys(connection, CLOUD_CONNECTION_REQUIRED_KEYS, CLOUD_CONNECTION_OPTIONAL_KEYS)) {
		throw envelopeError(`cloud-sandbox connection must be an object with keys [${CLOUD_CONNECTION_REQUIRED_KEYS.join(', ')}] plus at most [${CLOUD_CONNECTION_OPTIONAL_KEYS.join(', ')}] (unknown keys rejected)`);
	}
	if (!isCloudSandboxProviderId(connection.provider)) {
		throw envelopeError(`cloud-sandbox connection provider must be one of e2b|custom (got ${JSON.stringify(connection.provider)})`);
	}
	if (!isSecretRef(connection.apiKeyRef)) {
		throw envelopeError(`cloud-sandbox connection apiKeyRef must be a vault-style reference (vault:<name> or env:<name>) -- never a literal API key (SECURITY-MODEL 3.5) (got ${JSON.stringify(connection.apiKeyRef)})`);
	}
	if (!isNonEmptyString(connection.sandboxTemplate) || connection.sandboxTemplate.length > 100) {
		throw envelopeError(`cloud-sandbox connection sandboxTemplate must be a non-empty string (<= 100 chars) (got ${JSON.stringify(connection.sandboxTemplate)})`);
	}
	if (hasKey(connection, 'region') && connection.region !== undefined && !isNonEmptyString(connection.region)) {
		throw envelopeError('cloud-sandbox connection region must be a non-empty string when present');
	}
	return connection as unknown as EnvironmentConnection;
}

function cloudSteps(descriptor: EnvironmentDescriptor): PlanStep[] {
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { apiKeyRef: string }>;
	return [
		{
			id: 'cloud-vault-ref',
			action: `resolve API key from ${JSON.stringify(connection.apiKeyRef)} (SecretStorage; never materialized outside the vault) + confirm the provider extension is installed`,
			treeRef: 'src/vscode-dts/vscode.d.ts (SecretStorage/secrets surface); SECURITY-MODEL 3.5 (keys referenced, not copied); resolver-category extension per DL-7',
		},
		{
			id: 'cloud-provision',
			action: `provision/attach the ${connection.provider} sandbox from template ${JSON.stringify(connection.sandboxTemplate)}; resolver registers under prefix ${connection.provider} and resolves to the sandbox endpoint`,
			treeRef: 'extensions/vscode-test-resolver/src/extension.ts:376-393 (resolver registration blueprint); src/vscode-dts/vscode.proposed.resolvers.d.ts:456 (registerRemoteAuthorityResolver)',
		},
		{
			id: 'cloud-agent-host',
			action: 'AHP agent host runs INSIDE the sandbox; the remote server proxies AHP JSON-RPC frames renderer <-> sandbox agent host over AgentHostIpcChannels.RemoteProxy; read-only tier is the default posture',
			treeRef: 'src/vs/platform/agentHost/common/agentService.ts:66-72 (RemoteProxy channel); reference contrast: src/vs/platform/agentHost/common/cloudSandboxAgentHost.ts (Copilot-entitlement-bound, DL-8 reference-only) + cloudSandboxReadOnlySessionHandler.ts (read-only containment tier)',
		},
		{
			id: 'cloud-open-window',
			action: 'open the workspace on the sandbox authority (re-open continuity: vscode.newWindow { remoteAuthority }); cloud browser panes stream per the PERF 5.3 ladder',
			treeRef: 'extensions/vscode-test-resolver/src/extension.ts:396-403 (authority open pattern); PERF 5.3 remote-pane quality ladder (fps -> quality -> on-demand snapshots + watermark backpressure)',
		},
	];
}

export function buildCloudSandboxPlan(descriptor: EnvironmentDescriptor): ConnectionPlan {
	expectProviderKind(cloudSandboxProvider, descriptor);
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { apiKeyRef: string }>;
	const authority = `${connection.provider}+${descriptor.id}`;
	const steps = cloudSteps(descriptor);
	return {
		$schema: CONNECTION_PLAN_SCHEMA_ID,
		environmentId: descriptor.id,
		kind: descriptor.kind,
		authority,
		resolver: {
			authorityPrefix: connection.provider,
			managed: true,
			steps: steps.slice(0, 2),
		},
		agentHost: {
			mode: 'remote-proxy',
			treeRef: 'src/vs/platform/agentHost/common/agentService.ts:66-72 (AgentHostIpcChannels.RemoteProxy proxies AHP JSON-RPC frames renderer<->server agent host); sandbox agent host per DL-8 provider extension',
		},
		phases: [
			{
				id: 'validate',
				title: 'Vault reference + provider extension presence',
				steps: steps.slice(0, 1),
				budgetMs: 50,
				marks: [],
			},
			{
				id: 'resolve',
				title: 'Provision/attach sandbox + resolve authority (managed)',
				steps: steps.slice(1, 2),
				budgetMs: 0,
				marks: ['code/flauz/willResolveEnv', 'code/flauz/didResolveEnv'],
			},
			{
				id: 'agent-host',
				title: 'AHP RemoteProxy frame relay into the sandbox',
				steps: steps.slice(2, 3),
				budgetMs: 150,
				marks: ['code/flauz/willBridgeAgentHost', 'code/flauz/didBridgeAgentHost'],
			},
			{
				id: 'ready',
				title: 'Open workspace on the sandbox authority (re-open continuity; remote panes per 5.3 ladder)',
				steps: steps.slice(3, 4),
				budgetMs: 300,
				marks: ['code/flauz/willRehydrateEnvSwitch', 'code/flauz/didRehydrateEnvSwitch'],
			},
		],
		budgets: { warmSwitchMs: 1500, choreographyMs: 500 },
		notes: [
			'v0 plan only -- no cloud API call in the sandbox (runners execute the plan; REPORT GAPS-AND-SKIPS).',
			'entitlement-free posture (DL-8): in-tree cloudSandbox* services are reference-only; Flauz sandbox providers are extensions.',
			'API key resolved from the vault at runtime -- never persisted (SECURITY-MODEL 3.5).',
			'read-only tier is the default containment posture (cloudSandboxReadOnlySessionHandler precedent, SECURITY-MODEL 3.4).',
		],
	};
}

export const cloudSandboxProvider: EnvironmentProvider = {
	id: CLOUD_SANDBOX_PROVIDER_ID,
	kind: 'cloud-sandbox',
	defaultTrustPosture: CLOUD_SANDBOX_DEFAULT_TRUST_POSTURE,
	defaultCapabilities: CLOUD_SANDBOX_DEFAULT_CAPABILITIES,
	validateConnection: validateCloudSandboxConnection,
	buildConnectionPlan: buildCloudSandboxPlan,
};
