/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * flauz-models extension entry (Wave 3 Lane F).
 *
 * Activation is LAZY: the only activation event is
 * `onLanguageModelChatProvider:flauz-mock`, emitted by the editor when a
 * consumer actually needs a model of the `flauz-mock` vendor (languageModels.ts
 * activationEventsGenerator, src/vs/workbench/contrib/chat/common/languageModels.ts:910-914).
 * This follows PERFORMANCE-PLAN section 2.1 (no startup cost for a vendor nobody has
 * selected). On activation the provider is registered through the STABLE API
 * `vscode.lm.registerLanguageModelChatProvider` (vscode.d.ts:20851) — DL-4:
 * stable APIs only, no proposed API is enabled for this extension.
 */

import * as vscode from 'vscode';

import { createMockProvider, MOCK_VENDOR_ID } from './mockProvider.ts';

export function activate(context: vscode.ExtensionContext): void {
	// Stable API (vscode.d.ts:20851). The vendor MUST also be declared via the
	// `languageModelChatProviders` contribution point in package.json (d.ts
	// note at vscode.d.ts:20846; contribution schema: languageModels.ts:802-915,
	// required fields `vendor` + `displayName`).
	const disposable = vscode.lm.registerLanguageModelChatProvider(MOCK_VENDOR_ID, createMockProvider());
	context.subscriptions.push(disposable);
	// Minimal logging for v0: no output channel, no other side effects.
	console.log(`[flauz-models] registered language model chat provider '${MOCK_VENDOR_ID}' (echo-1)`);
}

export function deactivate(): void {
	// Nothing to clean up: the provider disposable lives in context.subscriptions.
}
