/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Provider adapter tests: kind-specific validation + connection-plan
 * generation for all four v0 provider kinds, with tree-citation assertions
 * (the plan IS the artifact -- its treeRefs must survive).
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws, match } from 'node:assert';

import { validateDescriptor, buildConnectionPlan, PROVIDERS, providerFor, providerIdForKind } from '../src/providers/index.ts';
import type { EnvironmentDescriptor } from '../src/api.ts';
import { validateSshConnection, sshProvider, SSH_BRIDGE_TOKEN_ENV_VAR, SSH_AUTHORITY_PREFIX } from '../src/providers/ssh.ts';
import { validateContainerConnection, containerProvider } from '../src/providers/container.ts';
import { validateCloudSandboxConnection } from '../src/providers/cloudSandbox.ts';
import { validateWorkspaceRemoteConnection } from '../src/providers/workspaceRemote.ts';
import { readFixtureJson } from './helpers.ts';

async function loadDescriptor(...segments: readonly string[]): Promise<EnvironmentDescriptor> {
	return validateDescriptor(await readFixtureJson('good', ...segments));
}

test('four provider adapters cover the four v0 kinds, one each', () => {
	strictEqual(PROVIDERS.length, 4);
	deepStrictEqual(PROVIDERS.map(p => p.kind), ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote']);
	deepStrictEqual(PROVIDERS.map(p => p.id), ['ssh', 'container', 'cloud-sandbox', 'workspace-remote']);
	strictEqual(providerIdForKind('ssh-local'), 'ssh');
	strictEqual(providerIdForKind('container'), 'container');
	strictEqual(providerIdForKind('cloud-sandbox'), 'cloud-sandbox');
	strictEqual(providerIdForKind('workspace-remote'), 'workspace-remote');
	throws(() => providerFor('nope' as never), /no provider adapter/);
});

test('provider default postures: ssh unknown, container trusted, cloud-sandbox untrusted (read-only tier), workspace-remote unknown', () => {
	strictEqual(providerFor('ssh-local').defaultTrustPosture, 'unknown');
	strictEqual(providerFor('container').defaultTrustPosture, 'trusted');
	strictEqual(providerFor('cloud-sandbox').defaultTrustPosture, 'untrusted');
	strictEqual(providerFor('workspace-remote').defaultTrustPosture, 'unknown');
	deepStrictEqual(providerFor('cloud-sandbox').defaultCapabilities, { browser: true, exec: true, agentHost: true, terminal: true }, 'cloud: remote browser panes (PERF 5.3 ladder)');
	deepStrictEqual(providerFor('ssh-local').defaultCapabilities, { browser: false, exec: true, agentHost: true, terminal: true });
});

test('ssh plan: authority ssh-remote+host, embedded agent host, blueprint citations, PERF 5.5 budgets', async () => {
	const descriptor = await loadDescriptor('descriptor-ssh.json');
	const plan = buildConnectionPlan(descriptor);
	strictEqual(plan.$schema, 'flauz.connectionPlan/v0');
	strictEqual(plan.authority, 'ssh-remote+build.example.internal');
	strictEqual(plan.resolver.authorityPrefix, SSH_AUTHORITY_PREFIX);
	strictEqual(plan.resolver.managed, false);
	strictEqual(plan.agentHost.mode, 'embedded');
	deepStrictEqual(plan.budgets, { warmSwitchMs: 1500, choreographyMs: 500 });
	deepStrictEqual(plan.phases.map(p => p.id), ['validate', 'resolve', 'agent-host', 'ready']);
	const totalBudget = plan.phases.reduce((sum, phase) => sum + phase.budgetMs, 0);
	strictEqual(totalBudget, 500, 'Flauz-side phases sum to the PERF 5.5 choreography budget');
	ok(plan.notes.some(note => note.includes('v0 plan only')), 'no-live-connection note');
	const flat = JSON.stringify(plan);
	match(flat, /vscode-test-resolver\/src\/extension\.ts/, 'blueprint cited');
	match(flat, /agentService\.ts:66-72/, 'AHP RemoteProxy channel cited');
	match(flat, /sshHostKeyTrust\.ts/, 'host-key pinning cited');
});

test('ssh bridged plan: VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN + tokenRef only (never a literal token)', async () => {
	const descriptor = await loadDescriptor('descriptor-ssh-bridged.json');
	const plan = buildConnectionPlan(descriptor);
	strictEqual(plan.agentHost.mode, 'bridged');
	strictEqual(plan.agentHost.bridge?.bridgePort, 7777);
	strictEqual(plan.agentHost.bridge?.tokenEnvVar, SSH_BRIDGE_TOKEN_ENV_VAR);
	strictEqual(plan.agentHost.bridge?.tokenRef, 'vault:agent-host-bridge/env-bridge-host');
	ok(!JSON.stringify(plan).includes('literal-secret'), 'no token material in the plan');
	match(JSON.stringify(plan), /VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN/, 'bridge env var named in plan');
});

test('container plan: dev-container+name authority, IDevContainerAgentHost contract citations', async () => {
	const descriptor = await loadDescriptor('descriptor-container.json');
	const plan = buildConnectionPlan(descriptor);
	strictEqual(plan.authority, 'dev-container+flauz-dev');
	strictEqual(plan.agentHost.mode, 'remote-proxy');
	const flat = JSON.stringify(plan);
	match(flat, /devContainerAgentHost\.ts:21-29/, 'IDevContainerAgentHostConnectResult cited');
	match(flat, /isDockerAvailable/, 'docker check step present');
});

test('cloud-sandbox plan: e2b+<id> managed authority, entitlement-free posture notes, vault reference', async () => {
	const descriptor = await loadDescriptor('descriptor-cloud-sandbox.json');
	const plan = buildConnectionPlan(descriptor);
	strictEqual(plan.authority, 'e2b+env-e2b-main');
	strictEqual(plan.resolver.managed, true);
	strictEqual(plan.agentHost.mode, 'remote-proxy');
	const flat = JSON.stringify(plan);
	match(flat, /cloudSandboxReadOnlySessionHandler/, 'read-only tier cited');
	match(flat, /entitlement-free/, 'DL-8 posture note present');
	ok(flat.includes('vault:e2b/api-key'), 'apiKeyRef carried as reference');
});

test('workspace-remote plan: <prefix>+<id> authority, in-tree server/tunnel citations', async () => {
	const descriptor = await loadDescriptor('descriptor-workspace-remote.json');
	const plan = buildConnectionPlan(descriptor);
	strictEqual(plan.authority, 'test+env-tunnel-remote');
	strictEqual(plan.resolver.authorityPrefix, 'test');
	const flat = JSON.stringify(plan);
	match(flat, /src\/vs\/server\//, 'in-tree server cited');
	match(flat, /cli\/src\/tunnels\//, 'tunnels CLI cited (C-31)');
	match(flat, /registerRemoteAuthorityResolver/, 'resolver registration cited');
});

test('every plan step carries a non-empty treeRef (the plan is the citation artifact)', async () => {
	for (const name of ['descriptor-ssh.json', 'descriptor-ssh-bridged.json', 'descriptor-container.json', 'descriptor-cloud-sandbox.json', 'descriptor-workspace-remote.json']) {
		const descriptor = await loadDescriptor(name);
		const plan = buildConnectionPlan(descriptor);
		for (const phase of plan.phases) {
			for (const step of phase.steps) {
				ok(step.treeRef.length > 10, `${name} phase ${phase.id} step ${step.id}: treeRef present`);
				ok(step.action.length > 0, `${name} phase ${phase.id} step ${step.id}: action present`);
			}
		}
		ok(plan.agentHost.treeRef.length > 10, `${name}: agentHost treeRef present`);
	}
});

test('plan generation rejects kind/provider mismatch', async () => {
	const descriptor = await loadDescriptor('descriptor-ssh.json');
	throws(() => sshProvider.buildConnectionPlan({ ...descriptor, kind: 'container' } as never), /provider 'ssh' serves kind 'ssh-local'.*kind 'container'/);
	throws(() => containerProvider.buildConnectionPlan(descriptor as never), /provider 'container' serves kind 'container'.*kind 'ssh-local'/);
});

test('validateConnection: ssh rejects unknown keys, bad host/port/auth/remotePath and bridge mistakes', () => {
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', extra: 1 }), /unknown keys rejected/);
	throws(() => validateSshConnection({ authMethod: 'key' }), /host/);
	throws(() => validateSshConnection({ host: 'a b', authMethod: 'key' }), /host/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', port: 0 }), /port/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', port: 70000 }), /port/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'kerberos' }), /authMethod/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', remotePath: 'rel/x' }), /remotePath/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', user: '' }), /user/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', agentHostBridge: { bridgePort: 1, tokenRef: 'x' } }), /tokenRef/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', agentHostBridge: { bridgePort: 99999, tokenRef: 'vault:x' } }), /bridgePort/);
	throws(() => validateSshConnection({ host: 'h', authMethod: 'key', agentHostBridge: { bridgePort: 1, tokenRef: 'vault:x', connectionToken: 'literal' } }), /tokenRef|agentHostBridge/);
	deepStrictEqual(validateSshConnection({ host: 'h.example', authMethod: 'key' }), { host: 'h.example', authMethod: 'key' });
});

