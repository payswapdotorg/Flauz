/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A2A coordination tests (TL2-006 M4): delegation contracts, shared task
 * state, result verification (verified vs reported-not-verified), steering
 * with provenance, the private-context boundary (integration with the
 * flauz-memory substrate) and the stdio loopback through the real core
 * service.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWorkflowWorkspace, goldenRun, nodeFsPort, steppingClock, type TestWorkspace } from './helpers.ts';
import { CoordinationService, CONTRACT_SCHEMA, inMemoryA2aPort, validateDelegationContract, type DelegationContract } from '../src/coordination.ts';
import { type A2aMessage, type A2aPort } from '../src/messaging.ts';
import { WorkflowRunService, graphRowsOf } from '../src/executable.ts';
import { MemoryStore } from '../../flauz-memory/src/memory.ts';
import { effectiveShares } from '../../flauz-memory/src/retrieval.ts';
import { compileContext } from '../../flauz-memory/src/context.ts';

const PARENT = 'flauz.agent';
const WORKER = 'flauz.agent.worker-1';

function bootCoordination(ws: TestWorkspace): CoordinationService {
	return new CoordinationService({
		root: ws.root,
		fs: ws.fs,
		tasks: ws.tasks,
		ledger: ws.ledger,
		port: inMemoryA2aPort(() => 1_740_000_500_000),
		clock: steppingClock(1_740_001_000_000),
	});
}

async function delegateGolden(ws: TestWorkspace, coordination: CoordinationService): Promise<{ taskId: string; evidenceId: string; contract: DelegationContract }> {
	const golden = await goldenRun(ws);
	const delegation = await coordination.delegate({
		parent: PARENT,
		worker: WORKER,
		taskId: golden.taskId,
		goal: 'Review the login flow fix',
		resultSchema: { fields: [{ name: 'verdict', type: 'string', required: true }, { name: 'issuesFound', type: 'number', required: true }] },
	});
	return { taskId: golden.taskId, evidenceId: golden.evidenceId, contract: delegation.contract };
}

test('delegate persists the contract first and posts the typed delegation message', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, contract } = await delegateGolden(ws, coordination);
		assert.equal(contract.$schema, CONTRACT_SCHEMA);
		assert.equal(contract.status, 'delegated');
		assert.ok(contract.messageId !== null && /^M-\d{6,}$/.test(contract.messageId));
		const reloaded = await coordination.loadContract(contract.id);
		assert.equal(reloaded.goal, 'Review the login flow fix');
		assert.equal(reloaded.messageId, contract.messageId);
		const messages = (coordination as unknown as { port: { messages(): readonly { kind: string; from: string; to: string }[] } }).port.messages();
		assert.equal(messages[0]?.kind, 'task-delegation');
		assert.equal(messages[0]?.from, PARENT);
		assert.equal(messages[0]?.to, WORKER);
		void taskId;
	} finally {
		await ws.cleanup();
	}
});

test('accept is actor-gated: the wrong worker is rejected, the right one accepted', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId } = await delegateGolden(ws, coordination);
		await assert.rejects(() => coordination.accept(taskId, 'flauz.agent.other'), /delegated to '.+?', not 'flauz.agent.other'/);
		const accepted = await coordination.accept(taskId, WORKER);
		assert.equal(accepted.status, 'accepted');
	} finally {
		await ws.cleanup();
	}
});

test('submitResult: verified when evidence resolves AND artifact bytes re-hash', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, evidenceId } = await delegateGolden(ws, coordination);
		await coordination.accept(taskId, WORKER);
		const submission = await coordination.submitResult(taskId, WORKER, {
			outcome: 'ok',
			values: { verdict: 'looks good', issuesFound: 0 },
			evidenceIds: [evidenceId],
			summary: 'Reviewed the command output; no issues.',
		});
		assert.equal(submission.contract.status, 'verified');
		assert.equal(submission.contract.result?.verification, 'verified');
		assert.equal(submission.contract.result?.verificationNote, null);
		const messages = (coordination as unknown as { port: { messages(): readonly { kind: string; inReplyTo: string | null }[] } }).port.messages();
		const report = messages.find(message => message.kind === 'result-report');
		assert.ok(report !== undefined);
	} finally {
		await ws.cleanup();
	}
});

