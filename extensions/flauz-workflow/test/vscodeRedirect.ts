/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * 'vscode' module redirect for runtime tests (Node >= 22.15 sync hooks) - the
 * Wave-3 pattern from extensions/flauz-agent/test/harness/vscode-redirect.ts:
 * register the resolve hook once, then DYNAMICALLY import the module under
 * test so 'vscode' resolves through the hook onto vscodeMockModule.ts.
 */

import { registerHooks } from 'node:module';

let registered = false;

export async function importWithVscodeMock<T extends object>(moduleUrl: URL): Promise<T> {
	if (!registered) {
		registered = true;
		registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier === 'vscode') {
					return { url: new URL('./vscodeMockModule.ts', import.meta.url).href, shortCircuit: true };
				}
				return nextResolve(specifier, context);
			},
		});
	}
	return import(moduleUrl.href) as Promise<T>;
}
