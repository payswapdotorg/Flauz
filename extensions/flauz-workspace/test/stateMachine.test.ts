/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_TS, bootWorkspace, type TestWorkspace } from './helpers.ts';
import { TRANSITIONS, type Actor, type TaskEvent, type TaskStatus } from '../src/api.ts';

function ev(type: string, actor: Actor, payload: Record<string, unknown> = {}): TaskEvent {
	return { ts: FIXED_TS, actor, type, payload };
}

async function driveTo(ws: TestWorkspace, status: TaskStatus): Promise<string> {
	const task = await ws.tasks.createTask(`drive-${status}`);
	const taskId = task.id;
	if (status === 'plan') {
		return taskId;
	}
	await ws.tasks.appendEvent(taskId, ev('submit-plan', 'agent'));
	if (status === 'awaiting-approval') {
		return taskId;
	}
	await ws.tasks.appendEvent(taskId, ev('approve', 'human'));
	if (status === 'execute') {
		return taskId;
	}
	if (status === 'failed') {
		await ws.tasks.appendEvent(taskId, ev('fail', 'agent'));
		return taskId;
	}
	await ws.tasks.appendEvent(taskId, ev('report', 'agent'));
	if (status === 'verify') {
		return taskId;
	}
	await ws.tasks.appendEvent(taskId, ev('verify-pass', 'agent'));
	if (status === 'awaiting-signoff') {
		return taskId;
	}
	if (status === 'done') {
		await ws.tasks.appendEvent(taskId, ev('sign-off', 'human'));
		return taskId;
	}
	if (status === 'cancelled') {
		await ws.tasks.appendEvent(taskId, ev('cancel', 'human'));
		return taskId;
	}
	throw new Error(`unreachable status ${status}`);
}

test('legal transition: submit-plan moves plan -> awaiting-approval (agent)', async () => {
	const ws = await bootWorkspace();
	const taskId = (await ws.tasks.createTask('t')).id;
	const task = await ws.tasks.appendEvent(taskId, ev('submit-plan', 'agent'));
	assert.equal(task.status, 'awaiting-approval');
	assert.equal(task.events.length, 1);
});

test('legal transition: approve moves awaiting-approval -> execute (human)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'awaiting-approval');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('approve', 'human'))).status, 'execute');
});

test('legal transition: request-changes moves awaiting-approval -> plan (human)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'awaiting-approval');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('request-changes', 'human'))).status, 'plan');
});

test('legal transition: report moves execute -> verify (agent)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'execute');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('report', 'agent'))).status, 'verify');
});

test('legal transition: verify-pass moves verify -> awaiting-signoff (agent)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'verify');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('verify-pass', 'agent'))).status, 'awaiting-signoff');
});

test('legal transition: verify-pass moves verify -> awaiting-signoff (tool)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'verify');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('verify-pass', 'tool'))).status, 'awaiting-signoff');
});

test('legal transition: verify-fail moves verify -> execute (agent)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'verify');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('verify-fail', 'agent'))).status, 'execute');
});

test('legal transition: fail moves execute -> failed (agent)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'execute');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('fail', 'agent'))).status, 'failed');
});

test('legal transition: sign-off moves awaiting-signoff -> done (human)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'awaiting-signoff');
	assert.equal((await ws.tasks.appendEvent(taskId, ev('sign-off', 'human'))).status, 'done');
});

test('legal transition: cancel moves every active status -> cancelled (human)', async () => {
	const ws = await bootWorkspace();
	for (const status of ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff'] as const) {
		const taskId = await driveTo(ws, status);
		const task = await ws.tasks.appendEvent(taskId, ev('cancel', 'human'));
		assert.equal(task.status, 'cancelled', `cancel from ${status}`);
	}
});

test('illegal transition: approve from plan rejects and lists allowed source statuses', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'plan');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('approve', 'human')),
		/not legal from status 'plan' \(allowed source statuses: awaiting-approval\)/,
	);
});

test('illegal transition: submit-plan from execute rejects', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'execute');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('submit-plan', 'agent')),
		/not legal from status 'execute' \(allowed source statuses: plan\)/,
	);
});

test('illegal transition: sign-off from verify rejects', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'verify');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('sign-off', 'human')),
		/not legal from status 'verify' \(allowed source statuses: awaiting-signoff\)/,
	);
});

test('illegal transition: report from plan rejects', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'plan');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('report', 'agent')),
		/not legal from status 'plan' \(allowed source statuses: execute\)/,
	);
});

test('illegal transition: request-changes from execute rejects', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'execute');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('request-changes', 'human')),
		/not legal from status 'execute' \(allowed source statuses: awaiting-approval\)/,
	);
});

test('terminal status: no transition is legal from done', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'done');
	for (const rule of TRANSITIONS) {
		const actor = rule.actors[0] as Actor;
		await assert.rejects(
			ws.tasks.appendEvent(taskId, ev(rule.type, actor)),
			/not legal from status 'done'/,
			`transition ${rule.type} must be illegal from done`,
		);
	}
});

test('terminal status: no transition is legal from cancelled (including cancel)', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'cancelled');
	for (const rule of TRANSITIONS) {
		const actor = rule.actors[0] as Actor;
		await assert.rejects(
			ws.tasks.appendEvent(taskId, ev(rule.type, actor)),
			/not legal from status 'cancelled'/,
			`transition ${rule.type} must be illegal from cancelled`,
		);
	}
});

test('terminal status: no transition is legal from failed', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'failed');
	for (const rule of TRANSITIONS) {
		const actor = rule.actors[0] as Actor;
		await assert.rejects(
			ws.tasks.appendEvent(taskId, ev(rule.type, actor)),
			/not legal from status 'failed'/,
			`transition ${rule.type} must be illegal from failed`,
		);
	}
});

test('actor gate: approve with agent rejects with actor requirement', async () => {
	const ws = await bootWorkspace();
	const taskId = await driveTo(ws, 'awaiting-approval');
	await assert.rejects(
		ws.tasks.appendEvent(taskId, ev('approve', 'agent')),
		/requires actor 'human' \(got 'agent'\)/,
	);
});

test('actor gates: verify-pass rejects human, verify-fail rejects tool', async () => {
	const ws = await bootWorkspace();
	const passTask = await driveTo(ws, 'verify');
	await assert.rejects(
		ws.tasks.appendEvent(passTask, ev('verify-pass', 'human')),
		/requires actor 'agent' \| 'tool' \(got 'human'\)/,
	);
	const failTask = await driveTo(ws, 'verify');
	await assert.rejects(
		ws.tasks.appendEvent(failTask, ev('verify-fail', 'tool')),
		/requires actor 'agent' \(got 'tool'\)/,
	);
});
