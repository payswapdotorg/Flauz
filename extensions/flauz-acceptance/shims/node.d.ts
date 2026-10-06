/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by this extension's source and tests (the flauz-memory shim pattern; see
 * extensions/flauz-agent/shims/node.d.ts and the flauz-incidents copy).
 * Zero-dependency discipline: no `@types/node`; only the exact surface we
 * call. This wave's extension consumes ONLY node:fs/promises (the wiring
 * row's AcceptanceFsPort) plus the test-lane modules -- the node-free core
 * reaches every effect exclusively through the injected ports.
 *
 * The mocha tdd suite globals (suite/test/setup) are declared here as well so
 * the extension's own tsconfig (types: []) typechecks the suite standalone —
 * the isolated-runner recipe (extensions/flauz-isolation/README.md "The
 * suite") uses the real mocha globals at run time; these declarations mirror
 * that surface.
 */

declare module 'node:fs/promises' {
        export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
        export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
        export function readFile(path: string): Promise<Buffer>;
        export function writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string; flag?: string } | string): Promise<void>;
        export function appendFile(path: string, data: string, options?: { encoding?: string; flag?: string } | string): Promise<void>;
        export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
        export function readdir(path: string): Promise<string[]>;
        export function readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>>;
        export function readlink(path: string): Promise<string>;
        export function mkdtemp(prefix: string): Promise<string>;
        export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
        export function rename(fromPath: string, toPath: string): Promise<void>;
        export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

declare module 'node:fs' {
        export function existsSync(path: string): boolean;
        export function readFileSync(path: string, encoding: 'utf-8'): string;
}

declare module 'node:os' {
        export function tmpdir(): string;
}

declare module 'node:path' {
        export function join(...segments: string[]): string;
        export function dirname(p: string): string;
        export function basename(p: string): string;
        export function resolve(...segments: string[]): string;
        export function relative(from: string, to: string): string;
        export const sep: string;
}

declare module 'node:crypto' {
        export function createHash(algorithm: 'sha256'): { update(data: string | Uint8Array, encoding?: string): { digest(encoding: 'hex'): string; digest(): Buffer } };
        export function randomBytes(size: number): Buffer;
}

declare module 'node:url' {
        export function fileURLToPath(url: string | URL): string;
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
        export function fail(message?: string): never;
}

declare const process: {
        platform: NodeJS.Platform;
        arch: string;
        readonly versions: { node: string };
        readonly env: Record<string, string | undefined>;
};

declare namespace NodeJS {
        type Platform = string;
}

declare class TextEncoder {
        encode(input?: string): Uint8Array;
}

declare class Buffer extends Uint8Array {
        static from(input: string, encoding: string): Buffer;
        static from(input: Uint8Array): Buffer;
        static byteLength(input: string, encoding?: string): number;
        static concat(list: readonly Uint8Array[]): Buffer;
        toString(encoding?: string): string;
}

declare function structuredClone<T>(value: T): T;

/** Minimal WHATWG URL surface used for module-path resolution. */
declare class URL {
        constructor(input: string, base?: string | URL);
        static parse(input: string, base?: string): URL | null;
        readonly href: string;
        readonly protocol: string;
        readonly hostname: string;
        readonly host: string;
        readonly pathname: string;
        readonly origin: string;
}

interface ImportMeta {
        readonly url: string;
}

// ---------------------------------------------------------------------------
// The mocha tdd suite surface (the isolated-runner harness; see the header).
// ---------------------------------------------------------------------------

declare function suite(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function setup(fn: () => void | Promise<void>): void;
declare function suiteSetup(fn: () => void | Promise<void>): void;
declare function suiteTeardown(fn: () => void | Promise<void>): void;
declare function teardown(fn: () => void | Promise<void>): void;