test('submitResult: unresolvable evidence is reported-not-verified, never verified', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId } = await delegateGolden(ws, coordination);
		await coordination.accept(taskId, WORKER);
		const submission = await coordination.submitResult(taskId, WORKER, {
			outcome: 'ok',
			values: { verdict: 'trust me', issuesFound: 0 },
			evidenceIds: ['E-999999'],
			summary: 'Claimed without resolvable evidence.',
		});
		assert.equal(submission.contract.status, 'submitted');
		assert.equal(submission.contract.result?.verification, 'reported-not-verified');
		assert.ok(submission.contract.result?.verificationNote?.includes('does not resolve in the ledger'));
	} finally {
		await ws.cleanup();
	}
});

test('submitResult: tampered artifact bytes are reported-not-verified (re-hash discipline)', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, evidenceId } = await delegateGolden(ws, coordination);
		await coordination.accept(taskId, WORKER);
		// Tamper with the artifact behind the ledger's back.
		const row = await ws.ledger.rowByEvidenceId(evidenceId);
		assert.ok(row !== undefined);
		await ws.fs.writeFile(`${ws.root}/${row.uri}`, 'tampered content');
		const submission = await coordination.submitResult(taskId, WORKER, {
			outcome: 'ok',
			values: { verdict: 'still good?', issuesFound: 0 },
			evidenceIds: [evidenceId],
			summary: 'Submitted against a tampered artifact.',
		});
		assert.equal(submission.contract.result?.verification, 'reported-not-verified');
		assert.ok(submission.contract.result?.verificationNote?.includes('do not re-hash'));
	} finally {
		await ws.cleanup();
	}
});

test('result schema enforcement: missing required, wrong type, undeclared field', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, evidenceId } = await delegateGolden(ws, coordination);
		await coordination.accept(taskId, WORKER);
		await assert.rejects(() => coordination.submitResult(taskId, WORKER, { outcome: 'ok', values: { issuesFound: 1 }, evidenceIds: [evidenceId], summary: 'x' }), /missing required field 'verdict'/);
		await assert.rejects(() => coordination.submitResult(taskId, WORKER, { outcome: 'ok', values: { verdict: 'ok', issuesFound: 'zero' }, evidenceIds: [evidenceId], summary: 'x' }), /field 'issuesFound' must be of type number/);
		await assert.rejects(() => coordination.submitResult(taskId, WORKER, { outcome: 'ok', values: { verdict: 'ok', issuesFound: 0, extra: true }, evidenceIds: [evidenceId], summary: 'x' }), /undeclared field 'extra'/);
	} finally {
		await ws.cleanup();
	}
});

test('steering: mid-flight is recorded with provenance; after submission the contract is closed', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, evidenceId } = await delegateGolden(ws, coordination);
		const steered = await coordination.steer(taskId, 'Focus only on the token refresh path.');
		assert.equal(steered.contract.steering.length, 1);
		assert.equal(steered.contract.steering[0]?.from, PARENT);
		assert.ok(steered.contract.steering[0]?.messageId.startsWith('M-'));
		await coordination.accept(taskId, WORKER);
		await coordination.submitResult(taskId, WORKER, { outcome: 'ok', values: { verdict: 'ok', issuesFound: 0 }, evidenceIds: [evidenceId], summary: 'done' });
		await assert.rejects(() => coordination.steer(taskId, 'one more thing'), /steering is mid-flight only/);
	} finally {
		await ws.cleanup();
	}
});

test('cancel closes an open contract; closing a closed one is a typed error', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const coordination = bootCoordination(ws);
		const { taskId, evidenceId } = await delegateGolden(ws, coordination);
		const cancelled = await coordination.cancel(taskId);
		assert.equal(cancelled.status, 'cancelled');
		await assert.rejects(() => coordination.cancel(taskId), /already closed/);
		void evidenceId;
	} finally {
		await ws.cleanup();
	}
});

