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
	export function copyFile(src: string, dest: string): Promise<void>;
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function appendFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:fs' {
	export function existsSync(path: string): boolean;
	export function mkdtempSync(prefix: string): string;
	export function readFileSync(path: string, encoding: 'utf-8'): string;
	export function readFileSync(path: string, options: { encoding: 'utf-8' }): string;
	export function readdirSync(path: string): string[];
}

declare module 'node:child_process' {
	// The seamClient spawn surface (TL2-006 M4 stdio loopback; declarations
	// ported from extensions/flauz-agent/shims/node.d.ts - the owner of that
	// client's typing).
	export interface ShimStream {
		write(data: string): boolean;
		end(callback?: () => void): void;
		on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
		// P2-FIX-102: after setEncoding('utf-8') the runtime delivers STRING
		// chunks; the battery/drill listeners declare (chunk: string). The shim
		// declares what the runtime actually provides (structural overload kept
		// for the pre-setEncoding callers).
		on(event: 'data', listener: (chunk: string) => void): void;
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
	}
	export function spawn(
		command: string,
		args: readonly string[],
		options?: { stdio?: string | string[]; cwd?: string; env?: Record<string, string | undefined> }
	): ShimChildProcess;
	export function execFile(
		file: string,
		args: readonly string[],
		options: { cwd: string; encoding: 'utf-8'; timeout: number },
		callback: (error: (Error & { code?: number | string }) | null, stdout: string | undefined, stderr: string | undefined) => void,
	): unknown;
}

declare module 'node:os' {
	export function tmpdir(): string;
	export function homedir(): string;
}

declare module 'node:crypto' {
	export interface KeyObject {
		export(options: { format: 'pem'; type: 'spki' | 'pkcs8' }): string;
	}
	export function createPrivateKey(key: string | { key: Uint8Array; format: 'der'; type: 'pkcs8' }): KeyObject;
	export function createPublicKey(key: string | KeyObject): KeyObject;
	export function generateKeyPairSync(type: 'ed25519'): { privateKey: KeyObject; publicKey: KeyObject };
	export function sign(algorithm: string | null, data: Uint8Array, key: KeyObject): Buffer;
	export function verify(algorithm: string | null, data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean;
	export interface Hmac {
		update(data: string | Uint8Array, encoding?: string): Hmac;
		digest(encoding: 'hex'): string;
	}
	export function createHmac(algorithm: 'sha256', key: Uint8Array): Hmac;
	export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
	export function createHash(algorithm: 'sha256'): { update(data: string, encoding: string): { digest(encoding: 'hex'): string } };
}

/** Minimal Buffer surface used by the node-side signer (extends Uint8Array like the real one). */
// P2-FIX-102: the battery/drill FAIL lines report through console.error - the
// shim must declare what the runtime actually provides (log + error).
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

declare class Buffer extends Uint8Array {
	static from(input: string, encoding: string): Buffer;
	static from(input: Uint8Array): Buffer;
	toString(encoding?: string): string;
}

declare module 'node:url' {
	export function fileURLToPath(url: string | URL): string;
}

declare module 'node:path' {
	export function join(...segments: string[]): string;
	export function dirname(p: string): string;
	export function resolve(...segments: string[]): string;
	// P2-FIX-102: the runtime drills resolve pinned-fixture basenames.
	export function basename(p: string, suffix?: string): string;
}

declare module 'node:test' {
	export function test(name: string, fn: (t: unknown) => void | Promise<void>): void;
	export function test(name: string, options: { skip?: boolean | string }, fn: (t: unknown) => void | Promise<void>): void;
	export function describe(name: string, fn: () => void): void;
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

// P2-FIX-102: enriched to the exact surface the battery suites and runtime
// drills use. The flauz-environments/flauz-browser shims already declare
// these members; this file's declaration is the one the dedicated battery
// programs resolve first, so the enrichment must live here.
declare const process: {
	platform: string;
	execPath: string;
	cwd(): string;
	readonly env: Record<string, string | undefined>;
	/** CLI argv (argv[0] execPath, argv[1] script; drills parse flags from argv[2]). */
	readonly argv: string[];
	/** Engine versions (node always present; electron only under an Electron host). */
	readonly versions: { readonly node: string; readonly electron?: string };
	/** Terminate the process; never returns (drill catch arms exit(1)/exit(2)). */
	exit(code?: number): never;
	/** Signal a process (signal 0 = liveness probe). */
	kill(pid: number, signal?: string | number): boolean;
};

declare class TextEncoder {
	encode(input?: string): Uint8Array;
}

declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;

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
