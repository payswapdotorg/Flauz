/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * `container` provider (kind: container) -- dev-container agent-host shape
 * (matrix C-32 / DL-8). MS Dev Containers extension stays out (license);
 * the dev container SPEC + CLI are OSS and the platform contract is in-tree:
 *
 *   - `IDevContainerAgentHostConfig` { connectionId, workspaceFolder, name } --
 *     src/vs/platform/agentHost/common/devContainerAgentHost.ts:13-19.
 *   - `IDevContainerAgentHostMainService` { isDockerAvailable(), connect(),
 *     disconnect(), onDidOutput, onDidCloseConnection } -- :36-46; the service
 *     owns Dev Container CLI processes + protocol relays and runs over the
 *     `devContainerAgentHost` channel (:10).
 *   - `IDevContainerAgentHostConnectResult` { connectionId, address, name,
 *     remoteWorkspaceFolder, hostWorkspaceFolder? } -- :21-29 (serializable
 *     connection metadata returned to the renderer).
 *   - workbench remote-agent-host contrib (session UI surface) --
 *     src/vs/workbench/contrib/chat/browser/remoteAgentHost/.
 *
 * v0 validates the descriptor and generates the plan; NO docker/CLI call
 * happens in the sandbox (runners execute the plan).
 */
import {
	isAbsolutePosixPath,
	isNonEmptyString,
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

export const CONTAINER_PROVIDER_ID = 'container';

/** Channel id the dev-container agent host service runs over (tree :10). */
export const DEV_CONTAINER_AGENT_HOST_CHANNEL = 'devContainerAgentHost';

export const CONTAINER_DEFAULT_CAPABILITIES: EnvironmentCapabilities = {
	browser: false,
	exec: true,
	agentHost: true,
	terminal: true,
};

export const CONTAINER_DEFAULT_TRUST_POSTURE: TrustPosture = 'trusted';

const CONTAINER_CONNECTION_REQUIRED_KEYS = ['workspaceFolder', 'name'] as const;
const CONTAINER_CONNECTION_OPTIONAL_KEYS = ['devcontainerConfig'] as const;

export function validateContainerConnection(connection: unknown): EnvironmentConnection {
	if (!isPlainObject(connection) || !hasOnlyKeys(connection, CONTAINER_CONNECTION_REQUIRED_KEYS, CONTAINER_CONNECTION_OPTIONAL_KEYS)) {
		throw envelopeError(`container connection must be an object with keys [${CONTAINER_CONNECTION_REQUIRED_KEYS.join(', ')}] plus at most [${CONTAINER_CONNECTION_OPTIONAL_KEYS.join(', ')}] (unknown keys rejected)`);
	}
	if (!isNonEmptyString(connection.workspaceFolder)) {
		throw envelopeError(`container connection workspaceFolder must be a non-empty native workspace path (IDevContainerAgentHostConfig) (got ${JSON.stringify(connection.workspaceFolder)})`);
	}
	if (!isNonEmptyString(connection.name) || connection.name.length > 100) {
		throw envelopeError(`container connection name must be a non-empty string (<= 100 chars) (got ${JSON.stringify(connection.name)})`);
	}
	if (hasKey(connection, 'devcontainerConfig') && connection.devcontainerConfig !== undefined && !isAbsolutePosixPath(connection.devcontainerConfig)) {
		throw envelopeError(`container connection devcontainerConfig must be an absolute POSIX path (got ${JSON.stringify(connection.devcontainerConfig)})`);
	}
	return connection as unknown as EnvironmentConnection;
}

function containerSteps(descriptor: EnvironmentDescriptor): PlanStep[] {
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { workspaceFolder: string }>;
	return [
		{
			id: 'container-docker-check',
			action: 'check Docker resolvable from the user shell (isDockerAvailable) -- fail fast before any CLI spawn',
			treeRef: 'src/vs/platform/agentHost/common/devContainerAgentHost.ts:41-43 (isDockerAvailable over IDevContainerAgentHostMainService)',
		},
		{
			id: 'container-connect',
			action: `connect the dev container agent host: IDevContainerAgentHostMainService.connect({ connectionId: <minted>, workspaceFolder: ${JSON.stringify(connection.workspaceFolder)}, name: ${JSON.stringify(connection.name)} }) -> IDevContainerAgentHostConnectResult { connectionId, address, remoteWorkspaceFolder }`,
			treeRef: 'src/vs/platform/agentHost/common/devContainerAgentHost.ts:21-29 (connect result), :44 (connect()); workbench surface src/vs/workbench/contrib/chat/browser/remoteAgentHost/',
		},
		{
			id: 'container-agent-host',
			action: 'relay AHP protocol frames over the devContainerAgentHost channel; renderer-side frames ride AgentHostIpcChannels.RemoteProxy through the server relay',
			treeRef: `src/vs/platform/agentHost/common/devContainerAgentHost.ts:10 (DEV_CONTAINER_AGENT_HOST_CHANNEL); src/vs/platform/agentHost/common/agentService.ts:66-72 (RemoteProxy channel)`,
		},
		{
			id: 'container-open-window',
			action: 'open the workspace on the container authority (re-open continuity: vscode.newWindow { remoteAuthority })',
			treeRef: 'extensions/vscode-test-resolver/src/extension.ts:396-403 (authority open pattern); src/vs/workbench/contrib/chat/browser/remoteAgentHost/remoteAgentHost.contribution.ts (workbench wiring surface)',
		},
	];
}

export function buildContainerPlan(descriptor: EnvironmentDescriptor): ConnectionPlan {
	expectProviderKind(containerProvider, descriptor);
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { workspaceFolder: string }>;
	const authority = `dev-container+${connection.name}`;
	const steps = containerSteps(descriptor);
	return {
		$schema: CONNECTION_PLAN_SCHEMA_ID,
		environmentId: descriptor.id,
		kind: descriptor.kind,
		authority,
		resolver: {
			authorityPrefix: 'dev-container',
			managed: false,
			steps: steps.slice(0, 2),
		},
		agentHost: {
			mode: 'remote-proxy',
			treeRef: 'src/vs/platform/agentHost/common/devContainerAgentHost.ts:10-46; src/vs/platform/agentHost/common/agentService.ts:66-72 (AgentHostIpcChannels.RemoteProxy proxies AHP JSON-RPC frames renderer<->server agent host)',
		},
		phases: [
			{
				id: 'validate',
				title: 'Docker availability + descriptor validation',
				steps: steps.slice(0, 1),
				budgetMs: 50,
				marks: [],
			},
			{
				id: 'resolve',
				title: 'Connect dev container agent host (CLI + relay)',
				steps: steps.slice(1, 2),
				budgetMs: 0,
				marks: ['code/flauz/willResolveEnv', 'code/flauz/didResolveEnv'],
			},
			{
				id: 'agent-host',
				title: 'AHP frame relay (devContainerAgentHost channel + RemoteProxy)',
				steps: steps.slice(2, 3),
				budgetMs: 150,
				marks: ['code/flauz/willBridgeAgentHost', 'code/flauz/didBridgeAgentHost'],
			},
			{
				id: 'ready',
				title: 'Open workspace on the container authority (re-open continuity kicks in)',
				steps: steps.slice(3, 4),
				budgetMs: 300,
				marks: ['code/flauz/willRehydrateEnvSwitch', 'code/flauz/didRehydrateEnvSwitch'],
			},
		],
		budgets: { warmSwitchMs: 1500, choreographyMs: 500 },
		notes: [
			'v0 plan only -- no docker/CLI call in the sandbox (runners execute the plan; REPORT GAPS-AND-SKIPS).',
			'dev container spec + CLI are OSS (matrix C-32); MS Dev Containers extension stays out (license, DL-7 posture).',
			'connectionId is minted at connect time by IDevContainerAgentHostMainService.connect() -- descriptors carry only stable inputs.',
		],
	};
}

export const containerProvider: EnvironmentProvider = {
	id: CONTAINER_PROVIDER_ID,
	kind: 'container',
	defaultTrustPosture: CONTAINER_DEFAULT_TRUST_POSTURE,
	defaultCapabilities: CONTAINER_DEFAULT_CAPABILITIES,
	validateConnection: validateContainerConnection,
	buildConnectionPlan: buildContainerPlan,
};
