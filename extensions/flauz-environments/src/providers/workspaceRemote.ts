/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * `workspace-remote` provider (kind: workspace-remote) -- the IN-TREE remote
 * authority machinery (matrix C-30/C-31 / ARCHITECTURE-MAPPING row 5):
 *
 *   - resolver API: `vscode.workspace.registerRemoteAuthorityResolver(
 *     authorityPrefix, resolver)` --
 *     src/vscode-dts/vscode.proposed.resolvers.d.ts:456; resolver contract
 *     :381-433 (resolve / resolveExecServer / getCanonicalURI /
 *     tunnelFactory / showCandidatePort).
 *   - nested `a@b` chained authorities (transit through midpoints) --
 *     resolvers.d.ts:17-26 (RemoteAuthorityResolverContext.execServer).
 *   - in-repo remote server: src/vs/server/ (non-electron server + ext host
 *     connection services).
 *   - tunnels: Rust CLI cli/src/tunnels/ + remoteTunnel contrib; product
 *     naming `code-tunnel-oss` (product.json:16) -- the Flauz tunnel product
 *     name rides the build input (C-31).
 *   - reference resolver: extensions/vscode-test-resolver (boot-to-authority
 *     blueprint incl. ManagedResolvedAuthority at :254).
 *
 * v0 validates the descriptor + generates the plan; NO connection is
 * attempted (runners execute the plan).
 */
