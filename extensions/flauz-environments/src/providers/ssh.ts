/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * `ssh` provider (kind: ssh-local) -- own OSS resolver posture (DL-7/DL-8).
 *
 * The connection plan is generated against the in-tree blueprint
 * `extensions/vscode-test-resolver` (the OSS reference resolver) and carries
 * the AHP RemoteProxy bridge handshake (C-33 / DL-8):
 *
 *   - resolver registration: `vscode.workspace.registerRemoteAuthorityResolver('ssh-remote', ...)`
 *     -- extensions/vscode-test-resolver/src/extension.ts:376-393, API at
 *     src/vscode-dts/vscode.proposed.resolvers.d.ts:456.
 *   - server spawn with `--connection-token` -- extension.ts:166-168.
 *   - agent host: `--agent-host-port` (embedded, spawned inside the server) and
 *     `--agent-host-bridge-port` (bridged, renderer <-> an externally-running
 *     agent host such as `code agent host`) are MUTUALLY EXCLUSIVE --
 *     extension.ts:169-192.
 *   - bridge token: `VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN` env var --
 *     extension.ts:26 (const) + :194 (env write). The token VALUE is never
 *     persisted in the registry; descriptors carry a vault reference
 *     (`agentHostBridge.tokenRef`, SECURITY-MODEL 3.5).
 *   - the remote server proxies AHP JSON-RPC frames renderer <-> server-side
 *     agent host over the `AgentHostIpcChannels.RemoteProxy` channel --
 *     src/vs/platform/agentHost/common/agentService.ts:66-72.
 *   - SSH host-key pinning policy (trust phase) --
 *     src/vs/platform/agentHost/common/sshHostKeyTrust.ts + sshHostKeyPolicy.ts.
 *
 * v0 generates the plan only; NO live connection is attempted (sandbox
 * discipline -- runners execute the plan via the C-ENV canary workflow).
 */
