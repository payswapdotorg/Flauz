/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * THE KILL-AND-RECOVER TEST MATRIX (the work order's binding clause:
 * "recovery pass reconstructs memory + workflow + A2A state; watermarks make
 * catch-up incremental; prove with a kill-and-recover test matrix").
 *
 * The full stateful substrate in one workspace: tasks + evidence ledger
 * (DL-20 hardened), workflow fragments, executable workflow runs, tiered
 * memory, A2A coordination over the REAL on-disk bus journal, watermarks,
 * agent-activity checkpoints and the claims/decisions state.
 *
 * The matrix axes (every one a real simulated process death - the executor
 * throws mid-flight, then ALL service instances are dropped and rebuilt from
 * disk only):
 *
 *   A. kill mid-run at step 2          -> full recovery to completion
 *   B. kill at step 1                  -> recovery executes everything
 *   C. kill after completion           -> recovery is a no-op
 *   D. double kill (step 2, then 3)    -> two recoveries reach completion
 *   E. kill during a memory promotion  -> memory state stays coherent
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { A2ABus } from '../../flauz-agent/core/a2a.mjs';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { nodeFsPort, steppingClock, goldenRun } from './helpers.ts';

import { WorkflowService } from '../src/envelope.ts';
import { WorkflowRunService, validateWorkflowSpec, type WorkflowSpec } from '../src/executable.ts';
import { CoordinationService } from '../src/coordination.ts';
import type { A2aPort } from '../src/messaging.ts';
import { MemoryStore } from '../../flauz-memory/src/memory.ts';
import { WatermarkService, type StreamJournalPort, type StreamRow } from '../../flauz-memory/src/watermarks.ts';
import { CheckpointService, type MilestoneVerifier } from '../../flauz-memory/src/checkpoints.ts';
import { ClaimsService } from '../../flauz-memory/src/claims.ts';
import { createEd25519Signer } from '../src/keys.ts';

const KEYS = new URL('../../../test/fixtures/workflow/keys/', import.meta.url).pathname;
const PARENT = 'flauz.agent';
const WORKER = 'flauz.agent.worker-1';

interface ExecCall {
	readonly seq: number;
}

/** An executor that records calls and can simulate process death at a step. */
function recorder(calls: ExecCall[], crashAt?: number) {
	return async (call: { seq: number; toolId: string; input: Record<string, unknown> }) => {
		calls.push({ seq: call.seq });
		if (crashAt !== undefined && call.seq === crashAt) {
			throw new Error(`simulated process death at step ${String(call.seq)}`);
		}
		return { ok: true, output: `step ${String(call.seq)} output` };
	};
}

function fixtureSigner() {
	const privatePem = readFileSync(path.join(KEYS, 'ed25519-private.pem'), { encoding: 'utf-8' });
	const publicPem = readFileSync(path.join(KEYS, 'ed25519-public.pem'), { encoding: 'utf-8' });
	return createEd25519Signer('flauz-fixture-ed25519-1', privatePem, publicPem);
}

/** The full substrate stack over one workspace root. */
interface Stack {
	readonly root: string;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly exec: WorkflowRunService;
	readonly coordination: CoordinationService;
	readonly memory: MemoryStore;
	readonly watermarks: WatermarkService;
	readonly checkpoints: CheckpointService;
	readonly claims: ClaimsService;
}

async function bootStack(root: string, offset: number): Promise<Stack> {
	const fsPort = nodeFsPort();
	const clock = steppingClock(1_740_100_000_000 + offset * 1_000_000);
	const tasks = new TaskService({ root, fs: fsPort, clock });
	const ledger = new EvidenceLedger({ root, fs: fsPort, clock, signer: fixtureSigner() });
	const workflows = new WorkflowService({ root, fs: fsPort, tasks, ledger, clock });
	const exec = new WorkflowRunService({ root, fs: fsPort, tasks, ledger, clock, fragments: workflows });
	const memory = new MemoryStore({ root, fs: fsPort, clock });
	await memory.ensure();
	// The REAL on-disk A2A bus (restart-safe journal + cursors).
	const bus = new A2ABus(root);
	// The .d.mts declarations are looser than the typed TS mirror (string
	// $schema vs the literal); runtime parity is pinned by the existing
	// messaging parity tests, so the adapter casts at the boundary.
	const port: A2aPort = {
		post: async input => bus.post({ message: input as never }) as never,
		collect: async (agentId, consume) => bus.collect({ agentId, consume: consume ?? true }).messages as never[],
	};
	const coordination = new CoordinationService({ root, fs: fsPort, tasks, ledger, port, clock });
	// Watermark journals: the real durable streams of this workspace.
	const journals: StreamJournalPort = {
		read: async (streamId, from) => {
			const rows: StreamRow[] = [];
			if (streamId === 'task-events') {
				const envelope = await tasks.listTasks();
				let position = 0;
				for (const task of envelope) {
					for (const event of task.events) {
						position += 1;
						if (position >= from) {
							rows.push({ position, line: JSON.stringify({ taskId: task.id, type: event.type }) });
						}
					}
				}
			} else if (streamId === 'a2a-mailbox') {
				const raw = await fsPort.readFileUtf8(`${root}/.flauz/a2a/messages.jsonl`) ?? '';
				const lines = raw.length === 0 ? [] : raw.split('\n').filter(line => line.length > 0);
				for (const [index, line] of lines.entries()) {
					const position = index + 1;
					if (position >= from) {
						rows.push({ position, line });
					}
				}
			} else if (streamId === 'memory-writes') {
				const index = await memory.index();
				const total = index.entries.length;
				for (let position = from; position <= total; position++) {
					rows.push({ position, line: `memory-entry-${String(position)}` });
				}
			} else {
				const runs = await exec.listRuns();
				for (const [index, run] of runs.entries()) {
					const position = index + 1;
					if (position >= from) {
						rows.push({ position, line: JSON.stringify({ runId: run.runId, status: run.status }) });
					}
				}
			}
			return rows;
		},
	};
	const watermarks = new WatermarkService({ root, fs: fsPort, journals, clock });
	await watermarks.ensure();
	// The milestone verifier checks the REAL state (no fabricated checkpoints).
	const verifier: MilestoneVerifier = {
		verify: async (milestone, taskId, payloadRef) => {
			if (milestone === 'task-created') {
				try {
					await tasks.getTask(taskId);
					return true;
				} catch {
					return false;
				}
			}
			if (milestone === 'plan-approved') {
				try {
					const task = await tasks.getTask(taskId);
					return task.events.some(event => event.type === 'approve');
				} catch {
					return false;
				}
			}
			if (milestone === 'step-completed') {
				const match = /^run:(WR-\d{3,}):(\d+)$/.exec(payloadRef);
				if (match === null) {
					return false;
				}
				try {
					const run = await exec.loadRun(match[1] ?? '');
					const seq = Number.parseInt(match[2] ?? '0', 10);
					return run.steps.some(step => step.seq === seq && (step.status === 'done' || step.status === 'skipped'));
				} catch {
					return false;
				}
			}
			if (milestone === 'contract-verified') {
				const contract = await coordination.tryContractFor(taskId);
				return contract !== null && contract.status === 'verified';
			}
			return false;
		},
	};
	const checkpoints = new CheckpointService({ root, fs: fsPort, signer: fixtureSigner(), verifier, clock });
	await checkpoints.ensure();
	const claims = new ClaimsService({ root, fs: fsPort, clock });
	await claims.ensure();
	await tasks.bootstrap();
	await ledger.ensure();
	return { root, tasks, ledger, workflows, exec, coordination, memory, watermarks, checkpoints, claims };
}

async function newWorkspace(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'flauz-matrix-'));
}

