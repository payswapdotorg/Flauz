/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The runtime 'vscode' module the test redirect resolves to (see
 * extensions/flauz-agent/test/harness/vscode-mock-module.ts for the Wave-3
 * original of this pattern). Tests configure/inspect via __configure/__state.
 */

import { createMockVscode, type MockVscode } from './vscodeMock.ts';

const mock: MockVscode = createMockVscode();

export const window = mock.window;
export const workspace = mock.workspace;
export const commands = mock.commands;
export const Uri = mock.Uri;

export function __mock(): MockVscode {
	return mock;
}

export function __configure(patch: { workspaceFolders?: Array<{ uri: { fsPath: string } }> }): void {
	if (patch.workspaceFolders !== undefined) {
		mock.state.workspaceFolders = patch.workspaceFolders;
	}
}

export function __state(): MockVscode['state'] {
	return mock.state;
}

export function __reset(): void {
	mock.state.workspaceFolders = [];
	mock.state.quickPickAnswers = [];
	mock.state.messages = [];
	mock.state.registeredCommands = [];
}
