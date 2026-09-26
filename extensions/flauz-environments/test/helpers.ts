/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort } from '../src/api.ts';
import { EnvironmentRegistry } from '../src/registry.ts';

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
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
	};
}

export interface TestRegistry {
	readonly registry: EnvironmentRegistry;
	readonly root: string;
	readonly fs: FileSystemPort;
	cleanup(): Promise<void>;
}

/** Boots a registry in a fresh temp workspace. */
export async function bootRegistry(options: { clock?: () => number; seed?: string } = {}): Promise<TestRegistry> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-env-'));
	const fsPort = nodeFsPort();
	const registry = new EnvironmentRegistry({ root, fs: fsPort, clock: options.clock ?? fixedClock() });
	if (options.seed !== undefined) {
		await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
		await fs.writeFile(path.join(root, '.flauz', 'environments.json'), options.seed, { encoding: 'utf-8' });
	}
	await registry.bootstrap();
	return {
		registry,
		root,
		fs: fsPort,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

/** Repo-root fixture path for the environments fixture set. */
export function fixturePath(...segments: readonly string[]): string {
	// test/ -> flauz-environments/ -> extensions/ -> repo root
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'environments', ...segments);
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

/** A valid ssh registration input (timing minted by the registry clock). */
export function sshRegistrationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'env-test-ssh',
		kind: 'ssh-local',
		label: 'Test SSH',
		connection: { host: 'test.example.internal', authMethod: 'key' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		...overrides,
	};
}
