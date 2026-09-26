/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by this extension's source and tests (Wave 3 Lane F pattern - see
 * extensions/flauz-agent/shims/node.d.ts). Zero-dependency discipline: no
 * `@types/node`; only the exact surface we call. The TextEncoder declaration
 * also serves the flauz-workspace src files compiled inside this project's
 * import graph.
 */

declare module 'node:fs/promises' {
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function appendFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:fs' {
	export function mkdtempSync(prefix: string): string;
	export function readFileSync(path: string, encoding: 'utf-8'): string;
	export function readFileSync(path: string, options: { encoding: 'utf-8' }): string;
	export function readdirSync(path: string): string[];
}

declare module 'node:child_process' {
	export function execFile(
		file: string,
		args: readonly string[],
		options: { cwd: string; encoding: 'utf-8'; timeout: number },
		callback: (error: (Error & { code?: number | string }) | null, stdout: string | undefined, stderr: string | undefined) => void,
	): unknown;
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare module 'node:path' {
	export function join(...segments: string[]): string;
}

declare module 'node:test' {
	export function test(name: string, fn: (t: unknown) => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean) | { name?: string; message?: string }, message?: string): void;
	export function rejects(promise: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | { name?: string; message?: string }, message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
}

declare module 'node:assert/strict' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean) | { name?: string; message?: string }, message?: string): void;
	export function rejects(promise: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | { name?: string; message?: string }, message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
}

declare module 'node:module' {
	export function registerHooks(hooks: {
		resolve?: (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
	}): void;
}

declare const process: {
	platform: string;
};

declare class TextEncoder {
	encode(input?: string): Uint8Array;
}

declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;

/** Minimal WHATWG URL surface used for module-path resolution. */
declare class URL {
	constructor(input: string, base?: string | URL);
	readonly href: string;
	readonly pathname: string;
}

interface ImportMeta {
	readonly url: string;
}
