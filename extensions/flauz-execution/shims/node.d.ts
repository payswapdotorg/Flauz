/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals
 * used by this extension's source and tests (the Wave 3 Lane F pattern -
 * see extensions/flauz-agent/shims/node.d.ts; the node:test / node:assert
 * surface follows extensions/flauz-resources/shims/node.d.ts). Zero-
 * dependency discipline: no `@types/node`; only the exact surface we call.
 * The fs/promises / path / crypto declarations also serve the flauz-browser
 * src files compiled inside this project's import graph.
 */

declare module 'node:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: () => void | Promise<void>): void;
}

/** Constructor-of-Error shape accepted as an assert matcher. */
declare type ErrorConstructorLike = abstract new (...args: never[]) => Error;

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean) | ErrorConstructorLike, message?: string): void;
	export function doesNotThrow(fn: () => unknown, message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | ErrorConstructorLike, message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

declare module 'node:assert/strict' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean) | ErrorConstructorLike, message?: string): void;
	export function doesNotThrow(fn: () => unknown, message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | ErrorConstructorLike, message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

declare module 'node:fs' {
	export function existsSync(path: string): boolean;
	export function mkdtempSync(prefix: string): string;
	export function readFileSync(path: string, encoding: 'utf-8'): string;
	export function readFileSync(path: string, options: { encoding: 'utf-8' }): string;
	export function writeFileSync(path: string, data: string): void;
	export function appendFileSync(path: string, data: string, options?: { encoding?: string; flag?: string }): void;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
	export function readdirSync(path: string): string[];
}

declare module 'node:fs/promises' {
	export function appendFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function appendFile(path: string, data: string, encoding: 'utf-8'): Promise<void>;
	export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function writeFile(path: string, data: Uint8Array): Promise<void>;
	export function copyFile(src: string, dest: string): Promise<void>;
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:crypto' {
	export interface ShimHash {
		update(data: string | Uint8Array, encoding?: string): ShimHash;
		digest(encoding: 'hex'): string;
	}
	export function createHash(algorithm: 'sha256'): ShimHash;
	export function randomBytes(size: number): { toString(encoding: 'hex'): string };
}

declare module 'node:path' {
	export function join(...segments: string[]): string;
	export function dirname(path: string): string;
	export function basename(path: string): string;
	export function resolve(...segments: string[]): string;
	export function relative(from: string, to: string): string;
	export const sep: string;
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare class TextEncoder {
	constructor();
	encode(input?: string): Uint8Array;
}

declare class TextDecoder {
	decode(input?: Uint8Array): string;
}

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

declare function setTimeout(handler: () => void, ms: number, ...args: unknown[]): { unref(): void };
declare function clearTimeout(handle: unknown): void;
declare function queueMicrotask(task: () => void): void;

/** Web-platform globals Node provides (lib ES2022 has no DOM). */
declare function btoa(input: string): string;
declare function atob(input: string): string;
declare function structuredClone<T>(value: T): T;

/** Minimal WHATWG URL surface (used by the flauz-browser CDP layer). */
declare class URL {
	constructor(input: string, base?: string);
	static parse(input: string, base?: string): URL | null;
	readonly href: string;
	readonly protocol: string;
	readonly hostname: string;
	readonly pathname: string;
}

/** Import meta surface used for module-path resolution (value and type). */
interface ImportMeta {
	readonly url: string;
	readonly dirname: string;
}
