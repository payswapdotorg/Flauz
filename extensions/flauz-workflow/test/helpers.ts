/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared workspace boot for flauz-workflow tests: temp dir + the flauz-workspace
 * services (TaskService / EvidenceLedger) + the WorkflowService under test.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { sha256Hex } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService } from '../src/envelope.ts';
import { createMockVscode, type MockVscode } from './vscodeMock.ts';
import { setVscodeApi } from '../src/globals.ts';

export const FIXED_TS = 1_740_000_000_000;

export function fixedClock(): () => number {
	return () => FIXED_TS;
}

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

let bootCounter = 0;

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

export interface TestWorkspace {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly mock: MockVscode;
	cleanup(): Promise<void>;
}

export interface BootOptions {
	readonly clock?: () => number;
	readonly installMock?: boolean;
}

export async function bootWorkflowWorkspace(options: BootOptions = {}): Promise<TestWorkspace> {
	const mock = createMockVscode();
	if (options.installMock !== false) {
		setVscodeApi(mock as unknown as Parameters<typeof setVscodeApi>[0]);
	}
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-wf-'));
	const fsPort = nodeFsPort();
	bootCounter += 1;
	const clock = options.clock ?? steppingClock(1000 + bootCounter);
	const tasks = new TaskService({ root, fs: fsPort, clock });
	const ledger = new EvidenceLedger({ root, fs: fsPort, clock });
	const workflows = new WorkflowService({ root, fs: fsPort, tasks, ledger, clock });
	await tasks.bootstrap();
	await ledger.ensure();
	await fsPort.mkdir(`${root}/.flauz/workflows`);
	return {
		root,
		fs: fsPort,
		tasks,
		ledger,
		workflows,
		mock,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

/**
 * Drives one golden-path run through the flauz.tasks/v0 machine (the same
 * shape the Wave-3 flauz-agent orchestrator produces), so tests can save it
 * as a workflow and re-run it.
 */
export interface GoldenRunResult {
	readonly taskId: string;
	readonly evidenceId: string;
	readonly seq: number;
	readonly artifactUri: string;
	readonly artifactSha256: string;
}

export async function goldenRun(ws: TestWorkspace, prompt = 'ship the flauz wave 4 lane', command = 'echo flauz-golden-path-ok'): Promise<GoldenRunResult> {
	const created = await ws.tasks.createTask(prompt);
	const taskId = created.id;
	const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.`;
	await ws.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
	await ws.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
	const output = `${command}\nflauz-golden-path-ok`;
	const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
	await fs.mkdir(`${ws.root}/.flauz/artifacts/${taskId}`, { recursive: true });
	await ws.fs.writeFile(`${ws.root}/${artifactUri}`, output);
	const artifactSha256 = sha256Hex(output);
	const appended = await ws.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: command });
	await ws.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: command } });
	await ws.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
	await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
	await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
	return { taskId, evidenceId: appended.evidenceId, seq: appended.seq, artifactUri, artifactSha256 };
}
