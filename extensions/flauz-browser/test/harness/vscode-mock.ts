/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Fidelity-mapped vscode mock for the Flauz Browser Policy tests.
 *
 * Implements the exact structural slices of the vscode API surface this
 * extension uses (shapes transcribed from the vendored vscode.d.ts):
 *   - window.createOutputChannel / showTextDocument / showInputBox /
 *     showWarningMessage / showInformationMessage
 *   - workspace.workspaceFolders / workspace.fs (readFile, writeFile,
 *     createDirectory) / workspace.openTextDocument /
 *     workspace.createFileSystemWatcher(RelativePattern)
 *   - commands.registerCommand
 *   - Uri.joinPath, RelativePattern
 * The mock RECORDS everything (registrations, output lines, messages,
 * watchers, documents) so tests can assert on the observable behavior.
 * Same discipline as the Agent Bridge harness (Wave 3 Lane F).
 */

export interface MockUri {
	readonly fsPath: string;
	readonly scheme: string;
	toString(): string;
}

export interface MockWorkspaceFolder {
	readonly uri: MockUri;
	readonly name: string;
	readonly index: number;
}

export interface MockWatcherRecord {
	readonly base: string;
	readonly pattern: string;
	readonly changeHandlers: Array<() => void>;
	readonly createHandlers: Array<() => void>;
	readonly deleteHandlers: Array<() => void>;
	disposed: boolean;
}

export interface MockCommandRecord {
	readonly command: string;
	readonly handler: (...args: unknown[]) => unknown;
	disposed: boolean;
}

export interface MockOutputChannel {
	readonly name: string;
	lines: string[];
	shown: boolean;
	disposed: boolean;
}

/** Structural mock of vscode.TreeDataProvider (the slice views.ts uses). */
export interface MockTreeDataProvider {
	onDidChangeTreeData?: (listener: (e: unknown) => void) => { dispose(): void };
	getTreeItem(element: unknown): unknown;
	getChildren(element?: unknown): Promise<unknown[]> | unknown[];
}

/** A recorded window.registerTreeDataProvider call. */
export interface MockTreeViewRegistration {
	readonly viewId: string;
	readonly provider: MockTreeDataProvider;
}

export interface MockVscodeState {
	workspaceFolders: MockWorkspaceFolder[] | undefined;
	/** In-memory filesystem: absolute path -> utf8 text. */
	fsFiles: Map<string, string>;
	createdDirectories: string[];
	writtenFiles: Array<{ path: string; text: string }>;
	watchers: MockWatcherRecord[];
	commands: MockCommandRecord[];
	outputChannels: MockOutputChannel[];
	openedDocuments: string[];
	shownDocuments: string[];
	messages: Array<{ level: 'warn' | 'info'; text: string }>;
	inputBoxResponse: string | undefined;
	/** window.registerTreeDataProvider calls, most recent last. */
	treeViews: MockTreeViewRegistration[];
	/** commands.executeCommand calls, most recent last. */
	executedCommands: string[];
}

export interface MockVscodeApi {
	window: {
		createOutputChannel(name: string): { appendLine(line: string): void; show(): void; dispose(): void };
		showTextDocument(document: { uri: MockUri }): Promise<unknown>;
		showInputBox(options: { prompt?: string; placeHolder?: string }): Promise<string | undefined>;
		showWarningMessage(text: string): Promise<string | undefined>;
		showInformationMessage(text: string): Promise<string | undefined>;
		registerTreeDataProvider(viewId: string, provider: MockTreeDataProvider): { dispose(): void };
	};
	workspace: {
		readonly workspaceFolders: MockWorkspaceFolder[] | undefined;
		readonly fs: {
			readFile(uri: MockUri): Promise<Uint8Array>;
			writeFile(uri: MockUri, content: Uint8Array): Promise<void>;
			createDirectory(uri: MockUri): Promise<void>;
		};
		openTextDocument(uri: MockUri): Promise<{ uri: MockUri }>;
		createFileSystemWatcher(pattern: unknown): {
			onDidChange(callback: () => void): { dispose(): void };
			onDidCreate(callback: () => void): { dispose(): void };
			onDidDelete(callback: () => void): { dispose(): void };
			dispose(): void;
		};
	};
	commands: {
		registerCommand(command: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
		executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
	};
	Uri: {
		joinPath(base: MockUri, ...pathSegments: string[]): MockUri;
	};
	RelativePattern: new (base: unknown, pattern: string) => unknown;
	EventEmitter: new <T>() => { event: unknown; fire(e: T): void; dispose(): void };
	TreeItem: new (label: string, collapsibleState?: number) => Record<string, unknown>;
	ThemeIcon: new (id: string) => { id: string };
	TreeItemCollapsibleState: { None: number; Collapsed: number; Expanded: number };
}

function normalizeFsPath(...segments: string[]): string {
	const joined = segments.join('/');
	const parts: string[] = [];
	for (const part of joined.split('/')) {
		if (part === '' || part === '.') {
			continue;
		}
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join('/')}`;
}

function makeUri(fsPath: string, scheme = 'file'): MockUri {
	return {
		fsPath,
		scheme,
		toString: () => `${scheme}://${fsPath}`,
	};
}

