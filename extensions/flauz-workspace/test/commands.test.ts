/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — test/commands.test.ts
 *
 *  The command seam against a mock vscode registry: registration surface, the
 *  create/get/list round trip, transition routing through appendEvent, malformed
 *  argument rejection, evidence append + artifact change notification, ledger
 *  verification, unknown-task errors, and openEvidence routing (file vs external).
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_TS, bootWorkspace } from './helpers.ts';
import { COMMAND_IDS } from '../src/commands.ts';

const HEX64 = 'a'.repeat(64);

test('registration: exactly the 8 seam commands are registered', async () => {
	const ws = await bootWorkspace();
	assert.deepEqual(ws.mock.commands.registered(), [...COMMAND_IDS].sort());
});

test('createTask -> getTask -> listTasks round trip', async () => {
	const ws = await bootWorkspace();
	const created = await ws.run('flauz.workspace.createTask', { title: 'Ship the slice' }) as { taskId: string };
	assert.equal(created.taskId, 'T-001');
	const got = await ws.run('flauz.workspace.getTask', { taskId: 'T-001' }) as { task: { title: string; status: string } };
	assert.equal(got.task.title, 'Ship the slice');
	assert.equal(got.task.status, 'plan');
	const listed = await ws.run('flauz.workspace.listTasks', {}) as { tasks: { id: string }[] };
	assert.deepEqual(listed.tasks.map(task => task.id), ['T-001']);
});

test('appendEvent routes through the state machine and returns the updated task', async () => {
	const ws = await bootWorkspace();
	await ws.run('flauz.workspace.createTask', { title: 'routed' });
	const result = await ws.run('flauz.workspace.appendEvent', {
		taskId: 'T-001',
		event: { ts: FIXED_TS, actor: 'agent', type: 'submit-plan', payload: {} },
	}) as { task: { status: string } };
	assert.equal(result.task.status, 'awaiting-approval');
});

test('appendEvent rejects malformed events (bad actor, missing keys)', async () => {
	const ws = await bootWorkspace();
	await ws.run('flauz.workspace.createTask', { title: 'strict' });
	await assert.rejects(
		ws.run('flauz.workspace.appendEvent', { taskId: 'T-001', event: { ts: FIXED_TS, actor: 'robot', type: 'x', payload: {} } }),
		/actor must be one of agent\|human\|tool/,
	);
	await assert.rejects(
		ws.run('flauz.workspace.appendEvent', { taskId: 'T-001', event: { ts: FIXED_TS, actor: 'agent', payload: {} } }),
		/expected exactly the keys \[actor, payload, ts, type\]/,
	);
});

test('appendEvidence returns {evidenceId, seq} and fires the artifact provider change', async () => {
	const ws = await bootWorkspace();
	await ws.run('flauz.workspace.createTask', { title: 'evidence' });
	const seen: string[][] = [];
	ws.artifacts.onDidChangeArtifacts(groups => seen.push(groups));
	const result = await ws.run('flauz.workspace.appendEvidence', {
		taskId: 'T-001',
		row: { kind: 'changeset', uri: 'file:///w/a.ts', sha256: HEX64 },
	}) as { evidenceId: string; seq: number };
	assert.equal(result.evidenceId, 'E-000001');
	assert.equal(result.seq, 1);
	assert.deepEqual(seen, [['changeset']]);
});

test('verifyLedger reports ok and the row count', async () => {
	const ws = await bootWorkspace();
	await ws.run('flauz.workspace.createTask', { title: 'verify' });
	for (const uri of ['file:///w/a.ts', 'file:///w/b.ts']) {
		await ws.run('flauz.workspace.appendEvidence', { taskId: 'T-001', row: { kind: 'changeset', uri, sha256: HEX64 } });
	}
	const result = await ws.run('flauz.workspace.verifyLedger', {}) as { ok: boolean; rows: number };
	assert.equal(result.ok, true);
	assert.equal(result.rows, 2);
});

test('unknown task ids are rejected with the standard error', async () => {
	const ws = await bootWorkspace();
	await assert.rejects(
		ws.run('flauz.workspace.getTask', { taskId: 'T-009' }),
		/unknown task 'T-009'/,
	);
	await assert.rejects(
		ws.run('flauz.workspace.appendEvidence', { taskId: 'T-009', row: { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 } }),
		/unknown task 'T-009'/,
	);
});

test('openEvidence routes file uris to the editor and other schemes to openExternal', async () => {
	const ws = await bootWorkspace();
	await ws.run('flauz.workspace.createTask', { title: 'open' });
	await ws.run('flauz.workspace.appendEvidence', { taskId: 'T-001', row: { kind: 'changeset', uri: 'file:///repo/src/a.ts', sha256: HEX64 } });
	await ws.run('flauz.workspace.appendEvidence', { taskId: 'T-001', row: { kind: 'screenshot', uri: 'https://example.com/shot.png', sha256: 'b'.repeat(64) } });
	await ws.run('flauz.workspace.openEvidence', { evidenceId: 'E-000001' });
	await ws.run('flauz.workspace.openEvidence', { evidenceId: 'E-000002' });
	assert.equal(ws.mock.workspace.openTextDocumentCalls[0]?.toString(), 'file:///repo/src/a.ts');
	assert.equal(ws.mock.window.showTextDocumentCalls[0]?.toString(), 'file:///repo/src/a.ts');
	assert.equal(ws.mock.env.openExternalCalls[0]?.toString(), 'https://example.com/shot.png');
	await assert.rejects(
		ws.run('flauz.workspace.openEvidence', { evidenceId: 'E-999999' }),
		/unknown evidence 'E-999999'/,
	);
});
