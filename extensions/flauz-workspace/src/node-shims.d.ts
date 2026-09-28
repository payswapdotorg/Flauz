/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

/** Timer globals (TL4-H2 live file events: the debounce window; flauz-agent shims/node.d.ts pattern). */
declare function setTimeout(handler: () => void, ms: number): { unref(): void };
declare function clearTimeout(timer: { unref(): void } | undefined): void;
