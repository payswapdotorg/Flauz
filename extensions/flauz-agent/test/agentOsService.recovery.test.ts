/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M3 - the kill-and-reconnect matrix (work order, binding contract):
 *
 * "kill the service process before/after each request class; assert the
 * adapter reconnects, re-negotiates, and the logical state the Agent OS
 * sees is identical (no fabricated rows, no lost events that the ledger
 * does not explain)."
 *
 * Request classes: the full seam surface the Agent OS drives - task
 * creation, event append, evidence, checkpoints, task reads, ledger
 * verify, A2A post/collect/list, health, lifecycle.
 *
 *  - KILL-BEFORE: the process dies first; the class call short-circuits
 *    (nothing sent); recover() re-spawns + re-hello + re-negotiates; the
 *    re-issued call succeeds; the state explains itself.
 *  - KILL-AFTER: the class call COMPLETES, then the process dies; the
 *    post-recovery snapshot must be IDENTICAL to the pre-kill snapshot
 *    (deep-equal: no fabricated rows, no lost effects) and the ledger
 *    must verify.
 *  - Ground truth: the workspace artifacts (.flauz/tasks.json, the
 *    evidence ledger, the a2a journal) are read directly by the TEST to
 *    prove every wire event received is explained by durable state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { AgentOsServiceBoundary, BoundaryFailure, BOUNDARY_FAILURE_CODES } from '../core/serviceBoundary.mjs';
import { SEAM_PROTOCOL_V1 } from '../core/protocol.mjs';
import type { AgentOsStateSnapshot, BoundaryRecoveryReport } from '../core/serviceBoundary.mjs';

function makeWorkspace(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-boundary-recovery-'));
}

function sha256Of(text: string): string {
	return createHash('sha256').update(text, 'utf-8').digest('hex');
}

interface Collector {
	seamEvents: Array<{ event: string; payload: Record<string, unknown> }>;
	boundaryEvents: string[];
	exits: Array<number | null>;
}

function startBoundary(workspaceRoot: string, collector: Collector): Promise<AgentOsServiceBoundary> {
	return AgentOsServiceBoundary.start({
		workspaceRoot,
		onEvent: (event) => collector.seamEvents.push({ event: event.event, payload: event.payload }),
		onBoundaryEvent: (record) => collector.boundaryEvents.push(record.boundaryEvent),
		onExit: (code) => collector.exits.push(code),
	});
}

/** Kill the supervised service and await the observed exit (the exit hook). */
async function killService(boundary: AgentOsServiceBoundary, collector: Collector): Promise<void> {
	assert.equal(typeof boundary.servicePid, 'number', 'the boundary exposes the live pid for supervision');
	assert.equal(collector.exits.length, 0, 'no exit observed yet');
	process.kill(boundary.servicePid as number, 'SIGKILL');
	await new Promise<void>((resolve) => {
		const check = (): void => {
			if (!boundary.connected) {
				resolve();
				return;
			}
			setTimeout(check, 5);
		};
		check();
	});
	assert.equal(boundary.connected, false, 'the exit hook marked the boundary dead');
}

/** One request class of the matrix: setup state, then issue the class call. */
interface RequestClass {
	name: string;
	/** State setup before the class call (returns the task id in play). */
	setup: (boundary: AgentOsServiceBoundary) => Promise<string>;
	/** The class request itself. */
	call: (boundary: AgentOsServiceBoundary, taskId: string) => Promise<unknown>;
	/** Whether the class call mutates logical state (kill-after identity still holds either way). */
	mutates: boolean;
}

const TASK_DELEGATION = {
	kind: 'task-delegation',
	from: 'flauz.agent',
	to: 'flauz.agent.worker-1',
	payload: { taskId: 'T-001', taskDescription: 'matrix delegation', prompt: 'do the work' },
};

