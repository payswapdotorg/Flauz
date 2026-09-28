/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by the live-events runtime drill's import graph (extensions/flauz-workspace
 * src + test shims + the drill itself). Mirrors the
 * extensions/flauz-workflow/shims/node.d.ts pattern (Wave 3 Lane F):
 * zero-dependency discipline -- no `@types/node`; only the exact surface the
 * drill graph calls. Used by tsconfig.live-events.json (the drill's own
 * typecheck lane, the tsconfig.session-battery.json precedent).
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
	/** The fs.watch handle surface the shim uses (close + error subscription). */
	export interface ShimFsWatcher {
		close(): void;
		on(event: 'error', listener: (error: Error) => void): void;
	}
	export function watch(
		path: string,
		options: { recursive: boolean },
		listener: (eventType: string, filename: string | null) => void
	): ShimFsWatcher;
	export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
}

declare module 'node:os' {
	export function tmpdir(): string;
}

declare module 'node:path' {
	export function join(...paths: string[]): string;
}

declare module 'node:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
	export function ok(value: unknown, message?: string): asserts value;
	export function equal(actual: unknown, expected: unknown, message?: string): void;
	export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
	export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
}

declare const process: {
	argv: string[];
	env: Record<string, string | undefined>;
	exit(code?: number): void;
};

declare const console: {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
};

declare class TextEncoder {
	encode(input?: string): Uint8Array;
}

/** Timer globals (the live-events debounce window + the drill's bounded waits). */
declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;
