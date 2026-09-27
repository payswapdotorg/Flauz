/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Extension wiring (v0). Thin: the registry/providers/continuity core is
 * pure TypeScript (zero deps, testable under `node --test`); this file only
 * binds the FileSystemPort to node, resolves the workspace root, and
 * registers the `flauz.env.*` commands. Activation is command- and
 * view-driven only (activation-lint R3: the onStartupFinished cap is already
 * spent by flauz-agent + flauz-workspace).
 *
 * TL4-001: activation also registers the `flauz.environments` view FIRST —
 * the tree renders the live registry state, a retryable error row when the
 * bootstrap failed, and refreshes after every mutating command (see
 * src/views.ts and docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 5).
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
import { registerEnvironmentsView, type EnvironmentsViewApi } from './views.ts';

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

/** Live extension state the view + commands read (single source of truth). */
const state: {
	registry: EnvironmentRegistry | undefined;
	error: string | undefined;
	view: { refresh(): void } | undefined;
	workspaceRoot: string | undefined;
	fs: FileSystemPort;
	clock: () => number;
} = {
	registry: undefined,
	error: undefined,
	view: undefined,
	workspaceRoot: undefined,
	fs: nodeFs,
	clock: () => Date.now(),
};

function currentRegistry(): EnvironmentRegistry {
	if (state.registry === undefined) {
		throw new Error('flauz.env: registry inactive (no workspace folder or failed bootstrap)');
	}
	return state.registry;
}

/** Real recovery: re-attempts the registry bootstrap from scratch. */
async function retryBootstrap(): Promise<void> {
	if (state.workspaceRoot === undefined) {
		state.registry = undefined;
		state.error = undefined;
		return;
	}
	const fresh = new EnvironmentRegistry({ root: state.workspaceRoot, fs: state.fs, clock: state.clock });
	try {
		await fresh.bootstrap();
		state.registry = fresh;
		state.error = undefined;
	} catch (err) {
		state.registry = undefined;
		state.error = err instanceof Error ? err.message : String(err);
	}
}

/** Refreshes the view after a mutation (or a state change). */
function refreshView(): void {
	state.view?.refresh();
}

function describeEnvironment(descriptor: { id: string; label: string; kind: string; enabled: boolean; active: boolean }): string {
	const flags = [
		descriptor.active ? 'active' : 'inactive',
		descriptor.enabled ? 'enabled' : 'disabled',
	];
	return `${descriptor.id} -- ${descriptor.label} (${descriptor.kind}, ${flags.join(', ')})`;
}

/** The vscode slices handed to the view module (kept here for clarity). */
function viewApi(): EnvironmentsViewApi {
	return {
		registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
		registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
		executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
		EventEmitter: vscode.EventEmitter,
		TreeItem: vscode.TreeItem,
		ThemeIcon: vscode.ThemeIcon,
		TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
	};
}

export function activate(context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	state.workspaceRoot = workspaceRoot;

	// TL4-001: the view registers before any early return so the shell surface
	// (welcome/error/retry states) exists even without a workspace folder.
	const view = registerEnvironmentsView(viewApi(), {
		getRegistry: () => state.registry,
		getError: () => state.error,
		retry: () => retryBootstrap().finally(refreshView),
	});
	state.view = view.provider;
	for (const disposable of view.disposables) {
		context.subscriptions.push(disposable);
	}

	if (workspaceRoot === undefined) {
		// command handlers surface this on use; boot stays silent otherwise
		void vscode.window.showWarningMessage('flauz-environments: no workspace folder open -- the environment registry stays inactive.');
		return;
	}

	const registry = new EnvironmentRegistry({ root: workspaceRoot, fs: state.fs, clock: state.clock });

	void (async () => {
		try {
			await registry.bootstrap();
			state.registry = registry;
		} catch (err) {
			state.error = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`flauz-environments: failed to bootstrap .flauz/environments.json: ${err instanceof Error ? err.message : String(err)}`);
		}
		refreshView();
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
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: registered ${descriptor.id} (${descriptor.kind})`);
			return descriptor;
		}],
		['flauz.env.unregister', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.unregister: expected the environment id (string or { id })');
			}
			await currentRegistry().unregister(id);
			refreshView();
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
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: ${id} active -- connection plan ready (${plan.authority}, agent host: ${plan.agentHost.mode})`);
			return plan;
		}],
		['flauz.env.deactivate', async () => {
			await currentRegistry().deactivate();
			refreshView();
		}],
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
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: switch planned ${switchPlan.fromEnvironmentId ?? 'local'} -> ${id} (re-open on ${switchPlan.toAuthority}; see flauz.env.showPlan)`);
			return switchPlan;
		}],
	];

	for (const [id, handler] of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(id, handler));
	}
}

export function deactivate(): void {
	state.registry = undefined;
	state.error = undefined;
	state.view = undefined;
	state.workspaceRoot = undefined;
}