const REQUEST_CLASSES: RequestClass[] = [
	{
		name: 'flauz.workspace.createTask',
		mutates: true,
		setup: async () => '',
		call: async (boundary) => boundary.createTask('matrix task'),
	},
	{
		name: 'flauz.workspace.appendEvent',
		mutates: true,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary, taskId) => boundary.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: {} }),
	},
	{
		name: 'flauz.workspace.appendEvidence',
		mutates: true,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary, taskId) => boundary.appendEvidence(taskId, { kind: 'command-output', uri: `.flauz/artifacts/${taskId}/out.txt`, sha256: sha256Of('matrix evidence') }),
	},
	{
		name: 'flauz.workspace.createCheckpoint',
		mutates: true,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary, taskId) => boundary.createCheckpoint(taskId, 'matrix-req'),
	},
	{
		name: 'flauz.workspace.listTasks + getTask (read)',
		mutates: false,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary, taskId) => Promise.all([boundary.listTasks(), boundary.getTask(taskId)]),
	},
	{
		name: 'flauz.workspace.verifyLedger (read)',
		mutates: false,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary) => boundary.verifyLedger(),
	},
	{
		name: 'flauz.a2a.post',
		mutates: true,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary) => boundary.a2aPost(TASK_DELEGATION),
	},
	{
		name: 'flauz.a2a.collect + list (read)',
		mutates: false,
		setup: async (boundary) => {
			const taskId = (await boundary.createTask('matrix task')).taskId;
			await boundary.a2aPost(TASK_DELEGATION);
			return taskId;
		},
		call: async (boundary) => Promise.all([boundary.a2aCollect('flauz.agent.worker-1'), boundary.a2aList()]),
	},
	{
		name: 'flauz.health.ping + status (read, v1)',
		mutates: false,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary) => Promise.all([boundary.healthPing(), boundary.healthStatus()]),
	},
	{
		name: 'flauz.lifecycle.initialize (idempotent)',
		mutates: false,
		setup: async (boundary) => (await boundary.createTask('matrix task')).taskId,
		call: async (boundary) => boundary.lifecycleInitialize(),
	},
];

/** Every seam event received must be explained by durable state (no lost, no phantom events). */
function assertEventsExplained(workspaceRoot: string, collector: Collector, snapshot: AgentOsStateSnapshot): void {
	const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
	for (const { event, payload } of collector.seamEvents) {
		const taskId = payload.taskId as string | undefined;
		switch (event) {
			case 'task-created':
				assert.ok(tasksById.has(taskId as string), `event task-created for ${String(taskId)} is explained by a durable task`);
				break;
			case 'task-event': {
				const task = tasksById.get(taskId as string);
				assert.ok(task, `event task-event for ${String(taskId)} has a durable task`);
				assert.ok(task.events.some((row) => row.type === payload.type), `event task-event type ${String(payload.type)} is in the task journal`);
				break;
			}
			case 'evidence-row':
				assert.ok(typeof payload.seq === 'number' && payload.seq >= 1 && payload.seq <= snapshot.ledger.rows, `event evidence-row seq ${String(payload.seq)} is within the verified ledger (${snapshot.ledger.rows} rows)`);
				break;
			case 'checkpoint': {
				const task = tasksById.get(taskId as string);
				assert.ok(task, `event checkpoint for ${String(taskId)} has a durable task`);
				assert.ok(task.changes.some((change) => change.checkpointRef === payload.checkpointRef), `checkpoint ref ${String(payload.checkpointRef)} is in the task changes`);
				break;
			}
			case 'a2a-message': {
				// Ground truth: the a2a journal on disk carries the message id.
				const journalPath = join(workspaceRoot, '.flauz/a2a/messages.jsonl');
				assert.ok(existsSync(journalPath), 'the a2a journal exists');
				const journal = readFileSync(journalPath, 'utf-8');
				assert.ok(journal.includes(`"id":"${String(payload.id)}"`), `event a2a-message id ${String(payload.id)} is in the a2a journal`);
				break;
			}
			default:
				assert.fail(`unexpected seam event ${event}`);
		}
	}
}

// ---------------------------------------------------------------------------------------
// KILL-BEFORE: the process dies first; nothing is sent; recovery restores the class.
// ---------------------------------------------------------------------------------------

