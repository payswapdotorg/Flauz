/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/views.ts (the flauz.browser view). The view module takes its
 * vscode slices as parameters, so these run under plain `node --test` against
 * REAL BrowserPolicyEngine instances (workspace file / builtin default /
 * invalid file — the three observable sources).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	BROWSER_VIEW_ID,
	VIEW_COMMAND_IDS,
	BrowserTreeProvider,
	browserRows,
	registerBrowserView,
	type BrowserViewApi,
} from '../src/views.ts';
import { BrowserPolicyEngine } from '../src/policy.ts';

const COLLAPSIBLE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Minimal vscode slices the view needs (hand-rolled doubles). */
function createApiDouble() {
	const registeredHandlers = new Map<string, (arg?: unknown) => unknown>();
	const registeredViews: string[] = [];
	const executed: string[] = [];
	const api: BrowserViewApi & {
		readonly registeredHandlers: Map<string, (arg?: unknown) => unknown>;
		readonly registeredViews: string[];
		readonly executedCommands: string[];
	} = {
		registeredHandlers,
		registeredViews,
		executedCommands: executed,
		registerTreeDataProvider: (viewId, provider) => {
			registeredViews.push(viewId);
			assert.ok(typeof provider.getChildren === 'function');
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
		} as unknown as BrowserViewApi['EventEmitter'],
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
		} as unknown as BrowserViewApi['TreeItem'],
		ThemeIcon: class {
			readonly id: string;
			constructor(id: string) {
				this.id = id;
			}
		} as unknown as BrowserViewApi['ThemeIcon'],
		TreeItemCollapsibleState: COLLAPSIBLE as unknown as BrowserViewApi['TreeItemCollapsibleState'],
	};
	return api;
}

test('provider: no workspace folder -> empty (viewsWelcome path)', async () => {
	const api = createApiDouble();
	const engine = BrowserPolicyEngine.fromPolicyText(undefined);
	const provider = new BrowserTreeProvider(api, { getEngine: () => engine, getFolderOpen: () => false });
	assert.deepEqual(await provider.getChildren(), []);
});

test('rows: workspace policy file -> source + three layers + partitions', () => {
	const engine = BrowserPolicyEngine.fromPolicyText('{"schemaVersion":0,"driver":{"allow":["*.example.com"],"deny":["evil.example.com"]}}');
	const rows = browserRows(engine);
	assert.deepEqual(rows.map(row => row.label), ['Policy Source', 'Driver Layer', 'WebRequest Layer', 'Will-Navigate Layer', 'Partitions']);
	assert.deepEqual(rows.map(row => row.description), [
		'workspace file',
		'allow 1 · deny 1 · fileRoots 0',
		'allow 0 · deny 0',
		'allow 0 · deny 0',
		'persist · shared per workspace',
	]);
	assert.equal(rows[0]?.icon, 'shield');
	assert.equal(rows[0]?.command?.command, 'flauz.browser.setPolicy');
	assert.ok(rows[1]?.tooltip.includes('Allow patterns: *.example.com'));
	assert.ok(rows[4]?.tooltip.includes('per-agent isolation OFF'));
});

test('rows: missing policy file -> honest built-in deny-all default', () => {
	const engine = BrowserPolicyEngine.fromPolicyText(undefined);
	const rows = browserRows(engine);
	assert.equal(rows[0]?.description, 'built-in default (deny-all)');
	assert.ok(rows[0]?.tooltip.includes('fail-closed'));
});

test('rows: invalid policy file -> fail-closed error row wired to the retry', () => {
	const engine = BrowserPolicyEngine.fromPolicyText('{"schemaVersion":0,"nope":1}');
	assert.notEqual(engine.sourceError, undefined);
	const rows = browserRows(engine);
	assert.equal(rows[0]?.description, 'invalid — deny-all in effect');
	assert.equal(rows[0]?.icon, 'error');
	assert.equal(rows[0]?.command?.command, 'flauz.browser.refreshView');
	// TL4-002 state-template tokens: Retry title + shared flauzError context.
	assert.equal(rows[0]?.command?.title, 'Retry');
	assert.equal(rows[0]?.contextValue, 'flauzError');
	assert.ok(rows[0]?.tooltip.includes('deny-all'));
});

test('registration: view + both commands register; focus delegates; refresh runs reload then fires change', async () => {
	const api = createApiDouble();
	let changeEvents = 0;
	let reloads = 0;
	const engine = BrowserPolicyEngine.fromPolicyText(undefined);
	const { provider } = registerBrowserView(api, {
		getEngine: () => engine,
		getFolderOpen: () => true,
		reload: async () => {
			reloads++;
		},
	});
	provider.onDidChangeTreeData?.(() => {
		changeEvents++;
	});
	assert.deepEqual(api.registeredViews, [BROWSER_VIEW_ID]);
	assert.deepEqual([...api.registeredHandlers.keys()].sort(), [...VIEW_COMMAND_IDS].sort());
	await api.registeredHandlers.get('flauz.focusView.browser')?.();
	assert.deepEqual(api.executedCommands, ['flauz.browser.focus']);
	api.registeredHandlers.get('flauz.browser.refreshView')?.();
	// the refresh handler awaits the reload promise, then fires the change event
	// (microtask chain — a few bare awaits let it settle deterministically)
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(reloads, 1);
	assert.equal(changeEvents, 1);
});