import {
	isAbsolutePosixPath,
	isAuthorityPrefix,
	isPlainObject,
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

export const WORKSPACE_REMOTE_PROVIDER_ID = 'workspace-remote';

export const WORKSPACE_REMOTE_DEFAULT_CAPABILITIES: EnvironmentCapabilities = {
	browser: true,
	exec: true,
	agentHost: true,
	terminal: true,
};

export const WORKSPACE_REMOTE_DEFAULT_TRUST_POSTURE: TrustPosture = 'unknown';

const WORKSPACE_REMOTE_REQUIRED_KEYS = ['authorityPrefix'] as const;
const WORKSPACE_REMOTE_OPTIONAL_KEYS = ['remotePath', 'viaTunnel'] as const;

export function validateWorkspaceRemoteConnection(connection: unknown): EnvironmentConnection {
	if (!isPlainObject(connection) || !hasOnlyKeys(connection, WORKSPACE_REMOTE_REQUIRED_KEYS, WORKSPACE_REMOTE_OPTIONAL_KEYS)) {
		throw envelopeError(`workspace-remote connection must be an object with keys [${WORKSPACE_REMOTE_REQUIRED_KEYS.join(', ')}] plus at most [${WORKSPACE_REMOTE_OPTIONAL_KEYS.join(', ')}] (unknown keys rejected)`);
	}
	if (!isAuthorityPrefix(connection.authorityPrefix)) {
		throw envelopeError(`workspace-remote connection authorityPrefix must match /^[a-z0-9][a-z0-9-]{0,31}$/ -- the prefix a resolver registers under (got ${JSON.stringify(connection.authorityPrefix)})`);
	}
	if (hasKey(connection, 'remotePath') && connection.remotePath !== undefined && !isAbsolutePosixPath(connection.remotePath)) {
		throw envelopeError(`workspace-remote connection remotePath must be an absolute POSIX path (got ${JSON.stringify(connection.remotePath)})`);
	}
	if (hasKey(connection, 'viaTunnel') && connection.viaTunnel !== undefined && typeof connection.viaTunnel !== 'boolean') {
		throw envelopeError(`workspace-remote connection viaTunnel must be a boolean (got ${JSON.stringify(connection.viaTunnel)})`);
	}
	return connection as unknown as EnvironmentConnection;
}

function workspaceRemoteSteps(descriptor: EnvironmentDescriptor): PlanStep[] {
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { authorityPrefix: string }>;
	const transport = connection.viaTunnel === true ? 'tunnel (cli/src/tunnels + remoteTunnel contrib; code-tunnel-oss naming)' : 'in-tree server (src/vs/server/)';
	return [
		{
			id: 'workspace-remote-validate',
			action: `validate authority prefix ${JSON.stringify(connection.authorityPrefix)} (resolver registration target) + workspace trust inheritance`,
			treeRef: 'src/vscode-dts/vscode.proposed.resolvers.d.ts:456 (registerRemoteAuthorityResolver(authorityPrefix, resolver)); src/vs/workbench/contrib/remote/browser/remoteIndicator.ts:132-133 (authority from environmentService)',
		},
		{
			id: 'workspace-remote-resolve',
			action: `resolve the authority over ${transport}; nested a@b chained authorities ride RemoteAuthorityResolverContext.execServer when transiting midpoints`,
			treeRef: 'src/vscode-dts/vscode.proposed.resolvers.d.ts:17-26 (nested authorities + execServer), :381-433 (resolver contract); src/vs/server/ (in-repo server); cli/src/tunnels/ (tunnel transport, C-31)',
		},
		{
			id: 'workspace-remote-agent-host',
			action: 'the server spawns its own agent host (--agent-host-port); AHP frames renderer <-> server ride AgentHostIpcChannels.RemoteProxy',
			treeRef: 'extensions/vscode-test-resolver/src/extension.ts:169-175 (--agent-host-port); src/vs/platform/agentHost/common/agentService.ts:66-72 (RemoteProxy channel)',
		},
		{
			id: 'workspace-remote-open',
			action: `open the workspace on the resolved authority (re-open continuity: vscode.newWindow { remoteAuthority })${connection.remotePath ? ` at ${JSON.stringify(connection.remotePath)}` : ''}`,
			treeRef: 'extensions/vscode-test-resolver/src/extension.ts:396-403 (authority open pattern; managed variant :406-408)',
		},
	];
}

export function buildWorkspaceRemotePlan(descriptor: EnvironmentDescriptor): ConnectionPlan {
	expectProviderKind(workspaceRemoteProvider, descriptor);
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { authorityPrefix: string }>;
	const authority = `${connection.authorityPrefix}+${descriptor.id}`;
	const steps = workspaceRemoteSteps(descriptor);
	return {
		$schema: CONNECTION_PLAN_SCHEMA_ID,
		environmentId: descriptor.id,
		kind: descriptor.kind,
		authority,
		resolver: {
			authorityPrefix: connection.authorityPrefix,
			managed: false,
			steps: steps.slice(0, 2),
		},
		agentHost: {
			mode: 'embedded',
			treeRef: 'src/vs/server/ (in-repo remote server); extensions/vscode-test-resolver/src/extension.ts:169-175 (--agent-host-port embedded spawn); src/vs/platform/agentHost/common/agentService.ts:66-72 (RemoteProxy)',
		},
		phases: [
			{
				id: 'validate',
				title: 'Authority prefix + trust validation',
				steps: steps.slice(0, 1),
				budgetMs: 50,
				marks: [],
			},
			{
				id: 'resolve',
				title: 'Resolve authority (server or tunnel transport)',
				steps: steps.slice(1, 2),
				budgetMs: 0,
				marks: ['code/flauz/willResolveEnv', 'code/flauz/didResolveEnv'],
			},
			{
				id: 'agent-host',
				title: 'Server-side agent host (embedded spawn + RemoteProxy relay)',
				steps: steps.slice(2, 3),
				budgetMs: 150,
				marks: ['code/flauz/willBridgeAgentHost', 'code/flauz/didBridgeAgentHost'],
			},
			{
				id: 'ready',
				title: 'Open workspace on the resolved authority (re-open continuity kicks in)',
				steps: steps.slice(3, 4),
				budgetMs: 300,
				marks: ['code/flauz/willRehydrateEnvSwitch', 'code/flauz/didRehydrateEnvSwitch'],
			},
		],
		budgets: { warmSwitchMs: 1500, choreographyMs: 500 },
		notes: [
			'v0 plan only -- no connection attempted (runners execute the plan; REPORT GAPS-AND-SKIPS).',
			'in-tree machinery end-to-end (C-30/C-31): resolver API + src/vs/server + tunnels CLI; no provider extension needed for the transport itself.',
			'authority suffix is the environment id (deterministic, unique per registry); nested a@b transit is available for chained environments.',
		],
	};
}

export const workspaceRemoteProvider: EnvironmentProvider = {
	id: WORKSPACE_REMOTE_PROVIDER_ID,
	kind: 'workspace-remote',
	defaultTrustPosture: WORKSPACE_REMOTE_DEFAULT_TRUST_POSTURE,
	defaultCapabilities: WORKSPACE_REMOTE_DEFAULT_CAPABILITIES,
	validateConnection: validateWorkspaceRemoteConnection,
	buildConnectionPlan: buildWorkspaceRemotePlan,
};
