/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nodeFsSync from 'node:fs';
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

/**
 * Options for the mock vscode surface (TL4-H2 live file events).
 */
export interface MockVscodeOptions {
	/**
	 * Backs every createFileSystemWatcher with a REAL recursive `fs.watch`
	 * (REAL OS events, not synthetic callbacks) -- the runtime-drill posture.
	 * Default false: watchers accept synthetic fire() injections only (the
	 * fixture-rung posture).
	 */
	readonly realFileEvents?: boolean;
}

/** A recorded vscode.RelativePattern (TL4-H2 live file events). */
export interface MockRelativePattern {
	readonly base: string;
	readonly pattern: string;
}

/** The FileSystemWatcher event kinds (mirrors the real API surface). */
export type MockWatcherEventKind = 'change' | 'create' | 'delete';

/** Structural double of vscode.FileSystemWatcher (synthetic + real-fs backends). */
export interface MockFileSystemWatcher {
	readonly base: string;
	readonly pattern: string;
	/** 'real-fs' = backed by a real recursive fs.watch; 'synthetic-only' = fire() injections only. */
	readonly backend: 'real-fs' | 'synthetic-only';
	/** Pattern-matching events dispatched through the API surface (the coalescing evidence). */
	readonly eventCount: number;
	readonly disposed: boolean;
	/** Last raw-watcher error (real-backend diagnostics; undefined when healthy). */
	readonly lastError: string | undefined;
	onDidChange(listener: (uri: MockUri) => void): { dispose(): void };
	onDidCreate(listener: (uri: MockUri) => void): { dispose(): void };
	onDidDelete(listener: (uri: MockUri) => void): { dispose(): void };
	/** Injects a synthetic API-surface event (fixture rung); honors the pattern. */
	fire(kind: MockWatcherEventKind, absolutePath: string): void;
	dispose(): void;
}

/**
 * The glob subset the live-events wiring uses ('**' and '<dir>/**'), matched
 * the way the real workbench scopes watcher events to the pattern. Exported
 * for the runtime drill's zero-dep selftest.
 */
export function matchesWatchPattern(pattern: string, relativePath: string): boolean {
	if (pattern === '**') {
		return true;
	}
	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -'/**'.length);
		return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
	}
	return relativePath === pattern;
}

/**
 * fs.watch reports 'rename' for BOTH creates and deletes; the API-surface
 * translation classifies by target existence at event time (the standard
 * watcher translation). Exported for the runtime drill's zero-dep selftest.
 */