test('validateConnection: container rejects missing/invalid shapes', () => {
	throws(() => validateContainerConnection({ workspaceFolder: '/w' }), /workspaceFolder/);
	throws(() => validateContainerConnection({ name: 'n' }), /keys \[workspaceFolder/);
	throws(() => validateContainerConnection({ workspaceFolder: '/w', name: '' }), /name/);
	throws(() => validateContainerConnection({ workspaceFolder: '/w', name: 'n', devcontainerConfig: 'rel' }), /devcontainerConfig/);
	throws(() => validateContainerConnection({ workspaceFolder: '/w', name: 'n', extra: 1 }), /unknown keys rejected/);
});

test('validateConnection: cloud-sandbox rejects non-vault keys and out-of-catalog providers', () => {
	throws(() => validateCloudSandboxConnection({ provider: 'ms-copilot', apiKeyRef: 'vault:k', sandboxTemplate: 't' }), /provider/);
	throws(() => validateCloudSandboxConnection({ provider: 'e2b', apiKeyRef: 'e2b_sk_raw', sandboxTemplate: 't' }), /apiKeyRef.*vault/);
	throws(() => validateCloudSandboxConnection({ provider: 'e2b', apiKeyRef: 'vault:k', sandboxTemplate: '' }), /sandboxTemplate/);
	throws(() => validateCloudSandboxConnection({ provider: 'e2b', apiKeyRef: 'vault:k', sandboxTemplate: 't', region: '' }), /region/);
	throws(() => validateCloudSandboxConnection({ provider: 'e2b', apiKeyRef: 'vault:k' }), /keys \[provider/);
});

test('validateConnection: workspace-remote rejects bad authority prefixes and paths', () => {
	throws(() => validateWorkspaceRemoteConnection({}), /keys \[authorityPrefix/);
	throws(() => validateWorkspaceRemoteConnection({ authorityPrefix: 'Test' }), /authorityPrefix/);
	throws(() => validateWorkspaceRemoteConnection({ authorityPrefix: 'test+test' }), /authorityPrefix/);
	throws(() => validateWorkspaceRemoteConnection({ authorityPrefix: 'test', remotePath: 'srv' }), /remotePath/);
	throws(() => validateWorkspaceRemoteConnection({ authorityPrefix: 'test', viaTunnel: 'yes' }), /viaTunnel/);
	throws(() => validateWorkspaceRemoteConnection({ authorityPrefix: 'test', extra: 1 }), /unknown keys rejected/);
});
