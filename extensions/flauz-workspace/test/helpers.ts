/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — test/helpers.ts
 *
 *  Node-side test plumbing: the node-backed FileSystemPort (same surface as the one
 *  in src/extension.ts), temp workspaces under os.tmpdir(), deterministic fixture
 *  clocks, and a boot helper that composes the full service graph against a mock
 *  vscode with the command seam registered — exactly like extension.activate does.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort } from '../src/api.ts';
import { TaskService } from '../src/taskService.ts';
import { EvidenceLedger } from '../src/ledger.ts';
import { CheckpointInterop } from '../src/checkpoint.ts';
import { FlauzArtifactProvider } from '../src/scmArtifactProvider.ts';
import { registerWorkspaceCommands, type WorkspaceServices } from '../src/commands.ts';
import { installMockVscode, type MockVscode } from './shims.ts';

export const FIXED_TS = 1730000000000;

export function fixedClock(): () => number {
	return () => FIXED_TS;
}

/** Advances by 1000 on every call — deterministic but distinguishable timestamps. */
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
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
	};
}

export interface TestWorkspace extends WorkspaceServices {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly mock: MockVscode;
	run(command: string, arg?: unknown): Promise<unknown>;
	cleanup(): Promise<void>;
}

export interface BootOptions {
	readonly registerCommands?: boolean;
	readonly clock?: () => number;
}

/** Boots the full service graph in a fresh temp workspace (commands registered by default). */
export async function bootWorkspace(options: BootOptions = {}): Promise<TestWorkspace> {
	const mock = installMockVscode();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-ws-'));
	const fsPort = nodeFsPort();
	const clock = options.clock ?? fixedClock();
	const tasks = new TaskService({ root, fs: fsPort, clock });
	const ledger = new EvidenceLedger({ root, fs: fsPort, clock });
	const checkpoints = new CheckpointInterop(tasks, ledger, clock);
	const artifacts = new FlauzArtifactProvider(() => ledger.readRows());
	await tasks.bootstrap();
	await ledger.ensure();
	const services: WorkspaceServices = { tasks, ledger, checkpoints, artifacts };
	if (options.registerCommands !== false) {
		registerWorkspaceCommands(services);
	}
	return {
		...services,
		root,
		fs: fsPort,
		mock,
		run: (command, arg) => mock.commands.executeCommand(command, arg),
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}
