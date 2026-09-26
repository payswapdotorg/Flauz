/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Redirects runtime imports of the 'vscode' module to the test harness mock
 * (./vscode-mock-module.ts) using node:module registerHooks, so that
 * src/extension.ts — which VALUE-imports 'vscode' — can be exercised under
 * `node --test` without the editor. All other specifiers resolve normally.
 */

import { registerHooks } from 'node:module';

let registered = false;

/**
 * Imports `moduleUrl` with the 'vscode' specifier redirected to the harness
 * mock. The hook is process-global once registered (guarded so repeated calls
 * are idempotent and cheap).
 */
export async function importWithVscodeMock<T>(moduleUrl: URL): Promise<T> {
	if (!registered) {
		registered = true;
		registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier === 'vscode') {
					return { url: new URL('./vscode-mock-module.ts', import.meta.url).href, shortCircuit: true };
				}
				return nextResolve(specifier, context);
			},
		});
	}
	return import(moduleUrl.href);
}
