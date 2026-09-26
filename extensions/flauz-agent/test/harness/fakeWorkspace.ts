/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The section 4 fake workspace seam: a temp directory standing in for the workspace
 * root, with readers for the on-disk seam state (tasks.json, evidence
 * ledger, artifacts), plus helpers to wire the golden-path bridge against
 * the REAL core service (spawned child) and the fidelity vscode mock.
 */

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeamClient } from '../../src/seamClient.ts';
import type { TaskEnvelope } from '../../src/types.ts';
import { Orchestrator, type ChatStreamLike } from '../../src/orchestrator.ts';
import { registerParticipant } from '../../src/participant.ts';
import { registerTerminalTool } from '../../src/tools/terminalTool.ts';
import { selectPreferredModels, type ModelSelection } from '../../src/models.ts';
import type { MockVscodeApi, MockVscodeState } from './vscode-mock.ts';
import type * as vscode from 'vscode';

export interface FakeWorkspace {
	root: string;
	readTasks(): TaskEnvelope;
	readLedgerLines(): string[];
	readArtifact(relativeUri: string): string;
}

export function createFakeWorkspace(): FakeWorkspace {
	const root = mkdtempSync(join(tmpdir(), 'flauz-golden-'));
	return {
		root,
		readTasks() {
			return JSON.parse(readFileSync(join(root, '.flauz', 'tasks.json'), 'utf-8')) as TaskEnvelope;
		},
		readLedgerLines() {
			const path = join(root, '.flauz', 'evidence', 'ledger.jsonl');
			if (!existsSync(path)) {
				return [];
			}
			return readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0);
		},
		readArtifact(relativeUri) {
			return readFileSync(join(root, relativeUri), 'utf-8');
		},
	};
}

/** Spawn the REAL core service against the fake workspace. */
export async function startRealSeam(workspace: FakeWorkspace, globalStoragePath?: string): Promise<SeamClient> {
	return SeamClient.start({
		workspaceRoot: workspace.root,
		globalStoragePath,
		logger: (message) => console.log(`  [seam] ${message}`),
	});
}

export interface BridgeHandle {
	handler: vscode.ChatRequestHandler;
	orchestrator: Orchestrator;
	selection: { current: ModelSelection };
}

/**
 * Wire the participant + orchestrator + tool exactly the way extension.ts
 * does, but against the mock API and the given (real) seam.
 */
export async function wireBridge(
	api: MockVscodeApi,
	state: MockVscodeState,
	seam: SeamClient,
	workspaceRoot: string,
): Promise<BridgeHandle> {
	const selection: { current: ModelSelection } = { current: { models: [], status: 'no-models' } };
	const orchestrator = new Orchestrator({
		seam,
		workspaceRoot,
		getModelSelection: () => selection.current,
		invokeTool: (name, options) =>
			api.lm.invokeTool(name, options) as Promise<{ content?: Array<{ value?: unknown }> }>,
		logger: (message) => console.log(`  [bridge] ${message}`),
	});
	registerTerminalTool((name, tool) => api.lm.registerTool(name, tool), {
		terminalFactory: (name) => api.window.createTerminal({ name }),
		logger: (message) => console.log(`  [bridge] ${message}`),
	});
	registerParticipant((id, handler) => api.chat.createChatParticipant(id, handler), {
		orchestrator,
		getModelSelection: () => selection.current,
	});
	selection.current = await selectPreferredModels((selector) => api.lm.selectChatModels(selector));
	const participant = state.participants.find((entry) => entry.id === 'flauz.agent');
	if (!participant) {
		throw new Error('participant not registered');
	}
	return { handler: participant.handler, orchestrator, selection };
}

export interface DriveResult {
	markdown: string[];
	progress: string[];
}

/** Invoke the handler with a fake chat request and a collecting stream. */
export async function drive(
	handler: vscode.ChatRequestHandler,
	request: { prompt?: string; command?: string; toolInvocationToken?: unknown },
): Promise<DriveResult> {
	const markdown: string[] = [];
	const progress: string[] = [];
	const stream = {
		markdown(value: string) {
			markdown.push(value);
		},
		progress(value: string) {
			progress.push(value);
		},
		anchor() { /* unused */ },
		button() { /* unused */ },
		filetree() { /* unused */ },
		reference() { /* unused */ },
		push() { /* unused */ },
	} as unknown as vscode.ChatResponseStream;
	const chatRequest = {
		prompt: request.prompt ?? '',
		command: request.command,
		references: [],
		toolReferences: [],
		toolInvocationToken: request.toolInvocationToken ?? { opaque: true },
		model: undefined,
	} as unknown as vscode.ChatRequest;
	await handler(chatRequest, {} as unknown as vscode.ChatContext, stream, {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() { /* noop */ } }),
	});
	return { markdown, progress };
}
