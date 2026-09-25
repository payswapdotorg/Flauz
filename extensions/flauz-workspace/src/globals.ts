/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/globals.ts
 *
 *  Holds the ambient `vscode` API reference for the modules that need runtime access
 *  (command registration, SCM artifact provider, evidence opening). The core services
 *  never import `vscode` at runtime — only `import type` — so they stay testable under
 *  plain node. src/extension.ts installs the real API on activation; tests install a
 *  mock (test/shims.ts).
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