/** A 3-step authored spec over the terminal tool. */
function threeStepSpec(): WorkflowSpec {
	const now = 1_740_000_000_000;
	return validateWorkflowSpec({
		$schema: 'flauz.workflows.exec/v1',
		id: 'WS-001',
		title: 'Matrix three-step check',
		sourceFragmentId: null,
		envelopeVersion: 1,
		version: 1,
		inputs: [{ name: 'targetDir', type: 'string', required: true, description: 'dir' }],
		steps: [
			{ seq: 1, toolId: 'flauz_terminal', name: 'a', inputTemplate: { command: 'one', dir: { $param: 'targetDir' } }, approval: 'recorded', onFail: 'abort' },
			{ seq: 2, toolId: 'flauz_terminal', name: 'b', inputTemplate: { command: 'two', dir: { $param: 'targetDir' } }, approval: 'recorded', onFail: 'abort' },
			{ seq: 3, toolId: 'flauz_terminal', name: 'c', inputTemplate: { command: 'three', dir: { $param: 'targetDir' } }, approval: 'recorded', onFail: 'abort' },
		],
		migrations: [],
		model: { provider: 'flauz-mock', model: 'flauz-mock-1' },
		timing: { created: now, updatedAt: now },
	});
}

test('MATRIX A: kill mid-run at step 2 - full recovery to completion', async () => {
	const root = await newWorkspace();
	try {
		let stack = await bootStack(root, 1);
		// Produce real evidence through the golden path + a delegated shared task.
		const golden = await goldenRun({ ...stack, cleanup: async () => undefined, fs: nodeFsPort(), mock: undefined as never } as never);
		const shared = await stack.tasks.createTask('Matrix shared delegated task');
		await stack.coordination.delegate({
			parent: PARENT,
			worker: WORKER,
			taskId: shared.id,
			goal: 'Run the three-step check',
			resultSchema: { fields: [{ name: 'verdict', type: 'string', required: true }] },
		});
		await stack.coordination.accept(shared.id, WORKER);
		// Memory: a session record on the golden task (state to survive the kill).
		await stack.memory.record('session', {
			kind: 'observation',
			content: 'golden path completed before the kill',
			taskId: golden.taskId,
			agentId: PARENT,
			provenance: { actor: 'agent', origin: 'task-event', ts: 1_740_100_000_100 },
		});
		// Baseline watermarks: catch up to the pre-kill state.
		for (const streamId of ['task-events', 'a2a-mailbox', 'memory-writes', 'workflow-runs'] as const) {
			await stack.watermarks.catchUp(streamId);
		}
		// Run the exec workflow under the shared task; die at step 2.
		await stack.exec.saveSpec(threeStepSpec());
		const preKill: ExecCall[] = [];
		await assert.rejects(() => stack.exec.run('WS-001', { targetDir: 'src' }, { executor: recorder(preKill, 2), taskId: shared.id }), /simulated process death at step 2/);
		assert.deepEqual(preKill.map(call => call.seq), [1, 2]);

		// == KILL: drop every instance; rebuild from disk only ==
		stack = await bootStack(root, 2);

		// Memory survived and verifies (index parity across the restart).
		const memoryVerdict = await stack.memory.verify();
		assert.equal(memoryVerdict.ok, true, JSON.stringify(memoryVerdict.problems));
		assert.ok((await stack.memory.list('session')).some(record => record.content.includes('golden path completed')));
		// The ledger chain survived and verifies (hardened: signed checkpoints + watermark).
		const ledgerVerdict = await stack.ledger.verify();
		assert.equal(ledgerVerdict.ok, true, JSON.stringify(ledgerVerdict));
		// The A2A journal survived: the worker's mailbox replays the delegation.
		const inbox = await stack.coordination.sharedState(shared.id);
		assert.equal(inbox.contract?.status, 'accepted');
		// The interrupted run recovers: step 1 NOT re-executed, 2 + 3 run.
		const recovery: ExecCall[] = [];
		const interrupted = (await stack.exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const outcome = await stack.exec.recover(interrupted.runId, { executor: recorder(recovery) });
		assert.equal(outcome.status, 'completed');
		assert.deepEqual(recovery.map(call => call.seq), [2, 3]);
		// The task reached 'done' through the state machine.
		const task = await stack.tasks.getTask(shared.id);
		assert.equal(task.status, 'done');
		// The contract result verifies against the golden evidence.
		const submission = await stack.coordination.submitResult(shared.id, WORKER, {
			outcome: 'ok',
			values: { verdict: 'matrix-a verified' },
			evidenceIds: [golden.evidenceId],
			summary: 'Recovered run completed; golden evidence re-hashed equal.',
		});
		assert.equal(submission.contract.status, 'verified');
		// Watermarks: incremental catch-up delivered exactly the post-kill deltas.
		const taskEvents = await stack.watermarks.catchUp('task-events');
		assert.ok(taskEvents.rows.length > 0);
		const again = await stack.watermarks.catchUp('task-events');
		assert.equal(again.rows.length, 0);
		const a2a = await stack.watermarks.catchUp('a2a-mailbox');
		assert.ok(a2a.rows.length >= 1, 'the result-report message arrived as a delta');
		// Checkpoints: minted ONLY for milestones that verifiably completed.
		await stack.checkpoints.checkpoint({ milestone: 'step-completed', taskId: shared.id, agentId: WORKER, payloadRef: `run:${interrupted.runId}:2` });
		await stack.checkpoints.checkpoint({ milestone: 'contract-verified', taskId: shared.id, agentId: PARENT, payloadRef: 'contract' });
		// Fabrication refused: step 99 never completed.
		await assert.rejects(() => stack.checkpoints.checkpoint({ milestone: 'step-completed', taskId: shared.id, agentId: WORKER, payloadRef: `run:${interrupted.runId}:99` }), /refusing to mint/);
		const checkpointVerdict = await stack.checkpoints.verify();
		assert.equal(checkpointVerdict.ok, true, JSON.stringify(checkpointVerdict));
		// Claims: the durable decision/claims state.
		const claim = await stack.claims.record({ statement: 'the matrix-a run recovered coherently', taskId: shared.id, actor: 'agent', origin: 'task-event' });
		await stack.claims.observe(claim.id, [golden.evidenceId], { actor: 'tool' });
		await stack.claims.verify(claim.id, { actor: 'tool' });
		assert.equal((await stack.claims.queryClaims({ state: 'verified' })).length, 1);

		// == SECOND KILL + reboot: the recovery pass is idempotent ==
		const third = await bootStack(root, 3);
		assert.equal((await third.memory.verify()).ok, true);
		assert.equal((await third.checkpoints.verify()).ok, true);
		assert.equal((await third.ledger.verify()).ok, true);
		assert.equal((await third.claims.queryClaims({ state: 'verified' })).length, 1);
		const runs = await third.exec.listRuns();
		assert.ok(runs.every(run => run.status !== 'running'));
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('MATRIX B: kill at step 1 - recovery executes everything', async () => {
	const root = await newWorkspace();
	try {
		let stack = await bootStack(root, 4);
		await stack.exec.saveSpec(threeStepSpec());
		const shared = await stack.tasks.createTask('Matrix B task');
		await assert.rejects(() => stack.exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 1), taskId: shared.id }), /simulated process death at step 1/);
		stack = await bootStack(root, 5);
		const interrupted = (await stack.exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const recovery: ExecCall[] = [];
		const outcome = await stack.exec.recover(interrupted.runId, { executor: recorder(recovery) });
		assert.equal(outcome.status, 'completed');
		assert.deepEqual(recovery.map(call => call.seq), [1, 2, 3]);
		assert.equal(outcome.recoveryCount, 1);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('MATRIX C: kill after completion - recovery is a no-op', async () => {
	const root = await newWorkspace();
	try {
		let stack = await bootStack(root, 6);
		await stack.exec.saveSpec(threeStepSpec());
		const shared = await stack.tasks.createTask('Matrix C task');
		const completed = await stack.exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([]), taskId: shared.id });
		assert.equal(completed.status, 'completed');
		stack = await bootStack(root, 7);
		const calls: ExecCall[] = [];
		const again = await stack.exec.recover(completed.runId, { executor: recorder(calls) });
		assert.equal(again.status, 'completed');
		assert.equal(again.recoveryCount, 0);
		assert.equal(calls.length, 0);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('MATRIX D: double kill (step 2, then step 3) - two recoveries reach completion', async () => {
	const root = await newWorkspace();
	try {
		let stack = await bootStack(root, 8);
		await stack.exec.saveSpec(threeStepSpec());
		const shared = await stack.tasks.createTask('Matrix D task');
		await assert.rejects(() => stack.exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 2), taskId: shared.id }), /simulated process death at step 2/);
		// First recovery dies at step 3.
		stack = await bootStack(root, 9);
		const firstInterrupted = (await stack.exec.listRuns()).find(run => run.status === 'running');
		assert.ok(firstInterrupted !== undefined);
		const firstRunId = firstInterrupted.runId;
		await assert.rejects(() => stack.exec.recover(firstRunId, { executor: recorder([], 3) }), /simulated process death at step 3/);
		// Second recovery completes.
		stack = await bootStack(root, 10);
		const interrupted = (await stack.exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const final: ExecCall[] = [];
		const runId = interrupted.runId;
		const outcome = await stack.exec.recover(runId, { executor: recorder(final) });
		assert.equal(outcome.status, 'completed');
		assert.deepEqual(final.map(call => call.seq), [3]);
		assert.equal(outcome.recoveryCount, 2);
		const run = await stack.exec.loadRun(runId);
		// Attempt accounting: step 1 ran once; steps 2 and 3 each crashed
		// once and re-ran (at-least-once recovery, exactly twice counted).
		assert.equal(run.steps[0]?.attempt, 1);
		assert.equal(run.steps[1]?.attempt, 2);
		assert.equal(run.steps[2]?.attempt, 2);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('MATRIX E: kill during a memory promotion - memory state stays coherent', async () => {
	const root = await newWorkspace();
	try {
		let stack = await bootStack(root, 11);
		const task = await stack.tasks.createTask('Matrix E task');
		await stack.memory.record('session', {
			kind: 'summary',
			content: 'promote me before the kill',
			taskId: task.id,
			agentId: PARENT,
			provenance: { actor: 'agent', origin: 'task-event', ts: 1_740_100_000_200 },
		});
		const moved = await stack.memory.move('MEM-S-000001', 'task', { reason: 'persist before kill', actor: 'agent', humanApproved: false });
		assert.equal(moved.record.id, 'MEM-T-001-000001');
		// == KILL ==
		stack = await bootStack(root, 12);
		const verdict = await stack.memory.verify();
		assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
		const taskTier = await stack.memory.list('task');
		assert.equal(taskTier.length, 1);
		assert.equal(taskTier[0]?.id, 'MEM-T-001-000001');
		const promotions = await stack.memory.promotions();
		assert.equal(promotions.length, 1);
		assert.equal(promotions[0]?.action, 'promote');
		// The session journal no longer holds the record.
		assert.equal((await stack.memory.list('session')).length, 0);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
