/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-101 -- the ambient needs of the flauz-models SRC surface.
 *
 * These three declarations moved here from shims/node.d.ts (which stays the
 * home of the TEST-surface ambient needs: node:test, node:assert, node:http,
 * node:crypto, performance, ...). They live HERE, triple-slash-referenced by
 * the src files that use them, so the declarations TRAVEL with the compiled
 * src surface: a sibling extension whose default tsconfig pulls these
 * sources in by static import gets the same ambient declarations without
 * wiring anything of its own (the shims d.ts include glob of THIS
 * extension's tsconfig does not travel with the sources). At runtime the
 * real Node implementations are loaded; these types exist only so
 * `tsc --noEmit` can check the code under either config.
 *
 * Discipline (keep this file narrow on purpose):
 *   - every src file that uses one of these names carries
 *     `/// <reference path="../ambient.d.ts" />` -- that reference is what
 *     pulls the declarations into a consumer's program;
 *   - the declared set stays EXACTLY the names the src surface uses;
 *     test-only needs stay in shims/node.d.ts.
 */

/** AbortSignal surface used by the HTTP port (Node >= 20.3). */
declare class AbortSignal {
	readonly aborted: boolean;
	addEventListener(type: 'abort', listener: () => void): void;
	removeEventListener(type: 'abort', listener: () => void): void;
	static timeout(milliseconds: number): AbortSignal;
	static any(signals: readonly AbortSignal[]): AbortSignal;
}

/** Stream-aware UTF-8 decoding (global in Node). */
declare class TextDecoder {
	constructor(label?: string);
	decode(data?: Uint8Array, options?: { stream?: boolean }): string;
}

/** The base64/utf-8 Buffer subset the adapter common layer uses (node:buffer). */
declare module 'node:buffer' {
	export const Buffer: {
		from(input: Uint8Array | string, encoding?: 'base64' | 'utf-8'): { toString(encoding: 'base64' | 'utf-8'): string };
	};
}
