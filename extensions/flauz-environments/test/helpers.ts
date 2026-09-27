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

/**
 * Virtual time for the CLI executor rigs: one shared clock + a latency cue
 * that ADVANCES it. The executors bound every poll window with
 * `clock() + windowMs` deadlines and `latency(pollIntervalMs)` sleeps, so a
 * rig wired with this object terminates any readiness/stop window in a
 * bounded number of iterations with ZERO wall-clock waiting — a test NEVER
 * depends on a real readiness window (the TL3-004 hang lesson: a fixed clock
 * with real-sleep loops, or a wall-clock window in a scripted drill, both
 * wedge the suite).
 */
export function virtualTime(start = FIXED_TS): { clock(): number; latency(ms: number): Promise<void>; now(): number } {
	let current = start;
	return {
		clock: () => current,
		now: () => current,
		latency: async (ms: number) => {
			current += Math.max(0, ms);
		},
	};
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

/** Repo-root fixture path for the environments-lifecycle (PIN-2) fixture set. */
export function lifecycleFixturePath(...segments: readonly string[]): string {
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'environments-lifecycle', ...segments);
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

export async function readLifecycleFixture(...segments: readonly string[]): Promise<string> {
	return await fs.readFile(lifecycleFixturePath(...segments), { encoding: 'utf-8' });
}

/**
 * In-memory FileSystemPort (the lifecycle core is tested against this — no
 * temp dirs, fully deterministic). Paths are opaque keys; `rename` moves
 * bytes; `mkdir` is a no-op.
 */
export function memFsPort(seed: Record<string, string> = {}): FileSystemPort & { files(): Map<string, string> } {
	const files = new Map<string, string>(Object.entries(seed));
	return {
		files: () => files,
		readFileUtf8: async target => files.get(target),
		writeFile: async (target, contents) => {
			files.set(target, contents);
		},
		rename: async (from, to) => {
			if (!files.has(from)) {
				throw (Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' }) as Error);
			}
			files.set(to, files.get(from)!);
			files.delete(from);
		},
		mkdir: async () => undefined,
	};
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

/** A valid workspace-remote registration input (the local-real kind binding). */
export function workspaceRemoteRegistrationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'env-test-remote',
		kind: 'workspace-remote',
		label: 'Test Remote',
		connection: { authorityPrefix: 'flauz-local' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
		...overrides,
	};
}

/** A valid container registration input. */
export function containerRegistrationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'env-test-container',
		kind: 'container',
		label: 'Test Container',
		connection: { workspaceFolder: '/workspace', name: 'test-container' },
		trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		...overrides,
	};
}

/** A valid cloud-sandbox registration input (DL-30 default posture: untrusted). */
export function cloudSandboxRegistrationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'env-test-cloud',
		kind: 'cloud-sandbox',
		label: 'Test Cloud',
		connection: { provider: 'e2b', apiKeyRef: 'vault:cloud-e2b-key', sandboxTemplate: 'base' },
		trust: { posture: 'untrusted', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: false },
		...overrides,
	};
}