export function classifyRenameEvent(targetExists: boolean): MockWatcherEventKind {
	return targetExists ? 'create' : 'delete';
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
	readonly RelativePattern: new (base: MockUri | string | { uri: MockUri }, pattern: string) => MockRelativePattern;
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
		readonly fileSystemWatchers: MockFileSystemWatcher[];
		createFileSystemWatcher(globPattern: string | MockRelativePattern): MockFileSystemWatcher;
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

export function createMockVscode(options: MockVscodeOptions = {}): MockVscode {
	const entries = new Map<string, MockCommandEntry>();
	const showTextDocumentCalls: MockUri[] = [];
	const openTextDocumentCalls: MockUri[] = [];
	const openExternalCalls: MockUri[] = [];
	const created: MockSourceControl[] = [];
	const treeViews: MockTreeViewRegistration[] = [];
	const treeViewHandles: Record<string, MockTreeViewHandle> = {};
	const fileSystemWatchers: MockFileSystemWatcher[] = [];

	/** Resolves a RelativePattern base (Uri | string | WorkspaceFolder shape) to its path. */
	const baseToPath = (base: MockUri | string | { uri: MockUri }): string => {
		if (typeof base === 'string') {
			return base;
		}
		const asRecord = base as { fsPath?: string; uri?: { fsPath?: string } };
		if (typeof asRecord.fsPath === 'string') {
			return asRecord.fsPath;
		}
		if (asRecord.uri !== undefined && typeof asRecord.uri.fsPath === 'string') {
			return asRecord.uri.fsPath;
		}
		return String(base);
	};

	/**
	 * Builds a FileSystemWatcher double. With options.realFileEvents the
	 * watcher is backed by a REAL recursive fs.watch over `base` -- the OS
	 * events are translated onto the API surface (change stays change; a
	 * 'rename' is classified create/delete by target existence) and scoped
	 * by the pattern. Without it the watcher accepts synthetic fire()
	 * injections only. Pattern misses never dispatch (the real API scopes
	 * events to the glob the same way).
	 */
	const makeWatcher = (base: string, pattern: string): MockFileSystemWatcher => {
		const listeners: Record<MockWatcherEventKind, Array<(uri: MockUri) => void>> = { change: [], create: [], delete: [] };
		let eventCount = 0;
		let disposed = false;
		let lastError: string | undefined;
		let raw: { close(): void; on(event: 'error', listener: (error: Error) => void): void } | undefined;
		const joinBase = (relative: string): string => base === '' ? relative : `${base}/${relative}`;
		const emit = (kind: MockWatcherEventKind, relativePath: string): void => {
			if (disposed || !matchesWatchPattern(pattern, relativePath)) {
				return;
			}
			eventCount += 1;
			const uri = makeUri('file', joinBase(relativePath), `file://${joinBase(relativePath)}`);
			for (const listener of [...listeners[kind]]) {
				listener(uri);
			}
		};
		if (options.realFileEvents === true && base !== '') {
			try {
				raw = nodeFsSync.watch(base, { recursive: true }, (eventType, filename) => {
					if (disposed || filename === null || filename === undefined) {
						return;
					}
					const relativePath = String(filename).split('\\').join('/');
					if (eventType === 'change') {
						emit('change', relativePath);
						return;
					}
					let targetExists = false;
					try {
						nodeFsSync.statSync(joinBase(relativePath));
						targetExists = true;
					} catch {
						targetExists = false;
					}
					emit(classifyRenameEvent(targetExists), relativePath);
				});
				raw.on('error', err => {
					lastError = err instanceof Error ? err.message : String(err);
				});
			} catch (err) {
				// Base missing or recursive watching unsupported here: the watcher
				// stays synthetic-only (the runtime drill reports the honest SKIP
					// on the backend flag; synthetic fire() keeps working).
				lastError = err instanceof Error ? err.message : String(err);
			}
		}
		const subscribe = (kind: MockWatcherEventKind, listener: (uri: MockUri) => void): { dispose(): void } => {
			listeners[kind].push(listener);
			return {
				dispose: () => {
					listeners[kind] = listeners[kind].filter(candidate => candidate !== listener);
				},
			};
		};
		return {
			get base() { return base; },
			get pattern() { return pattern; },
			get backend() { return raw !== undefined ? 'real-fs' : 'synthetic-only'; },
			get eventCount() { return eventCount; },
			get disposed() { return disposed; },
			get lastError() { return lastError; },
			onDidChange: listener => subscribe('change', listener),
			onDidCreate: listener => subscribe('create', listener),
			onDidDelete: listener => subscribe('delete', listener),
			fire: (kind, absolutePath) => {
				const relativePath = base !== '' && absolutePath.startsWith(`${base}/`) ? absolutePath.slice(base.length + 1) : absolutePath;
				emit(kind, relativePath);
			},
			dispose: () => {
				disposed = true;
				raw?.close();
				raw = undefined;
				listeners.change = [];
				listeners.create = [];
				listeners.delete = [];
			},
		};
	};

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
		RelativePattern: class MockRelativePatternImpl {
			readonly base: string;
			readonly pattern: string;

			constructor(base: MockUri | string | { uri: MockUri }, pattern: string) {
				this.base = baseToPath(base);
				this.pattern = pattern;
			}
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
			fileSystemWatchers,
			createFileSystemWatcher: globPattern => {
				const resolved = typeof globPattern === 'string'
					? { base: '', pattern: globPattern }
					: { base: globPattern.base, pattern: globPattern.pattern };
				const watcher = makeWatcher(resolved.base, resolved.pattern);
				fileSystemWatchers.push(watcher);
				return watcher;
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
export function installMockVscode(options: MockVscodeOptions = {}): MockVscode {
	const mock = createMockVscode(options);
	setVscodeApi(mock as unknown as typeof vscode);
	return mock;
}