test('shared task state: both agents see the task, the contract and the durable-graph run rows', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		// A durable run adds graph rows for the SAME task.
		const exec = new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, fragments: ws.workflows });
		const coordination = new CoordinationService({
			root: ws.root,
			fs: ws.fs,
			tasks: ws.tasks,
			ledger: ws.ledger,
			port: inMemoryA2aPort(() => 1_740_000_500_000),
			clock: steppingClock(1_740_001_000_000),
			runs: exec,
		});
		// A FRESH shared task for the delegation (the worker runs the exec
		// workflow UNDER it - the graph rows both agents see).
		const shared = await ws.tasks.createTask('Shared delegated review');
		const taskId = shared.id;
		const delegation = await coordination.delegate({
			parent: PARENT,
			worker: WORKER,
			taskId,
			goal: 'Run the review workflow',
			resultSchema: { fields: [{ name: 'verdict', type: 'string', required: true }] },
		});
		assert.equal(delegation.contract.status, 'delegated');
		await coordination.accept(taskId, WORKER);
		const golden = await goldenRun(ws);
		const spec = await exec.distillSpec(await ws.workflows.load((await ws.workflows.save({ taskId: golden.taskId })).workflowId), { toolRegistry: { toolIds: () => ['flauz_terminal'] } });
		const runs = exec;
		const outcome = await runs.run(spec.id, {}, { executor: async () => ({ ok: true, output: 'ok' }), taskId });
		assert.equal(outcome.status, 'completed');
		const state = await coordination.sharedState(taskId);
		assert.equal(state.task.id, taskId);
		assert.equal(state.contract?.id, (await coordination.contractFor(taskId)).id);
		assert.ok(state.runRows.length > 0);
		assert.ok(state.runRows.every(row => row.status === 'done'));
		const run = await runs.loadRun(outcome.runId);
		assert.deepEqual(graphRowsOf(run).map(row => row.seq), state.runRows.filter(row => row.runId === outcome.runId).map(row => row.seq));
	} finally {
		await ws.cleanup();
	}
});

test('private context: the boundary is the share record (M4 + M2 integration)', async () => {
	const ws = await bootWorkflowWorkspace();
	const root = ws.root;
	const memory = new MemoryStore({ root, fs: nodeFsPort(), clock: steppingClock(1_740_002_000_000) });
	await memory.ensure();
	try {
		const coordination = new CoordinationService({
			root,
			fs: ws.fs,
			tasks: ws.tasks,
			ledger: ws.ledger,
			port: inMemoryA2aPort(() => 1),
			clock: steppingClock(1_740_002_500_000),
			shares: memory,
		});
		const { taskId } = await delegateGolden(ws, coordination);
		// The worker records a PRIVATE memory note on the shared task.
		await memory.record('task', {
			kind: 'observation',
			content: 'worker-only root cause hypothesis',
			taskId,
			agentId: WORKER,
			provenance: { actor: 'agent', origin: 'task-event', ts: 1_740_002_000_100 },
		});
		const records = await memory.list('task');
		const privateId = records[0]?.id;
		assert.ok(privateId !== undefined);
		// The PARENT compiles context: the private record is invisible.
		const before = compileContext({
			taskId,
			agentId: PARENT,
			budget: { model: { id: 'm' }, window: { inputTokens: 512, outputTokens: 64 } },
			records,
			nowMs: 1_740_003_000_000,
		});
		assert.ok(!before.context.sections.some(section => section.content.includes('worker-only')));
		assert.deepEqual(before.context.excludedPrivate, [privateId]);
		// The worker grants the parent explicit access through the coordination layer.
		await coordination.grantContextAccess(privateId, PARENT, 'parent review requires the hypothesis');
		const shares = await coordination.contextShares();
		assert.equal(shares.length, 1);
		assert.equal(shares[0]?.toAgent, PARENT);
		const after = compileContext({
			taskId,
			agentId: PARENT,
			budget: { model: { id: 'm' }, window: { inputTokens: 512, outputTokens: 64 } },
			records,
			shares: effectiveShares(await memory.shares(), PARENT),
			nowMs: 1_740_003_000_000,
		});
		assert.ok(after.context.sections.some(section => section.content.includes('worker-only')));
		// Revocation closes the boundary again.
		await coordination.revokeContextAccess(privateId, PARENT, 'review done');
		const revoked = compileContext({
			taskId,
			agentId: PARENT,
			budget: { model: { id: 'm' }, window: { inputTokens: 512, outputTokens: 64 } },
			records,
			shares: effectiveShares(await memory.shares(), PARENT),
			nowMs: 1_740_003_000_000,
		});
		assert.ok(!revoked.context.sections.some(section => section.content.includes('worker-only')));
	} finally {
		await ws.cleanup();
	}
});

