/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort, ResourceProvenance } from '../src/api.ts';
import { ResourceGraph } from '../src/graph.ts';

export const FIXED_TS = 1730000000000;

export function fixedClock(): () => number {
	return () => FIXED_TS;
}

/** Advances by 1000 on every call -- deterministic but distinguishable timestamps. */
export function steppingClock(start = 1000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

export const AGENT: ResourceProvenance = { actor: 'agent', actorId: 'flauz-agent' };
export const HUMAN: ResourceProvenance = { actor: 'human', actorId: 'user-1' };
export const TOOL: ResourceProvenance = { actor: 'tool', actorId: 'flauz-verify' };

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
		mkdir: async target => {
			await fs.mkdir(target, { recursive: true });
		},
	};
}

export interface TestGraph {
	readonly graph: ResourceGraph;
	readonly root: string;
	readonly fs: FileSystemPort;
	cleanup(): Promise<void>;
}

/** Boots a resource graph in a fresh temp workspace. */
export async function bootGraph(options: { clock?: () => number; seedGraph?: string; seedFiles?: Record<string, string> } = {}): Promise<TestGraph> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-res-'));
	const fsPort = nodeFsPort();
	if (options.seedGraph !== undefined) {
		await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
		await fs.writeFile(path.join(root, '.flauz', 'resources.json'), options.seedGraph, { encoding: 'utf-8' });
	}
	for (const [relative, text] of Object.entries(options.seedFiles ?? {})) {
		const target = path.join(root, relative);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, text, { encoding: 'utf-8' });
	}
	const graph = new ResourceGraph({ root, fs: fsPort, clock: options.clock ?? fixedClock() });
	await graph.bootstrap();
	return {
		graph,
		root,
		fs: fsPort,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

/** Repo-root fixture path for the resources fixture set. */
export function fixturePath(...segments: readonly string[]): string {
	// test/ -> flauz-resources/ -> extensions/ -> repo root
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'resources', ...segments);
}

export async function readFixture(...segments: readonly string[]): Promise<string> {
	return await fs.readFile(fixturePath(...segments), { encoding: 'utf-8' });
}

export async function readFixtureJson(...segments: readonly string[]): Promise<unknown> {
	return JSON.parse(await readFixture(...segments));
}

export async function listFixtureFiles(...segments: readonly string[]): Promise<string[]> {
	const entries = await fs.readdir(fixturePath(...segments), { withFileTypes: true });
	return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
}

/**
 * Assembles a secret-shaped string from fragments at RUNTIME (no complete
 * secret shape ever appears in this repository's source or fixtures). Used
 * only to prove the schema-level rejection of literal credentials.
 */
export function runtimeSecretFixture(kind: 'github-pat' | 'api-key' | 'aws-key' | 'jwt'): string {
	switch (kind) {
		case 'github-pat':
			return ['ghp_', 'Flauz', 'Fixture', 'Only', '0000', '1111', '2222', '3333'].join('');
		case 'api-key':
			return ['sk-', 'flauz-fixture-', 'aaaa', 'bbbb', 'cccc', 'dddd'].join('');
		case 'aws-key':
			return ['AK', 'IA', 'FLAUZFIXTURE00', '42'].join('');
		case 'jwt':
			return ['eyJhbGciOiJIUzI1NiJ9.eyJmbGF1eiI6Zml4dHVyZX0.', 'aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'].join('');
	}
}

/** A valid 64-hex sha256 (deterministic fixture hash). */
export const FIXTURE_SHA = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';
