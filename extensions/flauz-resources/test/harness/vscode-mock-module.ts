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
 * (Copied from the flauz-browser harness; the state slices match
 * vscode-mock.ts in THIS extension.)
 */

import { createMockVscode, type MockVscodeState } from './vscode-mock.ts';

const mock = createMockVscode();

export const window = mock.vscode.window;
export const workspace = mock.vscode.workspace;
export const commands = mock.vscode.commands;
export const Uri = mock.vscode.Uri;
export const RelativePattern = mock.vscode.RelativePattern;

/** Presence guard on Partial patches (upstream local/code-no-in-operator: `in` only in predicates). */
function carriesWorkspaceFolders(patch: Partial<MockVscodeState>): patch is Partial<MockVscodeState> & { workspaceFolders: MockVscodeState['workspaceFolders'] | undefined } {
	return 'workspaceFolders' in patch;
}

export function __configure(patch: Partial<MockVscodeState>): void {
	if (carriesWorkspaceFolders(patch)) {
		mock.state.workspaceFolders = patch.workspaceFolders;
	}
	if (patch.fsFiles !== undefined) {
		mock.state.fsFiles = patch.fsFiles;
	}
}

export function __state(): MockVscodeState {
	return mock.state;
}

export function __reset(patch: Partial<MockVscodeState> = {}): void {
	// Presence-checked assignment (NOT ??): an explicit undefined in the patch
	// clears the field; an absent key restores the default.
	mock.state.workspaceFolders = carriesWorkspaceFolders(patch)
		? patch.workspaceFolders
		: [{ uri: { fsPath: '/ws/acme', scheme: 'file', toString: () => 'file:///ws/acme' }, name: 'acme', index: 0 }];
	mock.state.fsFiles = patch.fsFiles ?? new Map<string, string>();
	mock.state.createdDirectories = [];
	mock.state.writtenFiles = [];
	mock.state.renamedFiles = [];
	mock.state.commands = [];
	mock.state.outputChannels = [];
	mock.state.messages = [];
}
