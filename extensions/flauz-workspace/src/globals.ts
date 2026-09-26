/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';

let api: typeof vscode | undefined;

export function setVscodeApi(value: typeof vscode): void {
	api = value;
}

export function vscodeApi(): typeof vscode {
	if (api === undefined) {
		throw new Error('flauz-workspace: vscode API is not set (extension.activate() must run first, or a test shim must be installed)');
	}
	return api;
}
