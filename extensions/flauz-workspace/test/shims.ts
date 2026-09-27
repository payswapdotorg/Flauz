/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { setVscodeApi } from '../src/globals.ts';

export interface MockUri {
        readonly scheme: string;
        readonly path: string;
        readonly fsPath: string;
        toString(): string;
}

export interface MockCommandEntry {
        readonly id: string;
        readonly handler: (arg?: unknown) => unknown;
}

export interface MockSourceControl {
        readonly id: string;
        readonly label: string;
        artifactProvider?: unknown;
        dispose(): void;
}

/** Structural mock of vscode.TreeItem (the slice views.ts populates). */
export interface MockTreeItem {
        label: string;
        id?: string;
        description?: string | boolean;
        tooltip?: string;
        iconPath?: { id: string };
        command?: { command: string; title: string; arguments?: unknown[] };
        contextValue?: string;
        accessibilityInformation?: { label: string; role?: string };
        collapsibleState: number;
}

/** Structural mock of vscode.TreeDataProvider<T>. */
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

/** A recorded reveal() call on a created TreeView (TL4-002 reveal navigation). */
export interface MockRevealCall {
        readonly element: unknown;
        readonly options?: { select?: boolean; focus?: boolean; expand?: boolean | number };
}

/** Structural double of the vscode.TreeView handle createTreeView returns. */
export interface MockTreeViewHandle {
        readonly revealCalls: readonly MockRevealCall[];
        reveal(element: unknown, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void>;
        dispose(): void;
}

export interface MockVscode {
        readonly commands: {
                registerCommand(id: string, handler: (arg?: unknown) => unknown): { dispose(): void };
                executeCommand(id: string, arg?: unknown): Promise<unknown>;
                registered(): string[];
        };
        readonly Uri: {
                file(path: string): MockUri;
                parse(value: string): MockUri;
        };
        readonly window: {
                readonly showTextDocumentCalls: MockUri[];
                showTextDocument(document: { uri: MockUri }): Promise<unknown>;
                readonly treeViews: MockTreeViewRegistration[];
                /** createTreeView(viewId, …) handles by view id (reveal-recording doubles). */
                readonly treeViewHandles: Record<string, MockTreeViewHandle>;
                registerTreeDataProvider(viewId: string, provider: MockTreeDataProvider): { dispose(): void };
                createTreeView(viewId: string, options: { treeDataProvider: MockTreeDataProvider }): MockTreeViewHandle;
        };
        readonly workspace: {
                readonly openTextDocumentCalls: MockUri[];
                openTextDocument(uri: MockUri): Promise<{ uri: MockUri }>;
        };
        readonly env: {
                readonly openExternalCalls: MockUri[];
                openExternal(uri: MockUri): Promise<boolean>;
        };
        readonly EventEmitter: new <T>() => {
                readonly event: (listener: (e: T) => void) => { dispose(): void };
                fire(e: T): void;
                dispose(): void;
        };
        readonly scm: {
                readonly created: MockSourceControl[];
                createSourceControl(id: string, label: string): MockSourceControl;
        };
        TreeItem: new (label: string, collapsibleState?: number) => MockTreeItem;
        ThemeIcon: new (id: string) => { id: string };
        TreeItemCollapsibleState: { None: number; Collapsed: number; Expanded: number };
}

class MockEventEmitter<T> {
        private listeners: Array<(e: T) => void> = [];

        get event(): (listener: (e: T) => void) => { dispose(): void } {
                return (listener: (e: T) => void) => {
                        this.listeners.push(listener);
                        return {
                                dispose: () => {
                                        this.listeners = this.listeners.filter(candidate => candidate !== listener);
                                },
                        };
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

const TREE_ITEM_COLLAPSIBLE_STATE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

function makeUri(scheme: string, rest: string, display: string): MockUri {
        const path = rest.replace(/^\/\//, '');
        return { scheme, path, fsPath: path, toString: () => display };
}

export function createMockVscode(): MockVscode {
        const entries = new Map<string, MockCommandEntry>();
        const showTextDocumentCalls: MockUri[] = [];
        const openTextDocumentCalls: MockUri[] = [];
        const openExternalCalls: MockUri[] = [];
        const created: MockSourceControl[] = [];
        const treeViews: MockTreeViewRegistration[] = [];
        const treeViewHandles: Record<string, MockTreeViewHandle> = {};

        const mock: MockVscode = {
                commands: {
                        registerCommand: (id, handler) => {
                                entries.set(id, { id, handler });
                                return { dispose: () => entries.delete(id) };
                        },
                        executeCommand: async (id, arg) => {
                                const entry = entries.get(id);
                                if (entry === undefined) {
                                        throw new Error(`mock vscode: command '${id}' is not registered`);
                                }
                                return entry.handler(arg);
                        },
                        registered: () => [...entries.keys()].sort(),
                },
                Uri: {
                        file: path => makeUri('file', path, `file://${path}`),
                        parse: value => {
                                const colon = value.indexOf(':');
                                if (colon < 0) {
                                        return makeUri('file', value, value);
                                }
                                return makeUri(value.slice(0, colon), value.slice(colon + 1), value);
                        },
                },
                window: {
                        showTextDocumentCalls,
                        showTextDocument: async document => {
                                showTextDocumentCalls.push(document.uri);
                                return document;
                        },
                        treeViews,
                        treeViewHandles,
                        registerTreeDataProvider: (viewId, provider) => {
                                treeViews.push({ viewId, provider });
                                return { dispose: () => undefined };
                        },
                        createTreeView: (viewId, options) => {
                                treeViews.push({ viewId, provider: options.treeDataProvider });
                                const revealCalls: MockRevealCall[] = [];
                                const handle: MockTreeViewHandle = {
                                        revealCalls,
                                        reveal: async (element, options) => {
                                                revealCalls.push({ element, options });
                                        },
                                        dispose: () => undefined,
                                };
                                treeViewHandles[viewId] = handle;
                                return handle;
                        },
                },
                workspace: {
                        openTextDocumentCalls,
                        openTextDocument: async uri => {
                                openTextDocumentCalls.push(uri);
                                return { uri };
                        },
                },
                env: {
                        openExternalCalls,
                        openExternal: async uri => {
                                openExternalCalls.push(uri);
                                return true;
                        },
                },
                EventEmitter: MockEventEmitter,
                TreeItem: class MockTreeItemImpl implements MockTreeItem {
                        label: string;
                        collapsibleState: number;
                        id?: string;
                        description?: string | boolean;
                        tooltip?: string;
                        iconPath?: { id: string };
                        command?: { command: string; title: string; arguments?: unknown[] };
                        contextValue?: string;
                        accessibilityInformation?: { label: string; role?: string };

                        constructor(label: string, collapsibleState = TREE_ITEM_COLLAPSIBLE_STATE.None) {
                                this.label = label;
                                this.collapsibleState = collapsibleState;
                        }
                },
                ThemeIcon: class MockThemeIcon {
                        readonly id: string;

                        constructor(id: string) {
                                this.id = id;
                        }
                },
                TreeItemCollapsibleState: TREE_ITEM_COLLAPSIBLE_STATE,
                scm: {
                        created,
                        createSourceControl: (id, label) => {
                                const control: MockSourceControl = { id, label, dispose: () => undefined };
                                created.push(control);
                                return control;
                        },
                },
        };
        return mock;
}

/** Installs a fresh mock vscode into globals and returns it. */
export function installMockVscode(): MockVscode {
        const mock = createMockVscode();
        setVscodeApi(mock as unknown as typeof vscode);
        return mock;
}