test('validateDelegationContract: self-delegation and schema violations are typed errors', () => {
	const base = {
		$schema: CONTRACT_SCHEMA,
		id: 'C-000001',
		parent: PARENT,
		worker: WORKER,
		taskId: 'T-001',
		goal: 'g',
		inputs: [],
		inputValues: {},
		constraints: { maxSteps: null, deadline: null, tools: null },
		resultSchema: { fields: [{ name: 'verdict', type: 'string', required: true }] },
		status: 'delegated',
		messageId: null,
		steering: [],
		result: null,
		timing: { created: 1, updatedAt: 1 },
	};
	assert.equal(validateDelegationContract(base).id, 'C-000001');
	assert.throws(() => validateDelegationContract({ ...base, parent: WORKER }), /parent and worker must differ/);
	assert.throws(() => validateDelegationContract({ ...base, status: 'weird' }), /status must be one of/);
	assert.throws(() => validateDelegationContract({ ...base, resultSchema: { fields: [] } }), /at least one field/);
	assert.throws(() => validateDelegationContract({ ...base, extra: 1 }), /expected exactly the keys/);
});

test('in-memory port discipline: collect drains, peek does not, mailboxes are projections', async () => {
	const port = inMemoryA2aPort(() => 42);
	await port.post({ kind: 'task-delegation', from: PARENT, to: WORKER, payload: { taskId: 'T-001', taskDescription: 'd', prompt: 'p' } });
	await port.post({ kind: 'steering-relay', from: PARENT, to: WORKER, payload: { taskId: 'T-001', message: 'focus' } });
	const first = await port.collect(WORKER);
	assert.equal(first.length, 2);
	const again = await port.collect(WORKER);
	assert.equal(again.length, 0);
	const peeked = await port.collect(WORKER, false);
	assert.equal(peeked.length, 0);
});

test('stdio loopback: delegation + verified result ride the REAL core service (flauz.a2a.* over stdio)', async () => {
	const { SeamClient } = await import('../../flauz-agent/src/seamClient.ts');
	type LoopbackClient = Awaited<ReturnType<typeof SeamClient.start>>;
	const ws = await bootWorkflowWorkspace();
	let client: LoopbackClient | undefined;
	try {
		client = await SeamClient.start({ workspaceRoot: ws.root });
		const port: A2aPort = {
			post: async input => {
				const posted = await client?.request<{ id: string; seq: number; message: A2aMessage }>('flauz.a2a.post', { message: input });
				if (posted === undefined) {
					throw new Error('stdio loopback: service disposed');
				}
				return posted;
			},
			collect: async (agentId, consume) => {
				const inbox = await client?.request<{ messages: A2aMessage[] }>('flauz.a2a.collect', { agentId, consume: consume ?? true });
				return inbox?.messages ?? [];
			},
		};
		const coordination = new CoordinationService({
			root: ws.root,
			fs: ws.fs,
			tasks: ws.tasks,
			ledger: ws.ledger,
			port,
			clock: steppingClock(1_740_004_000_000),
		});
		const golden = await goldenRun(ws);
		const delegation = await coordination.delegate({
			parent: PARENT,
			worker: WORKER,
			taskId: golden.taskId,
			goal: 'Review the login flow fix (stdio loopback)',
			resultSchema: { fields: [{ name: 'verdict', type: 'string', required: true }] },
		});
		assert.ok(delegation.messageId.startsWith('M-'), `the bus minted ${delegation.messageId}`);
		// The worker drains its mailbox through the same stdio seam.
		const inbox = await port.collect(WORKER);
		assert.equal(inbox.length, 1);
		await coordination.accept(golden.taskId, WORKER);
		const submission = await coordination.submitResult(golden.taskId, WORKER, {
			outcome: 'ok',
			values: { verdict: 'verified over stdio' },
			evidenceIds: [golden.evidenceId],
			summary: 'The golden-path evidence verified against the ledger + artifact bytes.',
		});
		assert.equal(submission.contract.status, 'verified');
		const parentInbox = await port.collect(PARENT);
		assert.equal(parentInbox.length, 1);
	} finally {
		await client?.dispose();
		await ws.cleanup();
	}
});
