/**
 * Fidelity-mapped vscode mock for the Flauz Agent Bridge tests.
 *
 * Implements the exact structural slices of the vscode API surface this
 * extension uses, with the shapes transcribed from the vendored
 * vscode.d.ts @ 9bf9ae764da:
 *   - chat.createChatParticipant           (vscode.d.ts:20124)
 *   - lm.registerTool / lm.invokeTool      (:20778 / :20812, incl. the
 *     prepareInvocation -> confirmationMessages HumanApproval gate)
 *   - lm.selectChatModels                  (:20770)
 *   - window.createOutputChannel / createTerminal / showTextDocument
 *   - workspace.workspaceFolders / openTextDocument
 *   - commands.registerCommand, Uri.file / Uri.joinPath
 * The mock RECORDS everything (registrations, invocations, confirmations,
 * terminals, output lines) so tests can assert on the observable behavior.
 */

import type * as vscode from 'vscode';
import type { TerminalLike } from '../../src/tools/terminalTool.ts';

export interface MockParticipantEntry {
	id: string;
	handler: vscode.ChatRequestHandler;
	followupProvider?: vscode.ChatFollowupProvider;
	disposed: boolean;
}

export interface MockToolEntry {
	name: string;
	tool: vscode.LanguageModelTool<unknown>;
	disposed: boolean;
}

export interface MockInvocationRecord {
	name: string;
	input: Record<string, unknown>;
	confirmationAsked: boolean;
}

export interface MockTerminalRecord {
	name: string;
	commands: string[];
	disposed: boolean;
}

export interface MockModelInfo {
	vendor: string;
	id: string;
	family: string;
	version: string;
	name: string;
}

export type ConfirmationPolicy = (toolName: string, confirmation: { title: string; message: string }) => boolean;

export interface MockVscodeState {
	participants: MockParticipantEntry[];
	tools: MockToolEntry[];
	invocations: MockInvocationRecord[];
	terminals: MockTerminalRecord[];
	outputChannels: Array<{ name: string; lines: string[]; shown: boolean }>;
	commands: Array<{ command: string }>;
	openedDocuments: string[];
	shownDocuments: string[];
	models: MockModelInfo[];
	workspaceFolders: Array<{ uri: { fsPath: string; scheme: string }; name: string; index: number }>;
	confirmationPolicy: ConfirmationPolicy;
	terminalOutput: (command: string) => string;
}

export interface MockChatParticipantHandle {
	id: string;
	requestHandler: vscode.ChatRequestHandler;
	followupProvider?: vscode.ChatFollowupProvider;
	dispose(): void;
}

export interface MockVscodeApi {
	chat: { createChatParticipant(id: string, handler: vscode.ChatRequestHandler): MockChatParticipantHandle };
	lm: {
		registerTool: <T>(name: string, tool: vscode.LanguageModelTool<T>) => { dispose(): void };
		invokeTool(name: string, options: { toolInvocationToken: unknown; input: Record<string, unknown> }, token?: vscode.CancellationToken): Promise<unknown>;
		selectChatModels(selector?: vscode.LanguageModelChatSelector): Thenable<vscode.LanguageModelChat[]>;
	};
	window: {
		createOutputChannel(name: string): { appendLine(line: string): void; show(): void; dispose(): void };
		createTerminal(options: { name: string }): TerminalLike;
		showTextDocument(document: unknown): unknown;
	};
	workspace: {
		workspaceFolders: readonly { uri: { fsPath: string; scheme: string }; name: string; index: number }[] | undefined;
		openTextDocument(uri: { fsPath: string }): Promise<unknown>;
	};
	commands: { registerCommand(command: string, handler: (...args: unknown[]) => unknown): { dispose(): void } };
	Uri: {
		file(path: string): { fsPath: string; scheme: string };
		joinPath(base: { fsPath: string; scheme: string }, ...segments: string[]): { fsPath: string; scheme: string };
	};
}

const NEVER_TOKEN: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() { /* noop */ } }),
};

export interface MockVscode {
	vscode: MockVscodeApi;
	state: MockVscodeState;
}

