/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Runtime stand-in for the real 'vscode' module. vscode-redirect.ts rewrites
 * every runtime import of the specifier 'vscode' to THIS file
 * (node:module registerHooks), so src/extension.ts's `import * as vscode
 * from 'vscode'` resolves to the mock when tests run under `node --test`.
 *
 * This must stay a VALUE module: it must not contain any runtime 'vscode'
 * import (type-only imports are fine — Node's type stripping erases them
 * before resolution). Tests import this file directly to reach the same
 * process-wide singletons the redirect serves (same URL => same module
 * registry entry => same instance).
 */

import { createMockLm, MockCancellationTokenSource } from './vscode-mock.ts';

/** The process-wide mock `vscode.lm` instance used by the redirect. */
export const lm = createMockLm();

/** A recorded commands.registerCommand call. */
export interface MockCommandRecord {
	readonly command: string;
	readonly handler: (arg?: unknown) => unknown;
	disposed: boolean;
}

/** A recorded window.registerTreeDataProvider call. */
export interface MockTreeViewRegistration {
	readonly viewId: string;
	readonly provider: { getChildren(element?: unknown): unknown; getTreeItem(element: unknown): unknown };
}

const commandRecords: MockCommandRecord[] = [];
const treeViews: MockTreeViewRegistration[] = [];
const executedCommands: string[] = [];

function registerCommand(command: string, handler: (arg?: unknown) => unknown): { dispose(): void } {
	const record: MockCommandRecord = { command, handler, disposed: false };
	commandRecords.push(record);
	return {
		dispose() {
			record.disposed = true;
		},
	};
}

/** The process-wide recorded state for the window/commands slices. */
export const __viewState = {
	commands: commandRecords,
	treeViews,
	executedCommands,
};

const TREE_ITEM_COLLAPSIBLE_STATE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Structural mock of vscode.TreeItem (the slice views.ts populates). */
class MockTreeItemImpl {
	label: string;
	id?: string;
	description?: string | boolean;
	tooltip?: string;
	iconPath?: { id: string };
	command?: { command: string; title: string; arguments?: unknown[] };
	contextValue?: string;
	accessibilityInformation?: { label: string; role?: string };
	collapsibleState: number;

	constructor(label: string, collapsibleState = TREE_ITEM_COLLAPSIBLE_STATE.None) {
		this.label = label;
		this.collapsibleState = collapsibleState;
	}
}

class MockThemeIcon {
	readonly id: string;

	constructor(id: string) {
		this.id = id;
	}
}

class MockEventEmitter<T> {
	private listeners: Array<(e: T) => void> = [];

	get event() {
		return (listener: (e: T) => void) => {
			this.listeners.push(listener);
			return { dispose: () => undefined };
		};
	}

	fire(e: T): void {
		for (const listener of [...this.listeners]) {
			listener(e);
		}
	}

	dispose(): void {
		this.listeners = [];
	}
}

/** The window/commands value surface src/extension.ts uses (view wiring). */
export const window = {
	registerTreeDataProvider(viewId: string, provider: MockTreeViewRegistration['provider']): { dispose(): void } {
		treeViews.push({ viewId, provider });
		return { dispose: () => undefined };
	},
};

export const commands = {
	registerCommand,
	async executeCommand(command: string, ..._args: unknown[]): Promise<unknown> {
		executedCommands.push(command);
		return undefined;
	},
};

export const EventEmitter = MockEventEmitter;
export const TreeItem = MockTreeItemImpl;
export const ThemeIcon = MockThemeIcon;
export const TreeItemCollapsibleState = TREE_ITEM_COLLAPSIBLE_STATE;

/** Test-harness helper: reset the recorded view state. */
export function __resetViewState(): void {
	commandRecords.length = 0;
	treeViews.length = 0;
	executedCommands.length = 0;
}

/** Fidelity shim for vscode.CancellationTokenSource (not used by flauz-models v0). */
export { MockCancellationTokenSource as CancellationTokenSource };
