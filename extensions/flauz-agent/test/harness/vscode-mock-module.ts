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
 * extension imports. Tests configure/inspect via __configure/__state —
 * importing this module directly yields the same instance the redirect
 * target uses (same URL).
 */

import { createMockVscode, type MockVscodeState } from './vscode-mock.ts';

const mock = createMockVscode();

export const chat = mock.vscode.chat;
export const lm = mock.vscode.lm;
export const window = mock.vscode.window;
export const workspace = mock.vscode.workspace;
export const commands = mock.vscode.commands;
export const Uri = mock.vscode.Uri;

export function __configure(patch: Partial<MockVscodeState>): void {
	Object.assign(mock.state, patch);
}

export function __state(): MockVscodeState {
	return mock.state;
}

export function __reset(patch?: Partial<MockVscodeState>): void {
	const fresh = createMockVscode(patch);
	mock.state.participants = fresh.state.participants;
	mock.state.tools = fresh.state.tools;
	mock.state.invocations = fresh.state.invocations;
	mock.state.terminals = fresh.state.terminals;
	mock.state.outputChannels = fresh.state.outputChannels;
	mock.state.commands = fresh.state.commands;
	mock.state.openedDocuments = fresh.state.openedDocuments;
	mock.state.shownDocuments = fresh.state.shownDocuments;
	mock.state.models = fresh.state.models;
	mock.state.workspaceFolders = fresh.state.workspaceFolders;
	mock.state.confirmationPolicy = fresh.state.confirmationPolicy;
	mock.state.terminalOutput = fresh.state.terminalOutput;
}
