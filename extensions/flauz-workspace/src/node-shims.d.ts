/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/node-shims.d.ts
 *
 *  Minimal ambient declarations for the host globals/builtins used by src/, so the
 *  extension typechecks standalone (strict, noEmit) without @types/node. Only the
 *  exact API surface consumed by src/extension.ts and src/api.ts is declared.
 *
 *  - `node:fs/promises` — backing the FileSystemPort in the extension host.
 *  - `TextEncoder`      — global since Node 11 / available in the ext host; used by
 *                         the pure sha256 in api.ts. Declared here because it is not
 *                         part of the ES2022 standard lib.
 *
 *  Test files import richer node builtins (node:test, node:assert/strict, node:crypto,
 *  node:fs/promises, node:os, node:path) but are executed — not typechecked — by
 *  `node --test`, so they need no declarations here.
 *--------------------------------------------------------------------------------------------*/

declare module 'node:fs/promises' {
	export function readFile(path: string, options: { encoding: 'utf-8' }): Promise<string>;
	export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function appendFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

declare class TextEncoder {
	encode(input?: string): Uint8Array;
}
