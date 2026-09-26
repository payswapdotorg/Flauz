/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * 'vscode' module redirect for runtime tests (Node >= 22.15 sync hooks).
 *
 * ESM links a module graph before evaluating it, so a hook registered at the
 * top of a test file is too late for that file's own static imports. The
 * pattern here: register the resolve hook ONCE, then DYNAMICALLY import the
 * module under test — the dynamic import resolves 'vscode' through the hook
 * and lands on ./vscode-mock-module.ts (same instance tests configure
 * directly).
 */

import { registerHooks } from 'node:module';

let registered = false;

export async function importWithVscodeMock<T extends object>(moduleUrl: URL): Promise<T> {
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
	return import(moduleUrl.href) as Promise<T>;
}
