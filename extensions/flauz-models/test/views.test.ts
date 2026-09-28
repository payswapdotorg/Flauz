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
	ok(rows[0]?.description.startsWith('echo-1 · registered'));
	ok(rows[0]?.tooltip.includes('REGISTERED'));
	const stub = provider.getTreeItem(rows[1]!);
	strictEqual(stub.contextValue, 'flauzModelStub');
	ok(String(stub.description).includes('design stub · not registered'));
	ok(String(stub.tooltip).includes('DESIGN-ONLY'));
	const registeredItem = provider.getTreeItem(rows[0]!);
	strictEqual(registeredItem.accessibilityInformation?.label, 'flauz-mock: echo-1 · registered · Flauz Mock Echo');
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

test('modelsRows (fabric): capability, routing and tool-policy rows carry honest labels', async () => {
	const api = createApiDouble();
	const provider = new ModelsTreeProvider(
		api,
		() => [{ vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Flauz Mock Echo' }],
		async () => ({
			records: [
				{ providerId: 'flauz-mock', vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Flauz Mock Echo', family: 'flauz-echo', version: '1', wireFamily: 'mock-echo', locality: 'local', enabled: true, contextWindowTokens: 8192, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: false, tokenCounting: 'estimated', streaming: true, credentialConfigured: false, source: 'code-default', updatedAt: 1 },
				{ providerId: 'openai-compat', vendor: 'flauz-openai-compat', modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini', family: 'gpt-4o', version: '1', contextWindowTokens: 128_000, maxOutputTokens: 16_384, wireFamily: 'openai-chat-completions', locality: 'remote', enabled: false, inputModalities: ['text', 'image'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: false, source: 'code-default', updatedAt: 1, cost: { currency: 'USD', inputPerMillion: 0.15, outputPerMillion: 0.6 } },
			],
			routingDefault: "default rule 'zero-network-default' -> flauz-mock (priority 100)",
			toolPolicy: '1 agent entry · default deny · .flauz/models/tool-policy.json',
			inMemory: false,
		}),
	);
	const rows = await provider.getChildren();
	const labels = rows.map(row => row.label);
	strictEqual(labels[0], 'flauz-mock', 'registered provider row first');
	ok(labels.includes('flauz-claude'), 'stub rows still present');
	const capabilityRows = rows.filter(row => row.contextValue === 'flauzModelCapability');
	strictEqual(capabilityRows.length, 2);
	const mockRow = capabilityRows.find(row => row.description.startsWith('echo-1'));
	ok(mockRow !== undefined);
	strictEqual(mockRow.icon, 'check');
	ok(mockRow.tooltip.includes('deterministic mock vendor'), 'the mock stays labeled mock');
	ok(mockRow.tooltip.includes('Durable under .flauz/models'), 'durable posture recorded');
	const openaiRow = capabilityRows.find(row => row.description.startsWith('gpt-4o-mini'));
	ok(openaiRow !== undefined);
	strictEqual(openaiRow.icon, 'circle-slash', 'disabled record shows the disabled icon');
	ok(openaiRow.description.includes('disabled'));
	ok(openaiRow.tooltip.includes('FIXTURE-VERIFIED'), 'real adapters stay labeled FIXTURE-VERIFIED');
	ok(openaiRow.tooltip.includes('future integration gap'), 'live-provider gap stated in the row itself');
	const routingRow = rows.find(row => row.contextValue === 'flauzModelRouting');
	ok(routingRow?.description.includes('zero-network-default'));
	const toolPolicyRow = rows.find(row => row.contextValue === 'flauzModelToolPolicy');
	ok(toolPolicyRow?.tooltip.includes('native lm/MCP tool UX stays authoritative'));
});

test('modelsRows (fabric): degraded loads surface as a row, never a silent state', async () => {
	const api = createApiDouble();
	const provider = new ModelsTreeProvider(
		api,
		() => [],
		async () => ({
			records: [],
			routingDefault: 'unavailable',
			toolPolicy: 'unavailable',
			degraded: 'capability registry: boom',
			inMemory: true,
		}),
	);
	const rows = await provider.getChildren();
	const degradedRow = rows.find(row => row.contextValue === 'flauzModelFabricDegraded');
	ok(degradedRow !== undefined, 'the degraded state is a visible row');
	ok(degradedRow.tooltip.includes('capability registry: boom'), 'the reason is recorded in the row');
	strictEqual(degradedRow.icon, 'warning');
});
