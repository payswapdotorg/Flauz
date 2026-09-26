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
}

export interface MockVscodeApi {
        window: {
                createOutputChannel(name: string): { appendLine(line: string): void; show(): void; dispose(): void };
                showTextDocument(document: { uri: MockUri }): Promise<unknown>;
                showInputBox(options: { prompt?: string; placeHolder?: string }): Promise<string | undefined>;
                showWarningMessage(text: string): Promise<string | undefined>;
                showInformationMessage(text: string): Promise<string | undefined>;
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
        };
        Uri: {
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
                watchers: [],
                commands: [],
                outputChannels: [],
                openedDocuments: [],
                shownDocuments: [],
                messages: [],
                inputBoxResponse: initial.inputBoxResponse,
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
                },
                Uri: {
                        joinPath(base: MockUri, ...pathSegments: string[]) {
                                return makeUri(normalizeFsPath(base.fsPath, ...pathSegments), base.scheme);
                        },
                },
                RelativePattern,
        };

        return { vscode, state };
}