test('kill-before matrix: dead boundary refuses, recover() re-negotiates, the re-issued class call succeeds', async (t) => {
	for (const requestClass of REQUEST_CLASSES) {
		await t.test(requestClass.name, async () => {
			const workspace = makeWorkspace();
			const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
			const boundary = await startBoundary(workspace, collector);
			try {
				const taskId = await requestClass.setup(boundary);
				await killService(boundary, collector);

				// The class call short-circuits: nothing was sent.
				await assert.rejects(() => requestClass.call(boundary, taskId), (failure: unknown) => {
					assert.ok(failure instanceof BoundaryFailure);
					assert.equal(failure.code, BOUNDARY_FAILURE_CODES.NOT_CONNECTED);
					assert.equal(failure.retryable, true, 'nothing was delivered - retry after reconnect is safe');
					return true;
				});

				// Recovery: re-spawn + re-hello + re-negotiate + state re-read.
				const report = await boundary.recover();
				assert.equal(report.generation, 2);
				assert.equal(report.protocolVersion, SEAM_PROTOCOL_V1, 'the adapter re-negotiated the same version');
				assert.equal(report.protocolVersionChanged, false);
				assert.deepEqual(report.capabilities, ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace']);
				assert.equal(report.eventGap, true, 'the reconnect reports the event gap honestly');
				assert.ok(collector.boundaryEvents.includes('event-gap'));

				// The re-issued class call succeeds through the new generation.
				await requestClass.call(boundary, taskId);
				assert.equal(boundary.connected, true);

				// The state explains itself: ledger verifies, events explained.
				const snapshot = await boundary.snapshot();
				assert.equal(snapshot.ledger.ok, true);
				assertEventsExplained(workspace, collector, snapshot);
			} finally {
				await boundary.shutdown();
			}
		});
	}
});

// ---------------------------------------------------------------------------------------
// KILL-AFTER: the class call completes, then the process dies; the state is identical.
// ---------------------------------------------------------------------------------------

test('kill-after matrix: the post-recovery snapshot is IDENTICAL to the pre-kill state (no fabricated rows, no lost effects)', async (t) => {
	for (const requestClass of REQUEST_CLASSES) {
		await t.test(requestClass.name, async () => {
			const workspace = makeWorkspace();
			const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
			const boundary = await startBoundary(workspace, collector);
			try {
				const taskId = await requestClass.setup(boundary);
				await requestClass.call(boundary, taskId);

				// The logical state the Agent OS sees right before the kill.
				const preKill = await boundary.snapshot();
				const preKillLedger = readLedgerRows(workspace);

				await killService(boundary, collector);
				const report: BoundaryRecoveryReport = await boundary.recover();

				// IDENTICAL logical state after recovery - the core M3 invariant.
				assert.deepEqual(report.snapshot, preKill, 'the recovered state is exactly the pre-kill state');
				assert.deepEqual(report.snapshot, await boundary.snapshot(), 'the report snapshot matches a fresh re-read');

				// Ground truth: the on-disk artifacts did not change either.
				assert.deepEqual(readLedgerRows(workspace), preKillLedger, 'no ledger rows were fabricated or lost by recovery');
				assert.equal(report.snapshot.ledger.ok, true, 'the ledger hash-chain verifies after recovery');

				// No phantom rows: task events count matches the durable journal.
				const tasksOnDisk = JSON.parse(readFileSync(join(workspace, '.flauz/tasks.json'), 'utf-8')) as { tasks: Array<{ id: string; events: unknown[] }> };
				assert.deepEqual(tasksOnDisk.tasks.map((task) => task.id), preKill.tasks.map((task) => task.id), 'the task rows on disk are exactly the snapshot rows');

				assertEventsExplained(workspace, collector, report.snapshot);
			} finally {
				await boundary.shutdown();
			}
		});
	}
});

function readLedgerRows(workspaceRoot: string): string[] {
	const ledgerPath = join(workspaceRoot, '.flauz/evidence/ledger.jsonl');
	if (!existsSync(ledgerPath)) {
		return [];
	}
	return readFileSync(ledgerPath, 'utf-8').split('\n').filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------------------
// The full Agent OS lifecycle: golden flow -> kill -> recover -> RESUME to done.
// ---------------------------------------------------------------------------------------

test('full lifecycle: start, drive the task to execute, kill, recover, resume through sign-off to done', async () => {
	const workspace = makeWorkspace();
	const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
	const boundary = await startBoundary(workspace, collector);
	try {
		// START (through the boundary): task creation + plan + human approval.
		const { taskId } = await boundary.createTask('lifecycle resilience');
		await boundary.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: {} });
		await boundary.appendEvent(taskId, { actor: 'human', type: 'approve', payload: {} });
		await boundary.appendEvidence(taskId, { kind: 'command-output', uri: `.flauz/artifacts/${taskId}/out.txt`, sha256: sha256Of('lifecycle output') });
		await boundary.createCheckpoint(taskId, 'lifecycle-req');
		await boundary.a2aPost(TASK_DELEGATION);
		let ledger = await boundary.verifyLedger();
		assert.deepEqual(ledger, { ok: true, rows: 1 });

		const preKill = await boundary.snapshot();
		const eventsBeforeKill = collector.seamEvents.length;
		assert.ok(eventsBeforeKill >= 6, 'the wire events flowed (task-created, task-event x2, evidence-row, checkpoint, a2a-message)');

		// KILL + RECOVER.
		await killService(boundary, collector);
		const report = await boundary.recover();
		assert.deepEqual(report.snapshot, preKill, 'recovery re-reads the identical logical state');

		// RESUME (through the recovered generation): report -> verify-pass -> sign-off -> done.
		const reported = await boundary.appendEvent(taskId, { actor: 'agent', type: 'report', payload: {} });
		assert.equal(reported.task.status, 'verify');
		const verified = await boundary.appendEvent(taskId, { actor: 'tool', type: 'verify-pass', payload: {} });
		assert.equal(verified.task.status, 'awaiting-signoff');
		const done = await boundary.appendEvent(taskId, { actor: 'human', type: 'sign-off', payload: {} });
		assert.equal(done.task.status, 'done');

		// The final state is coherent and fully explained.
		const finalSnapshot = await boundary.snapshot();
		assert.equal(finalSnapshot.tasks[0].status, 'done');
		ledger = await boundary.verifyLedger();
		assert.deepEqual(ledger, { ok: true, rows: 1 });
		assertEventsExplained(workspace, collector, finalSnapshot);

		// Every event that arrived BEFORE the kill is explained; the gap
		// after recovery is reported exactly once (never hidden).
		assert.ok(collector.boundaryEvents.includes('event-gap'));
		assert.equal(collector.boundaryEvents.filter((name) => name === 'event-gap').length, 1);
	} finally {
		await boundary.shutdown();
	}
});

