/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Extension wiring (v0). Thin: the registry/providers/continuity core is
 * pure TypeScript (zero deps, testable under `node --test`); this file only
 * binds the FileSystemPort to node, resolves the workspace root, and
 * registers the `flauz.env.*` commands. Activation is command-driven only
 * (activation-lint R3: the onStartupFinished cap is already spent by
 * flauz-agent + flauz-workspace).
 *
 * v0 boundary: NO resolver registration and NO live connection happen here
 * (see INTEGRATION-GAP.md -- the `resolvers` proposal grant via
 * product.flauz.json is the Wave-4-next wiring step; DL-19 is the sole
 * proposal-grant mechanism).
 */
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import type { FileSystemPort } from './api.ts';
import { EnvironmentRegistry } from './registry.ts';
import { planSwitch } from './continuity.ts';

const nodeFs: FileSystemPort = {
	readFileUtf8: async path => {
		try {
			return await fs.readFile(path, { encoding: 'utf-8' });
		} catch (err) {
			if ((err as { code?: string }).code === 'ENOENT') {
				return undefined;
			}
			throw err;
		}
	},
	writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
	rename: (fromPath, toPath) => fs.rename(fromPath, toPath),
	mkdir: path => fs.mkdir(path, { recursive: true }),
};

let registry: EnvironmentRegistry | undefined;

function currentRegistry(): EnvironmentRegistry {
	if (registry === undefined) {
		throw new Error('flauz.env: registry inactive (no workspace folder or failed bootstrap)');
	}
	return registry;
}

function describeEnvironment(descriptor: { id: string; label: string; kind: string; enabled: boolean; active: boolean }): string {
	const flags = [
		descriptor.active ? 'active' : 'inactive',
		descriptor.enabled ? 'enabled' : 'disabled',
	];
	return `${descriptor.id} -- ${descriptor.label} (${descriptor.kind}, ${flags.join(', ')})`;
}

export function activate(context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot === undefined) {
		// command handlers surface this on use; boot stays silent otherwise
		void vscode.window.showWarningMessage('flauz-environments: no workspace folder open -- the environment registry stays inactive.');
		return;
	}

	const clock = (): number => Date.now();
	registry = new EnvironmentRegistry({ root: workspaceRoot, fs: nodeFs, clock });

	void (async () => {
		try {
			await registry!.bootstrap();
		} catch (err) {
			registry = undefined;
			void vscode.window.showErrorMessage(`flauz-environments: failed to bootstrap .flauz/environments.json: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();

	const commands: [string, (arg?: unknown) => unknown][] = [
		['flauz.env.list', () => {
			const list = currentRegistry().list();
			const activeId = currentRegistry().activeId();
			return list.map(descriptor => describeEnvironment({ id: descriptor.id, label: descriptor.label, kind: descriptor.kind, enabled: descriptor.enabled, active: descriptor.id === activeId }));
		}],
		['flauz.env.register', async (arg?: unknown) => {
			// arg: EnvironmentRegistration (id/kind/label/connection/trust/capabilities[/enabled])
			const reg = currentRegistry();
			const descriptor = await reg.register(arg as never);
			void vscode.window.showInformationMessage(`flauz-environments: registered ${descriptor.id} (${descriptor.kind})`);
			return descriptor;
		}],
		['flauz.env.unregister', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.unregister: expected the environment id (string or { id })');
			}
			await currentRegistry().unregister(id);
			void vscode.window.showInformationMessage(`flauz-environments: unregistered ${id}`);
		}],
		['flauz.env.activate', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.activate: expected the environment id (string or { id })');
			}
			const reg = currentRegistry();
			const plan = await reg.activate(id);
			const descriptor = reg.get(id)!;
			void vscode.window.showInformationMessage(`flauz-environments: ${id} active -- connection plan ready (${plan.authority}, agent host: ${plan.agentHost.mode})`);
			return plan;
		}],
		['flauz.env.deactivate', () => currentRegistry().deactivate()],
		['flauz.env.showPlan', (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.showPlan: expected the environment id (string or { id })');
			}
			return currentRegistry().planFor(id);
		}],
		['flauz.env.switch', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.switch: expected the target environment id (string or { id })');
			}
			const reg = currentRegistry();
			const target = reg.get(id);
			if (target === undefined) {
				throw new Error(`flauz.env.switch: unknown environment '${id}'`);
			}
			const active = reg.active();
			const plan = await reg.activate(id);
			const switchPlan = planSwitch(active ?? null, target);
			void vscode.window.showInformationMessage(`flauz-environments: switch planned ${switchPlan.fromEnvironmentId ?? 'local'} -> ${id} (re-open on ${switchPlan.toAuthority}; see flauz.env.showPlan)`);
			return switchPlan;
		}],
	];

	for (const [id, handler] of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(id, handler));
	}
}

export function deactivate(): void {
	registry = undefined;
}
