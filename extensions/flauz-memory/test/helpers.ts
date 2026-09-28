/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared workspace boot for flauz-memory tests: temp dir + the MemoryStore
 * under test (and the flauz-workspace services for cross-substrate tests).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { sha256Hex } from '../../flauz-workspace/src/api.ts';
import { MemoryStore } from '../src/memory.ts';

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

export function nodeFsPort(): FileSystemPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
	};
}

export interface MemoryTestWorkspace {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly store: MemoryStore;
	cleanup(): Promise<void>;
}

export interface MemoryBootOptions {
	readonly clock?: () => number;
	readonly caps?: { session?: number; task?: number; project?: number };
}

export async function bootMemoryWorkspace(options: MemoryBootOptions = {}): Promise<MemoryTestWorkspace> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-mem-'));
	const fsPort = nodeFsPort();
	const clock = options.clock ?? steppingClock(1_740_000_000_000);
	const store = new MemoryStore({
		root,
		fs: fsPort,
		clock,
		...(options.caps !== undefined ? { caps: options.caps } : {}),
	});
	await store.ensure();
	return {
		root,
		fs: fsPort,
		store,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

/** The canonical content hash of a memory record's content (test assertion helper). */
export function contentHashOf(content: string): string {
	return sha256Hex(content);
}
