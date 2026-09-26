/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Mock vscode for flauz-workflow tests (mirrors the Wave-3 harness pattern:
 * flauz-workspace test/shims.ts for the globals-based command tests, and the
 * flauz-agent redirect harness for src/extension.ts activation tests).
 */

export interface MockQuickPickItem {
	readonly label: string;
	readonly value: string;
}

export interface MockVscodeState {
	workspaceFolders: Array<{ uri: { fsPath: string } }>;
	/** Scripted quick-pick answers, drained in order (default: undefined = dismissed). */
	quickPickAnswers: Array<string | undefined>;
	/** Warning/error toasts captured. */
	messages: string[];
	registeredCommands: string[];
}

export interface MockVscode {
	readonly commands: {
		registerCommand(id: string, handler: (arg?: unknown) => unknown): { dispose(): void };
		executeCommand(id: string, arg?: unknown): Promise<unknown>;
	};
	readonly window: {
		showQuickPick<T extends MockQuickPickItem>(items: readonly T[], options: { placeHolder: string }): Promise<T | undefined>;
		showWarningMessage(message: string): Promise<string | undefined>;
		showErrorMessage(message: string): Promise<string | undefined>;
	};
	readonly workspace: {
		workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined;
	};
	readonly Uri: {
		file(path: string): { scheme: string; fsPath: string; path: string; toString(): string };
	};
	readonly state: MockVscodeState;
}

export function createMockVscode(): MockVscode {
	const state: MockVscodeState = {
		workspaceFolders: [],
		quickPickAnswers: [],
		messages: [],
		registeredCommands: [],
	};
	const entries = new Map<string, (arg?: unknown) => unknown>();
	const mock: MockVscode = {
		commands: {
			registerCommand: (id, handler) => {
				state.registeredCommands.push(id);
				entries.set(id, handler);
				return { dispose: () => entries.delete(id) };
			},
			executeCommand: async (id, arg) => {
				const handler = entries.get(id);
				if (handler === undefined) {
					throw new Error(`mock vscode: command '${id}' is not registered`);
				}
				return handler(arg);
			},
		},
		window: {
			showQuickPick: async items => {
				const answer = state.quickPickAnswers.length > 0 ? state.quickPickAnswers.shift() : undefined;
				return items.find(item => item.value === answer);
			},
			showWarningMessage: async message => {
				state.messages.push(`warn: ${message}`);
				return undefined;
			},
			showErrorMessage: async message => {
				state.messages.push(`error: ${message}`);
				return undefined;
			},
		},
		workspace: {
			get workspaceFolders(): Array<{ uri: { fsPath: string } }> | undefined {
				return state.workspaceFolders.length > 0 ? state.workspaceFolders : undefined;
			},
		},
		Uri: {
			file: path => ({ scheme: 'file', fsPath: path, path, toString: () => `file://${path}` }),
		},
		state,
	};
	return mock;
}
