/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by this extension's source and tests.
 *
 * Zero-dependency discipline (Wave 3 Lane F): no `@types/node` is installed.
 * These declarations are intentionally narrow -- only the exact surface we call.
 * At runtime the real Node implementations are loaded; these types exist only
 * so `tsc --noEmit` can check the code.
 */

declare module 'node:fs' {
	export function existsSync(path: string): boolean;
	export function readFileSync(path: string, encoding: 'utf-8'): string;
	export function readdirSync(path: string): string[];
	export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
}

declare module 'node:os' {
	export function tmpdir(): string;
}

/** TL4-H1 (model-switch runtime drill): per-run temp workspace + cleanup. */
declare module 'node:fs/promises' {
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
	export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
	export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
	export function rename(from: string, to: string): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:path' {
	export function join(...segments: string[]): string;
	export function dirname(path: string): string;
}

declare module 'node:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function test(name: string, options: { only?: boolean; skip?: boolean | string }, fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function strictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
	export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
	export function throws(fn: () => unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): void;
	export function match(value: string, regexp: RegExp, message?: string): void;
	export function fail(message?: string): never;
}

declare module 'node:module' {
	export function registerHooks(hooks: {
		resolve?: (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
	}): void;
}

/** Timer globals (kept alive by the event loop unless unref'd). */
declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;
declare function queueMicrotask(task: () => void): void;

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

/** Minimal WHATWG URL surface used for module-path resolution (value and type). */
declare class URL {
	constructor(input: string, base?: string);
	readonly href: string;
	readonly pathname: string;
}

interface ImportMeta {
	readonly url: string;
}

// ---------------------------------------------------------------------------
// TL2-002 (Worker B) -- additive surface for the real-adapter fabric: the
// streaming HTTP port (fetch/ReadableStream/AbortSignal/TextDecoder), sha256
// hashing, base64 (node:buffer) and the node:http fixture servers the adapter
// tests drive. Every declaration below stays narrow on purpose.
// P2-FIX-101: the three declarations the SRC surface itself needs
// ('node:buffer', AbortSignal, TextDecoder) moved to src/ambient.d.ts so
// they travel with the compiled sources (sibling-extension tsconfigs);
// only the TEST-surface needs stay here.
// ---------------------------------------------------------------------------

declare module 'node:fs' {
	export function writeFileSync(path: string, data: string, encoding?: 'utf-8'): void;
	export function renameSync(fromPath: string, toPath: string): void;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	export function mkdtempSync(prefix: string): string;
	export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
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
		readonly method?: string;
		readonly url?: string;
		readonly headers: Record<string, string | string[] | undefined>;
		on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
		on(event: 'end', listener: () => void): void;
	}
	export interface ServerResponse {
		writeHead(statusCode: number, headers?: Record<string, string>): void;
		write(chunk: string): boolean;
		end(data?: string): void;
	}
	export interface Server {
		listen(port: number, host: string, callback?: () => void): Server;
		once(event: 'error', listener: (error: Error) => void): Server;
		close(callback?: (error?: Error) => void): void;
		closeAllConnections?(): void;
		address(): { readonly port: number };
	}
	export function createServer(listener: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:assert' {
	export function rejects(promiseOrFn: unknown, matcher?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
}

/** AbortController surface used by the bridge + tests. */
declare class AbortController {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
}

/** Stream-aware UTF-8 encoding (global in Node). */
declare class TextEncoder {
	encode(input: string): Uint8Array;
}

/** The fetch subset the node HTTP port uses (Node stdlib global, >= 18). */
declare function fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{
	readonly ok: boolean;
	readonly status: number;
	readonly statusText: string;
	readonly headers: { forEach(callback: (value: string, key: string) => void): void };
	readonly body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}>;

/** The process subset the credential resolver reads; TL4-H1 adds the drill-driver surface. */
declare const process: {
	readonly env: Record<string, string | undefined>;
	argv: string[];
	exit(code?: number): never;
};

/** TL4-H1: the sub-millisecond monotonic clock (model-switch drill timings). */
declare const performance: { now(): number; mark?(name: string): void; };
