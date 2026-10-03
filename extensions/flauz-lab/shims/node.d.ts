/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules used by this
 * extension's tests. Zero-dependency discipline: no `@types/node` is
 * installed; these declarations are intentionally narrow - only the exact
 * surface the tests call. At runtime the real Node implementations load;
 * these types exist only so `tsc --noEmit` can check the code.
 */

declare module 'node:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function strictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
	export function deepStrictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
}
