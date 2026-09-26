/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used by
 * this extension's source and tests.
 *
 * Zero-dependency discipline (Wave 4 Lane I, mirrors the Wave 3 lanes): no
 * `@types/node` is installed. These declarations are intentionally narrow --
 * only the exact surface we call. At runtime the real Node implementations are
 * loaded; these types exist only so `tsc --noEmit` can check the code.
 */

declare module 'node:test' {
        export function test(name: string, fn: () => void | Promise<void>): void;
        export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
        export function ok(value: unknown, message?: string): asserts value;
        export function equal(actual: unknown, expected: unknown, message?: string): void;
        export function notEqual(actual: unknown, expected: unknown, message?: string): void;
        export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
        export function match(value: string, regexp: RegExp, message?: string): void;
        export function fail(message?: string): never;
}

declare module 'node:assert/strict' {
        export function ok(value: unknown, message?: string): asserts value;
        export function equal(actual: unknown, expected: unknown, message?: string): void;
        export function notEqual(actual: unknown, expected: unknown, message?: string): void;
        export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
        export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
        export function match(value: string, regexp: RegExp, message?: string): void;
        export function fail(message?: string): never;
}

declare module 'node:fs' {
        export function existsSync(path: string): boolean;
        export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
        export function mkdtempSync(prefix: string): string;
        export function readFileSync(path: string, encoding: 'utf-8'): string;
        export function readdirSync(path: string): string[];
        export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
}

declare module 'node:fs/promises' {
        export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
        export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
        export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
}

declare module 'node:path' {
        export function join(...segments: string[]): string;
        export function dirname(path: string): string;
        export function resolve(...segments: string[]): string;
}

declare module 'node:os' {
        export function tmpdir(): string;
}

declare module 'node:crypto' {
        export interface ShimHash {
                update(data: string | Uint8Array, encoding?: string): ShimHash;
                digest(encoding: 'hex'): string;
        }
        export function createHash(algorithm: 'sha256'): ShimHash;
}

declare module 'node:url' {
        export function fileURLToPath(url: string | URL): string;
}

declare module 'node:module' {
        export function registerHooks(hooks: {
                resolve?: (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
        }): void;
}

declare class TextEncoder {
        encode(input?: string): Uint8Array;
}

declare class TextDecoder {
        decode(input?: Uint8Array): string;
}

/** Minimal WHATWG URL surface used for navigation-target and pattern parsing. */
declare class URL {
        constructor(input: string, base?: string);
        static parse(input: string, base?: string): URL | null;
        readonly href: string;
        readonly protocol: string;
        readonly hostname: string;
        readonly host: string;
        readonly pathname: string;
        readonly origin: string;
}

declare const console: {
        log(...args: unknown[]): void;
        error(...args: unknown[]): void;
};

/** Timer globals used by the async test scaffolding. */
declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function queueMicrotask(task: () => void): void;

interface ImportMeta {
        readonly url: string;
}
