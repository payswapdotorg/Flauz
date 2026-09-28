/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used by
 * this extension's source and tests.
 *
 * Zero-dependency discipline (Wave 3 Lane F): no `@types/node` is installed.
 * These declarations are intentionally narrow — only the exact surface we call.
 * At runtime the real Node implementations are loaded; these types exist only
 * so `tsc --noEmit` can check the code.
 */

declare module 'node:child_process' {
	export interface ShimStream {
		write(chunk: string | Uint8Array): boolean;
		end(callback?: () => void): void;
		setEncoding(encoding: 'utf-8'): void;
		on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
		on(event: 'close', listener: (code: number | null) => void): void;
		on(event: 'error', listener: (error: Error) => void): void;
	}
	export interface ShimChildProcess {
		stdin: ShimStream;
		stdout: ShimStream;
		stderr: ShimStream;
		killed: boolean;
		/** OS process id; undefined before the process could start (additive, TL2-S1 supervision). */
		pid: number | undefined;
		kill(signal?: string): void;
		on(event: 'error', listener: (error: Error) => void): void;
		on(event: 'close', listener: (code: number | null) => void): void;
		once(event: string, listener: (...args: unknown[]) => void): void;
	}
	export type ChildProcess = ShimChildProcess;
	export function spawn(
		command: string,
		args: readonly string[],
		options?: { stdio?: string | string[]; cwd?: string; env?: Record<string, string | undefined> }
	): ShimChildProcess;
}

declare module 'node:crypto' {
	export interface ShimHash {
		update(data: string | Uint8Array, encoding?: string): ShimHash;
		digest(encoding: 'hex'): string;
	}
	export function createHash(algorithm: 'sha256'): ShimHash;
}

declare module 'node:fs' {
	export function existsSync(path: string): boolean;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
	export function mkdtempSync(prefix: string): string;
	export function readFileSync(path: string, encoding: 'utf-8'): string;
	export function readdirSync(path: string): string[];
	export function writeFileSync(path: string, data: string): void;
	export function appendFileSync(path: string, data: string): void;
	export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
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
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare module 'node:url' {
	export function fileURLToPath(url: string | URL): string;
}

declare module 'node:test' {
	/** Subtest driver (additive, TL2-S1: the matrix suites report per-class). */
	export interface TestContext {
		test(name: string, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
		diagnostic(message: string): void;
	}
	export function test(name: string, fn: (t: TestContext) => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string; timeout?: number }, fn: (t: TestContext) => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | { code?: string; message?: string }, message?: string): Promise<void>;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function doesNotThrow(fn: () => unknown, message?: string): void;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

/** The strict assert surface (node:assert/strict default export + named). */
declare module 'node:assert/strict' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | { code?: string; message?: string }, message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
	export function notEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function doesNotThrow(fn: () => unknown, message?: string): void;
	const strictAssert: {
		ok(value: unknown, message?: string): asserts value;
		equal(actual: unknown, expected: unknown, message?: string): void;
		strictEqual(actual: unknown, expected: unknown, message?: string): void;
		notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
		deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
		throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
		rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean) | { code?: string; message?: string }, message?: string): Promise<void>;
		notEqual(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		doesNotThrow(fn: () => unknown, message?: string): void;
		match(value: string, regexp: RegExp, message?: string): void;
		fail(message?: string): never;
	};
	export default strictAssert;
}

declare module 'node:module' {
	export function registerHooks(hooks: {
		resolve?: (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
	}): void;
}

declare const process: {
	execPath: string;
	argv: string[];
	env: Record<string, string | undefined>;
	exit(code?: number): never;
	on(event: string, listener: (...args: unknown[]) => void): void;
	/** Signal a process by pid (additive, TL2-S1 kill-and-reconnect matrix). */
	kill(pid: number, signal?: string): void;
	/** Streams used by the standalone service scripts spawned as child processes (test/harness). */
	stdout: { write(chunk: string): boolean };
	stderr: { write(chunk: string): boolean };
	stdin: {
		setEncoding(encoding: 'utf-8'): void;
		on(event: 'data', listener: (chunk: string) => void): void;
		on(event: 'end' | 'close', listener: () => void): void;
		resume(): void;
	};
};

/** Timer globals (kept alive by the event loop unless unref'd). */
declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;
declare function queueMicrotask(task: () => void): void;
declare function setImmediate(handler: () => void): void;

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

/** Minimal WHATWG URL surface used for module-path resolution. */
declare class URL {
	constructor(input: string, base?: string);
	readonly href: string;
	readonly pathname: string;
}

interface ImportMeta {
	readonly url: string;
}
