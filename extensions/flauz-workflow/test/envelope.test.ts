/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {
	WORKFLOW_SCHEMA,
	DEFAULT_WORKFLOW_MODEL,
	distillTaskToFragment,
	serializeWorkflowFragment,
	validateWorkflowFragment,
	workflowPath,
	type ApprovalPort,
	type WorkflowFragment,
} from '../src/envelope.ts';
import { bootWorkflowWorkspace, goldenRun, steppingClock, type TestWorkspace } from './helpers.ts';

function goodFragment(): Record<string, unknown> {
	return {
		$schema: WORKFLOW_SCHEMA,
		id: 'W-001',
		title: 'ship the flauz wave 4 lane',
		source: { taskId: 'T-001', evidenceIds: ['E-000001'] },
		createdAt: 1000,
		updatedAt: 1000,
		plan: { prompt: 'ship the flauz wave 4 lane', text: '## Flauz plan - T-001' },
		model: { provider: 'flauz-mock', model: 'flauz-mock-1', params: {} },
		tools: [{ seq: 1, toolId: 'flauz_terminal', name: 'echo flauz-golden-path-ok', input: { command: 'echo flauz-golden-path-ok' }, approval: 'recorded', outcome: 'ok', evidenceId: 'E-000001' }],
		approvals: [{ type: 'approve', ts: 2, note: null }],
		evidenceRefs: [{ evidenceId: 'E-000001', seq: 1, kind: 'command-output', uri: '.flauz/artifacts/T-001/command-output-1.txt', sha256: 'a'.repeat(64), derivedFrom: null }],
		rerun: { approvals: 'replay' },
		history: [],
	};
}

test('validation accepts the canonical good fragment', () => {
	const fragment = validateWorkflowFragment(goodFragment());
	assert.equal(fragment.id, 'W-001');
	assert.equal(fragment.rerun.approvals, 'replay');
	assert.equal(fragment.tools.length, 1);
	assert.deepEqual([...fragment.source.evidenceIds], ['E-000001']);
});

test('validation: every rule rejects its bad input (the fixture matrix)', () => {
	const cases: Array<[string, unknown]> = [
		['wrong $schema', { ...goodFragment(), $schema: 'flauz.workflows/v0' }],
		['bad id shape', { ...goodFragment(), id: 'workflow-1' }],
		['empty title', { ...goodFragment(), title: '' }],
		['bad source taskId', { ...goodFragment(), source: { taskId: 'T-1', evidenceIds: [] } }],
		['bad source evidenceId', { ...goodFragment(), source: { taskId: 'T-001', evidenceIds: ['E-1'] } }],
		['non-integer createdAt', { ...goodFragment(), createdAt: '1000' }],
		['empty plan text', { ...goodFragment(), plan: { prompt: 'p', text: '' } }],
		['missing plan key', { ...goodFragment(), plan: { prompt: 'p' } }],
		['empty model provider', { ...goodFragment(), model: { provider: '', model: 'm' } }],
		['model params not an object', { ...goodFragment(), model: { provider: 'p', model: 'm', params: 'x' } }],
		['tool approval not a mode', { ...goodFragment(), tools: [{ ...((goodFragment().tools as Array<Record<string, unknown>>)[0] as Record<string, unknown>), approval: 'maybe' }] }],
		['tool outcome invalid', { ...goodFragment(), tools: [{ ...((goodFragment().tools as Array<Record<string, unknown>>)[0] as Record<string, unknown>), outcome: 'skipped' }] }],
		['tool seq not contiguous', { ...goodFragment(), tools: [{ ...((goodFragment().tools as Array<Record<string, unknown>>)[0] as Record<string, unknown>), seq: 2 }] }],
		['tool evidenceId malformed', { ...goodFragment(), tools: [{ ...((goodFragment().tools as Array<Record<string, unknown>>)[0] as Record<string, unknown>), evidenceId: 'E-1' }] }],
		['approval type invalid', { ...goodFragment(), approvals: [{ type: 'sign-off', ts: 2, note: null }] }],
		['evidenceRef kind invalid', { ...goodFragment(), evidenceRefs: [{ ...((goodFragment().evidenceRefs as Array<Record<string, unknown>>)[0] as Record<string, unknown>), kind: 'bogus' }] }],
		['evidenceRef sha256 malformed', { ...goodFragment(), evidenceRefs: [{ ...((goodFragment().evidenceRefs as Array<Record<string, unknown>>)[0] as Record<string, unknown>), sha256: 'XYZ' }] }],
		['evidenceRef derivedFrom malformed', { ...goodFragment(), evidenceRefs: [{ ...((goodFragment().evidenceRefs as Array<Record<string, unknown>>)[0] as Record<string, unknown>), derivedFrom: 'E-1' }] }],
		['rerun approvals invalid', { ...goodFragment(), rerun: { approvals: 'always' } }],
		['extra top-level key', { ...goodFragment(), extra: true }],
		['history record bad task id', { ...goodFragment(), history: [{ taskId: 'T-1', ts: 5, derivedFrom: { taskId: 'T-001', evidenceIds: [] } }] }],
	];
	for (const [label, value] of cases) {
		assert.throws(() => validateWorkflowFragment(value), { name: 'Error' }, `expected rejection: ${label}`);
	}
	assert.equal(cases.length, 21);
});