export function createMockVscode(initial: Partial<MockVscodeState> = {}): { vscode: MockVscodeApi; state: MockVscodeState } {
	const state: MockVscodeState = {
		workspaceFolders: initial.workspaceFolders ?? [{ uri: makeUri('/ws/acme'), name: 'acme', index: 0 }],
		fsFiles: initial.fsFiles ?? new Map<string, string>(),
		createdDirectories: [],
		writtenFiles: [],
		watchers: [],
		commands: [],
		outputChannels: [],
		openedDocuments: [],
		shownDocuments: [],
		messages: [],
		inputBoxResponse: initial.inputBoxResponse,
		treeViews: [],
		executedCommands: [],
	};

	class RelativePattern {
		readonly base: unknown;
		readonly pattern: string;
		constructor(base: unknown, pattern: string) {
			this.base = base;
			this.pattern = pattern;
		}
	}

	class MockEventEmitter<T> {
		private listeners: Array<(e: T) => void> = [];
		get event() {
			return (listener: (e: T) => void) => ({ dispose: () => { this.listeners = this.listeners.filter(candidate => candidate !== listener); } });
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

	const TREE_ITEM_COLLAPSIBLE_STATE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

	class MockTreeItem {
		label?: string;
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

	const uriOf = (input: MockUri): MockUri => input;

	const vscode: MockVscodeApi = {
		window: {
			createOutputChannel(name: string) {
				const channel: MockOutputChannel = { name, lines: [], shown: false, disposed: false };
				state.outputChannels.push(channel);
				return {
					appendLine: (line: string) => {
						if (!channel.disposed) {
							channel.lines.push(line);
						}
					},
					show: () => {
						channel.shown = true;
					},
					dispose: () => {
						channel.disposed = true;
					},
				};
			},
			async showTextDocument(document: { uri: MockUri }) {
				state.shownDocuments.push(document.uri.fsPath);
				return document;
			},
			async showInputBox(options: { prompt?: string; placeHolder?: string }) {
				state.messages.push({ level: 'info', text: `inputBox: ${options.prompt ?? ''}` });
				return state.inputBoxResponse;
			},
			async showWarningMessage(text: string) {
				state.messages.push({ level: 'warn', text });
				return undefined;
			},
			async showInformationMessage(text: string) {
				state.messages.push({ level: 'info', text });
				return undefined;
			},
			registerTreeDataProvider(viewId: string, provider: MockTreeDataProvider) {
				state.treeViews.push({ viewId, provider });
				return { dispose: () => undefined };
			},
		},
		workspace: {
			get workspaceFolders() {
				return state.workspaceFolders;
			},
			fs: {
				async readFile(uri: MockUri) {
					const text = state.fsFiles.get(uriOf(uri).fsPath);
					if (text === undefined) {
						throw new Error(`FileNotFound: ${uri.fsPath}`);
					}
					return new TextEncoder().encode(text);
				},
				async writeFile(uri: MockUri, content: Uint8Array) {
					const text = new TextDecoder().decode(content);
					state.fsFiles.set(uri.fsPath, text);
					state.writtenFiles.push({ path: uri.fsPath, text });
				},
				async createDirectory(uri: MockUri) {
					state.createdDirectories.push(uri.fsPath);
				},
			},
			async openTextDocument(uri: MockUri) {
				state.openedDocuments.push(uri.fsPath);
				return { uri };
			},
			createFileSystemWatcher(pattern: unknown) {
				const record = pattern as { base: { uri?: MockUri }; pattern: string };
				const watcher: MockWatcherRecord = {
					base: record?.base?.uri?.fsPath ?? String(record?.base ?? ''),
					pattern: record?.pattern ?? String(pattern),
					changeHandlers: [],
					createHandlers: [],
					deleteHandlers: [],
					disposed: false,
				};
				state.watchers.push(watcher);
				const register = (list: Array<() => void>) => (callback: () => void) => {
					list.push(callback);
					return { dispose: () => { const index = list.indexOf(callback); if (index >= 0) { list.splice(index, 1); } } };
				};
				return {
					onDidChange: register(watcher.changeHandlers),
					onDidCreate: register(watcher.createHandlers),
					onDidDelete: register(watcher.deleteHandlers),
					dispose: () => {
						watcher.disposed = true;
					},
				};
			},
		},
		commands: {
			registerCommand(command: string, handler: (...args: unknown[]) => unknown) {
				const record: MockCommandRecord = { command, handler, disposed: false };
				state.commands.push(record);
				return {
					dispose: () => {
						record.disposed = true;
					},
				};
			},
			async executeCommand(command: string, ..._args: unknown[]) {
				state.executedCommands.push(command);
				return undefined;
			},
		},
		Uri: {
			joinPath(base: MockUri, ...pathSegments: string[]) {
				return makeUri(normalizeFsPath(base.fsPath, ...pathSegments), base.scheme);
			},
		},
		RelativePattern,
		EventEmitter: MockEventEmitter as unknown as typeof vscode.EventEmitter,
		TreeItem: MockTreeItem as unknown as typeof vscode.TreeItem,
		ThemeIcon: MockThemeIcon as unknown as typeof vscode.ThemeIcon,
		TreeItemCollapsibleState: TREE_ITEM_COLLAPSIBLE_STATE as unknown as typeof vscode.TreeItemCollapsibleState,
	};

	return { vscode, state };
}