import {
	isAbsolutePosixPath,
	isHost,
	isNonEmptyString,
	isPort,
	isPlainObject,
	isSshAuthMethod,
	isSecretRef,
	SCHEMA_ID,
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

/** Env var carrying the bridge connection token to the server (blueprint :26). */
export const SSH_BRIDGE_TOKEN_ENV_VAR = 'VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN';

/** Authority prefix the Flauz OSS SSH resolver registers under. */
export const SSH_AUTHORITY_PREFIX = 'ssh-remote';

export const SSH_PROVIDER_ID = 'ssh';

export const SSH_DEFAULT_CAPABILITIES: EnvironmentCapabilities = {
	browser: false,
	exec: true,
	agentHost: true,
	terminal: true,
};

export const SSH_DEFAULT_TRUST_POSTURE: TrustPosture = 'unknown';

const SSH_CONNECTION_REQUIRED_KEYS = ['host', 'authMethod'] as const;
const SSH_CONNECTION_OPTIONAL_KEYS = ['port', 'user', 'remotePath', 'agentHostBridge'] as const;

export function validateSshConnection(connection: unknown): EnvironmentConnection {
	if (!isPlainObject(connection) || !hasOnlyKeys(connection, SSH_CONNECTION_REQUIRED_KEYS, SSH_CONNECTION_OPTIONAL_KEYS)) {
		throw envelopeError(`ssh connection must be an object with keys [${SSH_CONNECTION_REQUIRED_KEYS.join(', ')}] plus at most [${SSH_CONNECTION_OPTIONAL_KEYS.join(', ')}] (unknown keys rejected)`);
	}
	if (!isHost(connection.host)) {
		throw envelopeError(`ssh connection host must be a non-empty hostname/IP (1-253 chars of [A-Za-z0-9._-]) (got ${JSON.stringify(connection.host)})`);
	}
	if (hasKey(connection, 'port') && connection.port !== undefined && !isPort(connection.port)) {
		throw envelopeError(`ssh connection port must be an integer 1-65535 (got ${JSON.stringify(connection.port)})`);
	}
	if (hasKey(connection, 'user') && connection.user !== undefined && !isNonEmptyString(connection.user)) {
		throw envelopeError('ssh connection user must be a non-empty string when present');
	}
	if (!isSshAuthMethod(connection.authMethod)) {
		throw envelopeError(`ssh connection authMethod must be one of agent|key|password (got ${JSON.stringify(connection.authMethod)})`);
	}
	if (hasKey(connection, 'remotePath') && connection.remotePath !== undefined && !isAbsolutePosixPath(connection.remotePath)) {
		throw envelopeError(`ssh connection remotePath must be an absolute POSIX path (got ${JSON.stringify(connection.remotePath)})`);
	}
	if (hasKey(connection, 'agentHostBridge') && connection.agentHostBridge !== undefined) {
		const bridge = connection.agentHostBridge;
		if (!isPlainObject(bridge) || !hasOnlyKeys(bridge, ['bridgePort', 'tokenRef'] as const, [])) {
			throw envelopeError('ssh agentHostBridge must be an object with exactly the keys [bridgePort, tokenRef]');
		}
		if (!isPort(bridge.bridgePort)) {
			throw envelopeError(`ssh agentHostBridge bridgePort must be an integer 1-65535 (got ${JSON.stringify(bridge.bridgePort)})`);
		}
		if (!isSecretRef(bridge.tokenRef)) {
			throw envelopeError(`ssh agentHostBridge tokenRef must be a vault-style reference (vault:<name> or env:<name>) -- never a literal token (SECURITY-MODEL 3.5) (got ${JSON.stringify(bridge.tokenRef)})`);
		}
	}
	return connection as unknown as EnvironmentConnection;
}

function sshSteps(descriptor: EnvironmentDescriptor): PlanStep[] {
	const steps: PlanStep[] = [];
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { host: string }>;
	const port = connection.port ?? 22;
	steps.push({
		id: 'ssh-host-key-pin',
		action: `verify/pin host key for ${connection.host} (SSH trust phase; escape = environmentPower-class permission, default-confirm)`,
		treeRef: 'src/vs/platform/agentHost/common/sshHostKeyTrust.ts + sshHostKeyPolicy.ts + sshKnownHosts.ts (host-key pinning policy for agent SSH -- SECURITY-MODEL 3.4)',
	});
	steps.push({
		id: 'ssh-resolver-resolve',
		action: `resolver resolves authority ${SSH_AUTHORITY_PREFIX}+${connection.host}: spawn/attach remote server (in-repo src/vs/server/), pass --connection-token, resolve to host+port (ManagedResolvedAuthority when the tunnel is managed)`,
		treeRef: 'extensions/vscode-test-resolver/src/extension.ts:145-192 (server spawn + connection token), :254-280 (ManagedResolvedAuthority); src/vscode-dts/vscode.proposed.resolvers.d.ts:29-51 (ResolvedAuthority/ManagedResolvedAuthority)',
	});
	steps.push({
		id: 'ssh-agent-host',
		action: connection.agentHostBridge
			? `bridge to the externally-running agent host: server gets --agent-host-bridge-port ${connection.agentHostBridge.bridgePort}; token (resolved from ${connection.agentHostBridge.tokenRef}) is passed via env ${SSH_BRIDGE_TOKEN_ENV_VAR}; AHP frames ride AgentHostIpcChannels.RemoteProxy`
			: `server spawns its own agent host (--agent-host-port); AHP frames ride AgentHostIpcChannels.RemoteProxy`,
		treeRef: 'extensions/vscode-test-resolver/src/extension.ts:26 (token env const), :166-194 (agent-host-port vs agent-host-bridge-port mutual exclusion + token env write); src/vs/platform/agentHost/common/agentService.ts:66-72 (RemoteProxy channel proxies AHP JSON-RPC frames renderer<->server agent host)',
	});
	steps.push({
		id: 'ssh-open-window',
		action: `open the workspace on authority ${SSH_AUTHORITY_PREFIX}+${connection.host} (re-open continuity: vscode.newWindow { remoteAuthority })`,
		treeRef: 'extensions/vscode-test-resolver/src/extension.ts:396-403 (vscode.newWindow remoteAuthority pattern); src/vs/workbench/contrib/remote/browser/remoteIndicator.ts:132-133 (remoteAuthority from environmentService)',
	});
	return steps;
}

export function buildSshPlan(descriptor: EnvironmentDescriptor): ConnectionPlan {
	expectProviderKind(sshProvider, descriptor);
	const connection = descriptor.connection as Extract<EnvironmentDescriptor['connection'], { host: string }>;
	const authority = `${SSH_AUTHORITY_PREFIX}+${connection.host}`;
	const notes: string[] = [
		'v0 plan only -- no live connection (runners execute the plan; REPORT GAPS-AND-SKIPS).',
		`MS Remote-SSH stays out (license-blocked, DL-7); own OSS resolver on the vscode-test-resolver blueprint.`,
	];
	const bridged = connection.agentHostBridge !== undefined && connection.agentHostBridge !== null;
	if (bridged) {
		notes.push(`bridge token resolved at runtime from ${connection.agentHostBridge!.tokenRef} -- never persisted (SECURITY-MODEL 3.5).`);
	}
	return {
		$schema: CONNECTION_PLAN_SCHEMA_ID,
		environmentId: descriptor.id,
		kind: descriptor.kind,
		authority,
		resolver: {
			authorityPrefix: SSH_AUTHORITY_PREFIX,
			managed: false,
			steps: sshSteps(descriptor).slice(0, 2),
		},
		agentHost: bridged
			? {
				mode: 'bridged',
				bridge: {
					bridgePort: connection.agentHostBridge!.bridgePort,
					tokenRef: connection.agentHostBridge!.tokenRef,
					tokenEnvVar: SSH_BRIDGE_TOKEN_ENV_VAR,
				},
				treeRef: 'extensions/vscode-test-resolver/src/extension.ts:176-194; src/vs/platform/agentHost/common/agentService.ts:66-72 (AgentHostIpcChannels.RemoteProxy)',
			}
			: {
				mode: 'embedded',
				treeRef: 'extensions/vscode-test-resolver/src/extension.ts:169-175 (--agent-host-port spawns the agent host inside the server); src/vs/platform/agentHost/common/sshRemoteAgentHost.ts',
			},
		phases: [
			{
				id: 'validate',
				title: 'SSH trust + descriptor validation',
				steps: sshSteps(descriptor).slice(0, 1),
				budgetMs: 50,
				marks: [],
			},
			{
				id: 'resolve',
				title: 'Resolve authority + spawn/attach remote server',
				steps: sshSteps(descriptor).slice(1, 2),
				budgetMs: 0,
				marks: ['code/flauz/willResolveEnv', 'code/flauz/didResolveEnv'],
			},
			{
				id: 'agent-host',
				title: bridged ? 'Bridge renderer to external agent host (AHP RemoteProxy)' : 'Spawn agent host inside the server',
				steps: sshSteps(descriptor).slice(2, 3),
				budgetMs: 150,
				marks: ['code/flauz/willBridgeAgentHost', 'code/flauz/didBridgeAgentHost'],
			},
			{
				id: 'ready',
				title: 'Open workspace on the resolved authority (re-open continuity kicks in)',
				steps: sshSteps(descriptor).slice(3, 4),
				budgetMs: 300,
				marks: ['code/flauz/willRehydrateEnvSwitch', 'code/flauz/didRehydrateEnvSwitch'],
			},
		],
		budgets: { warmSwitchMs: 1500, choreographyMs: 500 },
		notes,
	};
}

export const sshProvider: EnvironmentProvider = {
	id: SSH_PROVIDER_ID,
	kind: 'ssh-local',
	defaultTrustPosture: SSH_DEFAULT_TRUST_POSTURE,
	defaultCapabilities: SSH_DEFAULT_CAPABILITIES,
	validateConnection: validateSshConnection,
	buildConnectionPlan: buildSshPlan,
};