test('serialization is canonical: sorted keys, 2-space, one trailing newline', () => {
	const fragment = validateWorkflowFragment(goodFragment());
	const text = serializeWorkflowFragment(fragment);
	assert.ok(text.endsWith('}\n'));
	assert.ok(!text.endsWith('}\n\n'));
	assert.match(text, /\{\n  "\$schema": "flauz\.workflows\/v1",/);
	assert.equal(text, serializeWorkflowFragment(validateWorkflowFragment(JSON.parse(text))));
});

test('distillTaskToFragment extracts plan, tools, approvals and evidence from a golden run', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const task = await ws.tasks.getTask(golden.taskId);
		const fragment = distillTaskToFragment(task, { id: 'W-001', clock: steppingClock(50_000) });
		assert.equal(fragment.plan.prompt, 'ship the flauz wave 4 lane');
		assert.equal(fragment.plan.text.includes('Flauz plan'), true);
		assert.equal(fragment.tools.length, 1);
		const tool = fragment.tools[0] as unknown as { toolId: string; input: { command: string }; evidenceId: string };
		assert.equal(tool.toolId, 'flauz_terminal');
		assert.equal(tool.input.command, 'echo flauz-golden-path-ok');
		assert.equal(tool.evidenceId, golden.evidenceId);
		assert.deepEqual(fragment.approvals.map(a => a.type), ['approve']);
		assert.deepEqual([...fragment.source.evidenceIds], [golden.evidenceId]);
		assert.deepEqual(fragment.model, { ...DEFAULT_WORKFLOW_MODEL });
	} finally {
		await ws.cleanup();
	}
});

test('save writes the fragment + registry and records workflow-saved on the task timeline', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		assert.equal(saved.workflowId, 'W-001');
		assert.equal(saved.path, '.flauz/workflows/W-001.json');
		const raw = await fs.readFile(`${ws.root}/${workflowPath('W-001')}`, { encoding: 'utf-8' });
		assert.equal(raw, serializeWorkflowFragment(validateWorkflowFragment(JSON.parse(raw))));
		const index = JSON.parse(await fs.readFile(`${ws.root}/.flauz/workflows/index.json`, { encoding: 'utf-8' })) as { workflows: string[] };
		assert.deepEqual(index.workflows, ['W-001']);
		const task = await ws.tasks.getTask(golden.taskId);
		const savedEvent = task.events.find(event => event.type === 'workflow-saved');
		assert.ok(savedEvent);
		assert.equal((savedEvent.payload as { workflowId: string }).workflowId, 'W-001');
		const second = await ws.workflows.save({ taskId: golden.taskId });
		assert.equal(second.workflowId, 'W-002');
	} finally {
		await ws.cleanup();
	}
});

test('list round-trips saved fragments and load rejects unknown ids', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		await ws.workflows.save({ taskId: golden.taskId });
		const all = await ws.workflows.list();
		assert.equal(all.length, 1);
		assert.equal((all[0] as WorkflowFragment).id, 'W-001');
		await assert.rejects(ws.workflows.load('W-999'), /not found/);
		await assert.rejects(ws.workflows.load('nope'), /must match/);
	} finally {
		await ws.cleanup();
	}
});

test('run (replay mode): full round-trip re-runs the plan through the state machine with derivedFrom links', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		const outputs: string[] = [];
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			executor: async step => {
				outputs.push(String(step.input.command));
				return { ok: true, output: 'flauz-golden-path-ok' };
			},
		});
		assert.equal(outcome.stopped, 'completed');
		assert.equal(outcome.status, 'done');
		assert.equal(outcome.ledger.ok, true);
		assert.deepEqual(outputs, ['echo flauz-golden-path-ok']);
		const rerun = await ws.tasks.getTask(outcome.taskId);
		assert.equal(rerun.status, 'done');
		assert.notEqual(rerun.id, golden.taskId);
		const types = rerun.events.map(event => event.type);
		assert.deepEqual(types, ['workflow-start', 'submit-plan', 'approve', 'evidence', 'report', 'verify-pass', 'sign-off']);
		const start = rerun.events[0] as unknown as { payload: { derivedFrom: { taskId: string; evidenceIds: string[] } } };
		assert.equal(start.payload.derivedFrom.taskId, golden.taskId);
		assert.deepEqual(start.payload.derivedFrom.evidenceIds, [golden.evidenceId]);
		const evidenceEvent = rerun.events.find(event => event.type === 'evidence') as unknown as { payload: { derivedFrom: string; evidenceId: string; uri: string } };
		assert.equal(evidenceEvent.payload.derivedFrom, golden.evidenceId);
		assert.ok(evidenceEvent.payload.evidenceId !== golden.evidenceId);
		const ledgerText = await fs.readFile(`${ws.root}/.flauz/evidence/ledger.jsonl`, { encoding: 'utf-8' });
		assert.equal(ledgerText.trim().split('\n').length, 2);
		const fragment = await ws.workflows.load(saved.workflowId);
		assert.equal(fragment.history.length, 1);
		const record = fragment.history[0] as unknown as { taskId: string; derivedFrom: { taskId: string; evidenceIds: string[] } };
		assert.equal(record.taskId, outcome.taskId);
		assert.equal(record.derivedFrom.taskId, golden.taskId);
		assert.deepEqual(record.derivedFrom.evidenceIds, [...outcome.evidenceIds]);
	} finally {
		await ws.cleanup();
	}
});

