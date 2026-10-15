/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules used by this
 * extension's source and tests. Zero-dependency discipline: no `@types/node`
 * is installed; these declarations are intentionally narrow - only the exact
 * surface the code calls. At runtime the real Node implementations load;
 * these types exist only so `tsc --noEmit` can check the code.
 *
 * The node:test / node:assert declarations are the flauz-lab shim surface
 * (the test lane's imports). The node:fs/promises and node:crypto
 * declarations are the flauz-migration / flauz-workspace shim pattern (see
 * extensions/flauz-migration/shims/node.d.ts): the flauz-lab runtime binding
 * needs no Node built-ins, but THIS console's binding constructs the real
 * harness kits' injected seams - the fs port over node:fs/promises and the
 * 16-hex id rng over node:crypto (src/flauzHarnessPort.ts, the only
 * cross-lane runtime edge) - so their exact narrow surfaces are declared
 * here.
 */

declare module 'node:test' {
        export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
        export function ok(value: unknown, message?: string): asserts value;
        export function strictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
        export function deepStrictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
}

declare module 'node:fs/promises' {
        export function readFile(path: string, encoding: 'utf8'): Promise<string>;
        export function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
        export function appendFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
        export function mkdir(path: string, options: { recursive: boolean }): Promise<void>;
}

declare module 'node:crypto' {
        export function randomBytes(size: number): { toString(encoding: 'hex'): string };
}
