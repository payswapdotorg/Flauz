/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Fidelity-mapped vscode mock for the Flauz Resources tests.
 *
 * Copied from the flauz-browser harness (Wave 4 Lane I) and extended with the
 * slices THIS extension uses: `window.showErrorMessage`,
 * `workspace.fs.rename` (the atomic tmp+rename writes need it to actually
 * move files in the in-memory fs) and `Uri.file`. Everything is RECORDED
 * (registrations, output lines, messages, renames) so tests assert on the
 * observable behavior.
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

export interface MockVscodeState {
	workspaceFolders: MockWorkspaceFolder[] | undefined;
	/** In-memory filesystem: absolute path -> utf8 text. */
	fsFiles: Map<string, string>;
	createdDirectories: string[];
	writtenFiles: Array<{ path: string; text: string }>;
	renamedFiles: Array<{ from: string; to: string }>;
	commands: MockCommandRecord[];
	outputChannels: MockOutputChannel[];
	messages: Array<{ level: 'warn' | 'info' | 'error'; text: string }>;
}

export interface MockVscodeApi {
	window: {
		createOutputChannel(name: string): { appendLine(line: string): void; show(): void; dispose(): void };
		showWarningMessage(text: string): Promise<unknown>;
		showInformationMessage(text: string): Promise<unknown>;
		showErrorMessage(text: string): Promise<unknown>;
	};
	workspace: {
		readonly workspaceFolders: MockWorkspaceFolder[] | undefined;
		readonly fs: {
			readFile(uri: MockUri): Promise<Uint8Array>;
			writeFile(uri: MockUri, content: Uint8Array): Promise<void>;
			createDirectory(uri: MockUri): Promise<void>;
			rename(source: MockUri, target: MockUri, options?: { overwrite?: boolean }): Promise<void>;
		};
	};
	commands: {
		registerCommand(command: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
	};
	Uri: {
		file(fsPath: string): MockUri;
		joinPath(base: MockUri, ...pathSegments: string[]): MockUri;
	};
	RelativePattern: new (base: unknown, pattern: string) => unknown;
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
		renamedFiles: [],
		commands: [],
		outputChannels: [],
		messages: [],
	};

	class RelativePattern {
		readonly base: unknown;
		readonly pattern: string;
		constructor(base: unknown, pattern: string) {
			this.base = base;
			this.pattern = pattern;
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
			async showWarningMessage(text: string) {
				state.messages.push({ level: 'warn', text });
				return undefined;
			},
			async showInformationMessage(text: string) {
				state.messages.push({ level: 'info', text });
				return undefined;
			},
			async showErrorMessage(text: string) {
				state.messages.push({ level: 'error', text });
				return undefined;
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
				async rename(source: MockUri, target: MockUri, options?: { overwrite?: boolean }) {
					const text = state.fsFiles.get(source.fsPath);
					if (text === undefined) {
						throw new Error(`FileNotFound: ${source.fsPath}`);
					}
					if (state.fsFiles.has(target.fsPath) && options?.overwrite !== true) {
						throw new Error(`FileExists: ${target.fsPath}`);
					}
					state.fsFiles.delete(source.fsPath);
					state.fsFiles.set(target.fsPath, text);
					state.renamedFiles.push({ from: source.fsPath, to: target.fsPath });
				},
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
		},
		Uri: {
			file(fsPath: string) {
				return makeUri(fsPath);
			},
			joinPath(base: MockUri, ...pathSegments: string[]) {
				return makeUri(normalizeFsPath(base.fsPath, ...pathSegments), base.scheme);
			},
		},
		RelativePattern,
	};

	return { vscode, state };
}