test('run (replay mode): tool failure fails the re-run and still links evidence', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			executor: async () => ({ ok: false, output: 'boom' }),
		});
		assert.equal(outcome.stopped, 'tool-failed');
		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.evidenceIds.length, 1);
		const rerun = await ws.tasks.getTask(outcome.taskId);
		assert.equal(rerun.status, 'failed');
	} finally {
		await ws.cleanup();
	}
});

test('run (ask mode): approvals come from the ask port (approve + sign-off path)', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId, rerunApprovals: 'ask' });
		const gates: string[] = [];
		const ask: ApprovalPort = async gate => {
			gates.push(gate);
			return gate === 'approval' ? 'approve' : 'sign-off';
		};
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			ask,
			executor: async () => ({ ok: true, output: 'flauz-golden-path-ok' }),
		});
		assert.deepEqual(gates, ['approval', 'sign-off']);
		assert.equal(outcome.status, 'done');
	} finally {
		await ws.cleanup();
	}
});

test('run (ask mode): request-changes sends the re-run back to plan and stops', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId, rerunApprovals: 'ask' });
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			ask: async () => 'request-changes',
			executor: async () => ({ ok: true, output: '' }),
		});
		assert.equal(outcome.stopped, 'request-changes');
		assert.equal(outcome.status, 'plan');
	} finally {
		await ws.cleanup();
	}
});

test('run (ask mode): cancel at the approval gate cancels the task', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId, rerunApprovals: 'ask' });
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			ask: async () => 'cancel',
			executor: async () => ({ ok: true, output: '' }),
		});
		assert.equal(outcome.stopped, 'cancelled');
		assert.equal(outcome.status, 'cancelled');
	} finally {
		await ws.cleanup();
	}
});

test('run (ask mode): skip at sign-off leaves the task awaiting sign-off', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId, rerunApprovals: 'ask' });
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			ask: async gate => (gate === 'approval' ? 'approve' : 'skip'),
			executor: async () => ({ ok: true, output: 'flauz-golden-path-ok' }),
		});
		assert.equal(outcome.stopped, 'awaiting-signoff');
		assert.equal(outcome.status, 'awaiting-signoff');
	} finally {
		await ws.cleanup();
	}
});

test('run throws when an ask gate is active but no ask port was supplied', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId, rerunApprovals: 'ask' });
		await assert.rejects(
			ws.workflows.run({ workflowId: saved.workflowId, executor: async () => ({ ok: true, output: '' }) }),
			/no ask port was supplied/,
		);
	} finally {
		await ws.cleanup();
	}
});

test('run records replayed approvals with provenance (replayed: true, workflowId)', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		const outcome = await ws.workflows.run({
			workflowId: saved.workflowId,
			executor: async () => ({ ok: true, output: 'ok' }),
		});
		const rerun = await ws.tasks.getTask(outcome.taskId);
		const approve = rerun.events.find(event => event.type === 'approve') as { payload: { replayed?: boolean; workflowId?: string } };
		assert.equal(approve.payload.replayed, true);
		assert.equal(approve.payload.workflowId, 'W-001');
		const signOff = rerun.events.find(event => event.type === 'sign-off') as { payload: { replayed?: boolean } };
		assert.equal(signOff.payload.replayed, true);
	} finally {
		await ws.cleanup();
	}
});

test('index.json missing falls back to a sequential scan (legacy workspace)', async () => {
	const ws = await bootWorkflowWorkspace({ clock: steppingClock() });
	try {
		const golden = await goldenRun(ws);
		await ws.workflows.save({ taskId: golden.taskId });
		await fs.rm(`${ws.root}/.flauz/workflows/index.json`);
		const all = await ws.workflows.list();
		assert.equal(all.length, 1);
		assert.equal((all[0] as WorkflowFragment).id, 'W-001');
	} finally {
		await ws.cleanup();
	}
});

async function bootEmpty(): Promise<TestWorkspace> {
	return bootWorkflowWorkspace({ clock: steppingClock() });
}

test('save rejects an unknown task id', async () => {
	const ws = await bootEmpty();
	try {
		await assert.rejects(ws.workflows.save({ taskId: 'T-999' }), /unknown task/);
	} finally {
		await ws.cleanup();
	}
});
