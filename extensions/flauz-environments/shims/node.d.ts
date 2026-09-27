/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by this extension's source and tests (TL3-003 added child_process, crypto,
 * the process global and the timer globals for the local-real executor;
 * TL3-004 rung 1 added the test-context parameter of node:test, the fetch/
 * AbortSignal globals for the cloud HTTP port, and node:http for the local
 * mock-server drill).
 *
 * Zero-dependency discipline (no `@types/node`): only the exact surface we
 * call. At runtime the real Node implementations are loaded; these types
 * exist only so `tsc --noEmit` checks the code.
 */

declare module 'node:fs/promises' {
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
	export function access(path: string): Promise<void>;
	export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
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
	/** The test-context subset the live suites use (runtime skip lines). */
	export interface TestContext {
		skip(message?: string): void;
		diagnostic(message: string): void;
	}
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function test(name: string, fn: (t: TestContext) => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: () => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: (t: TestContext) => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
	export function rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), matcher?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

declare module 'node:child_process' {
	export interface ShimStream {
		write(chunk: string | Uint8Array): boolean;
		end(callback?: () => void): void;
		on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
		on(event: 'close', listener: () => void): void;
		on(event: 'error', listener: (error: Error) => void): void;
		setEncoding(encoding: string): void;
	}
	export interface ShimChildProcess {
		stdin: ShimStream | null;
		stdout: ShimStream | null;
		stderr: ShimStream | null;
		readonly pid: number | undefined;
		readonly killed: boolean;
		kill(signal?: string): void;
		on(event: 'error', listener: (error: Error) => void): void;
		on(event: 'close', listener: (code: number | null) => void): void;
	}
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

declare module 'node:http' {
	export interface IncomingMessage {
		method?: string;
		url?: string;
		headers: Record<string, string | string[] | undefined>;
		on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
		on(event: 'end', listener: () => void): void;
		setEncoding(encoding: string): void;
	}
	export interface ServerResponse {
		statusCode: number;
		writeHead(statusCode: number, headers?: Record<string, string>): void;
		end(data?: string): void;
	}
	export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
	export interface Server {
		listen(port: number, host: string, callback?: () => void): Server;
		close(callback?: () => void): void;
		address(): { port: number };
	}
	export function createServer(listener: RequestListener): Server;
}

declare const process: {
	execPath: string;
	argv: string[];
	env: Record<string, string | undefined>;
	pid: number;
	readonly versions: { electron?: string; node?: string };
	exit(code?: number): never;
	on(event: string, listener: (...args: unknown[]) => void): void;
	stdout: { write(chunk: string): boolean };
	stdin: { setEncoding(encoding: string): void; on(event: string, listener: (chunk: string) => void): void };
	kill(pid: number, signal?: string | number): void;
};

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

/** Timer globals (kept alive by the event loop unless unref'd). */
declare function setTimeout(handler: (...args: never[]) => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;
declare function setInterval(handler: (...args: never[]) => void, ms: number): { unref(): void };
declare function clearInterval(timer: { unref(): void } | undefined): void;

/** The fetch subset the cloud HTTP port uses (Node stdlib global, >= 18). */
declare function fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }): Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string>; json(): Promise<unknown> }>;

/** AbortSignal.timeout for wall-clock request budgets. */
declare const AbortSignal: { timeout(milliseconds: number): unknown };

/** Import meta surface used for module-path resolution (value and type). */
interface ImportMeta {
	readonly url: string;
	readonly dirname: string;
};

/** The WHATWG URL global subset used for harness path resolution. */
declare const URL: new (url: string, base?: string) => { readonly pathname: string; readonly href: string };
