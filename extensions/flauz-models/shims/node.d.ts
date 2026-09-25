/**
 * Minimal ambient declarations for the Node built-in modules and globals used
 * by this extension's source and tests.
 *
 * Zero-dependency discipline (Wave 3 Lane F): no `@types/node` is installed.
 * These declarations are intentionally narrow — only the exact surface we call.
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

declare module 'node:path' {
        export function join(...segments: string[]): string;
        export function dirname(path: string): string;
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
