/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_IDS, createWorkflowCommandHandlers, registerWorkflowCommands, summarizeFragment } from '../src/commands.ts';
import { bootWorkflowWorkspace, goldenRun, steppingClock } from './helpers.ts';

test('command ids are the three documented round-trip commands', () => {
	assert.deepEqual([...COMMAND_IDS], ['flauz.workflow.save', 'flauz.workflow.run', 'flauz.workflow.list']);
});

test('flauz.workflow.save + run + list handlers drive the full round-trip', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const handlers = createWorkflowCommandHandlers({
			workflows: ws.workflows,
			executor: async () => ({ ok: true, output: 'flauz-golden-path-ok' }),
		});
		const golden = await goldenRun(ws);
		const saved = await handlers['flauz.workflow.save']({ taskId: golden.taskId }) as { workflowId: string; path: string };
		assert.equal(saved.workflowId, 'W-001');
		assert.equal(saved.path, '.flauz/workflows/W-001.json');
		const outcome = await handlers['flauz.workflow.run']({ workflowId: saved.workflowId }) as { status: string; stopped: string };
		assert.equal(outcome.status, 'done');
		assert.equal(outcome.stopped, 'completed');
		const listed = await handlers['flauz.workflow.list']({}) as { workflows: Array<{ id: string; runs: number; sourceTaskId: string }> };
		assert.equal(listed.workflows.length, 1);
		assert.equal(listed.workflows[0]?.id, 'W-001');
		assert.equal(listed.workflows[0]?.runs, 1);
		assert.equal(listed.workflows[0]?.sourceTaskId, golden.taskId);
	} finally {
		await ws.cleanup();
	}
});

test('handlers reject malformed args with the documented messages', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const handlers = createWorkflowCommandHandlers({ workflows: ws.workflows, executor: async () => ({ ok: true, output: '' }) });
		await assert.rejects(handlers['flauz.workflow.save']({}), /missing required key 'taskId'/);
		await assert.rejects(handlers['flauz.workflow.save']({ taskId: '' }), /'taskId' must be a non-empty string/);
		await assert.rejects(handlers['flauz.workflow.save']({ taskId: 'T-001', rerunApprovals: 'always' }), /must be 'replay' or 'ask'/);
		await assert.rejects(handlers['flauz.workflow.run']({ workflowId: 'W-001', approvals: 'sometimes' }), /must be 'replay' or 'ask'/);
	} finally {
		await ws.cleanup();
	}
});

test('registerWorkflowCommands registers the surface against the ambient vscode', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const disposables = registerWorkflowCommands({ workflows: ws.workflows, executor: async () => ({ ok: true, output: '' }) });
		assert.equal(disposables.length, 3);
		const registered = ws.mock.state.registeredCommands.slice().sort();
		assert.deepEqual(registered, [...COMMAND_IDS].sort());
		const golden = await goldenRun(ws);
		const saved = await ws.mock.commands.executeCommand('flauz.workflow.save', { taskId: golden.taskId }) as { workflowId: string };
		assert.equal(saved.workflowId, 'W-001');
		for (const disposable of disposables) {
			disposable.dispose();
		}
		await assert.rejects(ws.mock.commands.executeCommand('flauz.workflow.list', {}), /not registered/);
	} finally {
		await ws.cleanup();
	}
});

test('summarizeFragment projects the fragment for list output', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		const fragment = await ws.workflows.load(saved.workflowId);
		const summary = summarizeFragment(fragment);
		assert.equal(summary.id, 'W-001');
		assert.equal(summary.tools, 1);
		assert.equal(summary.evidenceRefs, 1);
		assert.equal(summary.runs, 0);
	} finally {
		await ws.cleanup();
	}
});

