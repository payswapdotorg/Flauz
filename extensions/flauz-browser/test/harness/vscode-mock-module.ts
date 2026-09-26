/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The runtime 'vscode' module the test redirect resolves to.
 *
 * `importWithVscodeMock` (vscode-redirect.ts) redirects the specifier
 * 'vscode' to THIS module for dynamic imports of src/extension.ts. It builds
 * one mock instance and re-exports its API under the exact names the
 * extension imports. Tests configure/inspect via __configure/__state.
 */

import { createMockVscode, type MockVscodeState } from './vscode-mock.ts';

const mock = createMockVscode();

export const window = mock.vscode.window;
export const workspace = mock.vscode.workspace;
export const commands = mock.vscode.commands;
export const Uri = mock.vscode.Uri;
export const RelativePattern = mock.vscode.RelativePattern;

export function __configure(patch: Partial<MockVscodeState>): void {
	if ('workspaceFolders' in patch) {
		mock.state.workspaceFolders = patch.workspaceFolders;
	}
	if (patch.fsFiles !== undefined) {
		mock.state.fsFiles = patch.fsFiles;
	}
	if (patch.inputBoxResponse !== undefined) {
		mock.state.inputBoxResponse = patch.inputBoxResponse;
	}
}

export function __state(): MockVscodeState {
	return mock.state;
}

export function __reset(patch: Partial<MockVscodeState> = {}): void {
	// Presence-checked assignment (NOT ??): an explicit undefined in the patch
	// clears the field; an absent key restores the default.
	mock.state.workspaceFolders = 'workspaceFolders' in patch
		? patch.workspaceFolders
		: [{ uri: { fsPath: '/ws/acme', scheme: 'file', toString: () => 'file:///ws/acme' }, name: 'acme', index: 0 }];
	mock.state.fsFiles = patch.fsFiles ?? new Map<string, string>();
	mock.state.createdDirectories = [];
	mock.state.writtenFiles = [];
	mock.state.watchers = [];
	mock.state.commands = [];
	mock.state.outputChannels = [];
	mock.state.openedDocuments = [];
	mock.state.shownDocuments = [];
	mock.state.messages = [];
	mock.state.inputBoxResponse = patch.inputBoxResponse;
}
