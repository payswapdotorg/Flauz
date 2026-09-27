/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * flauz-models extension entry (Wave 3 Lane F).
 *
 * Activation is LAZY: the activation events are `onView:flauz.models` and
 * `onLanguageModelChatProvider:flauz-mock`, the latter emitted by the editor
 * when a consumer actually needs a model of the `flauz-mock` vendor
 * (languageModels.ts activationEventsGenerator,
 * src/vs/workbench/contrib/chat/common/languageModels.ts:910-914). This
 * follows PERFORMANCE-PLAN section 2.1 (no startup cost for a vendor nobody
 * has selected). On activation the provider is registered through the STABLE
 * API `vscode.lm.registerLanguageModelChatProvider` (vscode.d.ts:20851) —
 * DL-4: stable APIs only, no proposed API is enabled for this extension.
 *
 * TL4-001: activation also registers the `flauz.models` view (container
 * `flauz`) — it renders the provider registered below plus the design-only
 * vendor plans, each labeled with its honest status (src/views.ts).
 */

import * as vscode from 'vscode';

import { createMockProvider, ECHO_MODEL_INFO, MOCK_VENDOR_ID } from './mockProvider.ts';
import { registerModelsView } from './views.ts';

export function activate(context: vscode.ExtensionContext): void {
	// Stable API (vscode.d.ts:20851). The vendor MUST also be declared via the
	// `languageModelChatProviders` contribution point in package.json (d.ts
	// note at vscode.d.ts:20846; contribution schema: languageModels.ts:802-915,
	// required fields `vendor` + `displayName`).
	const disposable = vscode.lm.registerLanguageModelChatProvider(MOCK_VENDOR_ID, createMockProvider());
	context.subscriptions.push(disposable);
	// TL4-001: the view reads the provider registered above (real runtime
	// state) plus the design-only vendor plans.
	const view = registerModelsView(
		{
			registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
			registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
			executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
			EventEmitter: vscode.EventEmitter,
			TreeItem: vscode.TreeItem,
			ThemeIcon: vscode.ThemeIcon,
			TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
		},
		() => [{ vendor: MOCK_VENDOR_ID, modelId: ECHO_MODEL_INFO.id, modelName: ECHO_MODEL_INFO.name }],
	);
	for (const viewDisposable of view.disposables) {
		context.subscriptions.push(viewDisposable);
	}
	// Minimal logging for v0: no output channel, no other side effects.
	console.log(`[flauz-models] registered language model chat provider '${MOCK_VENDOR_ID}' (echo-1)`);
}

export function deactivate(): void {
	// Nothing to clean up: the provider disposable lives in context.subscriptions.
}
