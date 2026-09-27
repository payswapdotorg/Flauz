/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/views.ts (the flauz.models view): registered providers are
 * shown as registered, the vendor stub plans are shown as design-only —
 * never the other way around.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
	MODELS_VIEW_ID,
	VIEW_COMMAND_IDS,
	ModelsTreeProvider,
	modelsRows,
	registerModelsView,
	type ModelsViewApi,
} from '../src/views.ts';

const COLLAPSIBLE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Minimal vscode slices the view needs (hand-rolled doubles). */
function createApiDouble() {
	const registeredHandlers = new Map<string, (arg?: unknown) => unknown>();
	const registeredViews: string[] = [];
	const executed: string[] = [];
	const api: ModelsViewApi & {
		readonly registeredHandlers: Map<string, (arg?: unknown) => unknown>;
		readonly registeredViews: string[];
		readonly executedCommands: string[];
	} = {
		registeredHandlers,
		registeredViews,
		executedCommands: executed,
		registerTreeDataProvider: (viewId, provider) => {
			registeredViews.push(viewId);
			ok(typeof provider.getChildren === 'function');
			return { dispose: () => undefined };
		},
		registerCommand: (command, handler) => {
			registeredHandlers.set(command, handler);
			return { dispose: () => registeredHandlers.delete(command) };
		},
		executeCommand: async command => {
			executed.push(command);
			return undefined;
		},
		EventEmitter: class {
			private listeners: Array<(e: unknown) => void> = [];
			get event() {
				return (listener: (e: unknown) => void) => {
					this.listeners.push(listener);
					return { dispose: () => undefined };
				};
			}
			fire(e: unknown): void {
				for (const listener of [...this.listeners]) {
					listener(e);
				}
			}
			dispose(): void {
				this.listeners = [];
			}
		} as unknown as ModelsViewApi['EventEmitter'],
		TreeItem: class {
			label?: string;
			id?: string;
			description?: string | boolean;
			tooltip?: string;
			iconPath?: { id: string };
			command?: { command: string; title: string; arguments?: unknown[] };
			contextValue?: string;
			accessibilityInformation?: { label: string; role?: string };
			collapsibleState: number;
			constructor(label: string, collapsibleState = COLLAPSIBLE.None) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		} as unknown as ModelsViewApi['TreeItem'],
		ThemeIcon: class {
			readonly id: string;
			constructor(id: string) {
				this.id = id;
			}
		} as unknown as ModelsViewApi['ThemeIcon'],
		TreeItemCollapsibleState: COLLAPSIBLE as unknown as ModelsViewApi['TreeItemCollapsibleState'],
	};
	return api;
}

test('modelsRows: the registered flauz-mock provider plus the three honest design stubs', async () => {
	const api = createApiDouble();
	const provider = new ModelsTreeProvider(api, () => [
		{ vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Flauz Mock Echo' },
	]);
	const rows = await provider.getChildren();
	deepStrictEqual(rows.map(row => row.label), ['flauz-mock', 'flauz-claude', 'flauz-codex', 'flauz-qwen']);
	strictEqual(rows[0]?.icon, 'sparkle');
	ok(rows[0]?.description.startsWith('registered · echo-1'));
	ok(rows[0]?.tooltip.includes('REGISTERED'));
	const stub = provider.getTreeItem(rows[1]!);
	strictEqual(stub.contextValue, 'flauzModelStub');
	ok(String(stub.description).startsWith('design stub'));
	ok(String(stub.tooltip).includes('DESIGN-ONLY'));
	const registeredItem = provider.getTreeItem(rows[0]!);
	strictEqual(registeredItem.accessibilityInformation?.label, 'flauz-mock: registered · echo-1 · Flauz Mock Echo');
});

test('modelsRows: zero registered providers -> only the stub rows', async () => {
	const api = createApiDouble();
	const provider = new ModelsTreeProvider(api, () => []);
	deepStrictEqual((await provider.getChildren()).map(row => row.label), ['flauz-claude', 'flauz-codex', 'flauz-qwen']);
});

test('registration: view + both commands register; focus delegates; refresh fires change', async () => {
	const api = createApiDouble();
	let changeEvents = 0;
	const { provider } = registerModelsView(api, () => [
		{ vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Flauz Mock Echo' },
	]);
	provider.onDidChangeTreeData?.(() => {
		changeEvents++;
	});
	deepStrictEqual(api.registeredViews, [MODELS_VIEW_ID]);
	deepStrictEqual([...api.registeredHandlers.keys()].sort(), [...VIEW_COMMAND_IDS].sort());
	await api.registeredHandlers.get('flauz.focusView.models')?.();
	deepStrictEqual(api.executedCommands, ['flauz.models.focus']);
	api.registeredHandlers.get('flauz.models.refreshView')?.();
	strictEqual(changeEvents, 1);
});