export function createMockVscode(initial?: Partial<MockVscodeState>): MockVscode {
	const state: MockVscodeState = {
		participants: [],
		tools: [],
		invocations: [],
		terminals: [],
		outputChannels: [],
		commands: [],
		openedDocuments: [],
		shownDocuments: [],
		models: initial?.models ?? [],
		workspaceFolders: initial?.workspaceFolders ?? [],
		confirmationPolicy: initial?.confirmationPolicy ?? (() => true),
		terminalOutput: initial?.terminalOutput ?? ((command) => `${command.replace(/^echo /, '')}\n`),
	};

	const api: MockVscodeApi = {
		chat: {
			createChatParticipant(id, handler) {
				const entry: MockParticipantEntry = { id, handler, disposed: false };
				state.participants.push(entry);
				const handle: MockChatParticipantHandle = {
					id,
					requestHandler: handler,
					get followupProvider() {
						return entry.followupProvider;
					},
					set followupProvider(provider) {
						entry.followupProvider = provider;
					},
					dispose() {
						entry.disposed = true;
					},
				};
				return handle;
			},
		},
		lm: {
			registerTool: <T>(name: string, tool: vscode.LanguageModelTool<T>) => {
				const entry: MockToolEntry = { name, tool: tool as vscode.LanguageModelTool<unknown>, disposed: false };
				state.tools.push(entry);
				return {
					dispose() {
						entry.disposed = true;
					},
				};
			},
			async invokeTool(name, options, token) {
				const entry = state.tools.find((candidate) => candidate.name === name && !candidate.disposed);
				if (!entry) {
					throw new Error(`tool not registered: ${name}`);
				}
				const activeToken = token ?? NEVER_TOKEN;
				let confirmationAsked = false;
				if (entry.tool.prepareInvocation) {
					const prepared = await entry.tool.prepareInvocation({ input: options.input as never }, activeToken);
					if (prepared && typeof prepared === 'object' && prepared.confirmationMessages) {
						confirmationAsked = true;
						const confirmation = prepared.confirmationMessages as { title: string; message: string };
						if (!state.confirmationPolicy(name, confirmation)) {
							state.invocations.push({ name, input: options.input, confirmationAsked });
							throw new Error(`tool ${name} invocation rejected by user (confirmation denied)`);
						}
					}
				}
				state.invocations.push({ name, input: options.input, confirmationAsked });
				return entry.tool.invoke({ toolInvocationToken: undefined, input: options.input as never }, activeToken);
			},
			selectChatModels(selector) {
				const matched = state.models.filter((model) => {
					if (!selector || Object.keys(selector).length === 0) {
						return true;
					}
					if (selector.vendor !== undefined && model.vendor !== selector.vendor) {
						return false;
					}
					if (selector.family !== undefined && model.family !== selector.family) {
						return false;
					}
					if (selector.version !== undefined && model.version !== selector.version) {
						return false;
					}
					if (selector.id !== undefined && model.id !== selector.id) {
						return false;
					}
					return true;
				});
				return Promise.resolve(matched as unknown as vscode.LanguageModelChat[]);
			},
		},
		window: {
			createOutputChannel(name) {
				const channel = { name, lines: [] as string[], shown: false };
				state.outputChannels.push(channel);
				return {
					appendLine(line) {
						channel.lines.push(line);
					},
					show() {
						channel.shown = true;
					},
					dispose() {
						/* recorded via state */
					},
				};
			},
			createTerminal(options) {
				const record: MockTerminalRecord = { name: options.name, commands: [], disposed: false };
				state.terminals.push(record);
				const terminal: TerminalLike = {
					name: options.name,
					get shellIntegration() {
						return {
							executeCommand(commandLine: string) {
								record.commands.push(commandLine);
								const output = state.terminalOutput(commandLine);
								return {
									read() {
										return (async function* stream() {
											yield output;
										})();
									},
								};
							},
						};
					},
					show() {
						/* not recorded */
					},
					dispose() {
						record.disposed = true;
					},
				};
				return terminal;
			},
			showTextDocument(document) {
				state.shownDocuments.push(String((document as { uri?: { fsPath?: string } }).uri?.fsPath ?? '<document>'));
				return document;
			},
		},
		workspace: {
			get workspaceFolders() {
				return state.workspaceFolders;
			},
			openTextDocument(uri) {
				state.openedDocuments.push(uri.fsPath);
				return Promise.resolve({ uri });
			},
		},
		commands: {
			registerCommand(command) {
				state.commands.push({ command });
				return { dispose() { /* recorded via state */ } };
			},
		},
		Uri: {
			file(path) {
				return { fsPath: path, scheme: 'file' };
			},
			joinPath(base, ...segments) {
				const joined = [base.fsPath.replace(/\/$/, ''), ...segments].join('/');
				return { fsPath: joined, scheme: base.scheme };
			},
		},
	};

	return { vscode: api, state };
}