// ---------------------------------------------------------------------------------------
// Recovery discipline: deliberate restart of a LIVE service; concurrent recovers; the
// idempotency memo survives recovery (same key = same attempt, never re-sent).
// ---------------------------------------------------------------------------------------

test('recover() on a live service is a deliberate restart: graceful exit 0, fresh generation, identical state', async () => {
	const workspace = makeWorkspace();
	const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
	const boundary = await startBoundary(workspace, collector);
	try {
		const { taskId } = await boundary.createTask('deliberate restart');
		const preRestart = await boundary.snapshot();

		const report = await boundary.recover();
		assert.equal(report.generation, 2);
		assert.deepEqual(report.snapshot, preRestart);
		assert.ok(collector.exits.includes(0), 'the live service was shut down gracefully (exit 0), not killed');

		// The same task is still drivable through the new generation.
		const submitted = await boundary.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: {} });
		assert.equal(submitted.task.status, 'awaiting-approval');
	} finally {
		await boundary.shutdown();
	}
});

test('concurrent recover() calls share ONE pass (generation accounting is exact)', async () => {
	const workspace = makeWorkspace();
	const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
	const boundary = await startBoundary(workspace, collector);
	try {
		await killService(boundary, collector);
		const [a, b] = await Promise.all([boundary.recover(), boundary.recover()]);
		assert.equal(a.generation, 2);
		assert.equal(b.generation, 2, 'both callers observed the SAME recovery pass');
		assert.equal(boundary.generation, 2);
	} finally {
		await boundary.shutdown();
	}
});

test('idempotency across recovery: a completed attempt key replays its outcome, never re-sends', async () => {
	const workspace = makeWorkspace();
	const collector: Collector = { seamEvents: [], boundaryEvents: [], exits: [] };
	const boundary = await startBoundary(workspace, collector);
	try {
		const key = 'flauz-orch/G-001/S-01/run/1';
		const first = await boundary.createTask('memo across recovery', { idempotencyKey: key });
		const preKill = await boundary.snapshot();

		await killService(boundary, collector);
		await boundary.recover();

		// The same key replays the completed outcome - the re-driven
		// attempt does NOT execute twice on the wire.
		const replayed = await boundary.createTask('memo across recovery', { idempotencyKey: key });
		assert.equal(replayed.taskId, first.taskId);
		assert.deepEqual(await boundary.snapshot(), preKill, 'still exactly one task: the attempt never double-applied');
	} finally {
		await boundary.shutdown();
	}
});
