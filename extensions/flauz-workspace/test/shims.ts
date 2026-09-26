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
