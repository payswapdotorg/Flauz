/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules used by this
 * extension's tests. Zero-dependency discipline (no `@types/node`): only the
 * exact surface the test helpers call. At runtime the real Node
 * implementations are loaded; these types exist only so `tsc --noEmit`
 * checks the code.
 */

declare module 'node:fs/promises' {
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ isFile(): boolean; isDirectory(): boolean; name: string }>>;
	export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<Array<string>>;
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare module 'node:path' {
	export function join(...segments: string[]): string;
	export function resolve(...segments: string[]): string;
}

declare module 'node:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): void;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

/** Import meta surface used for module-path resolution (value and type). */
interface ImportMeta {
	readonly url: string;
	readonly dirname: string;
};
