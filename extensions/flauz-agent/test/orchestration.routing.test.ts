/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-001 M3 suite: multi-agent routing on the A2A seam.
 *
 * Routing decision records (why this agent), delegation via the typed A2A
 * v0 shapes (task-delegation / result-report / steering-relay /
 * resource-claim), private-context vs shared-task-state separation, and
 * claims/leases at the graph level (exclusive claims, expiring leases,
 * conflict notices - informational v0 enforcement). The suite runs against
 * the REAL A2ABus (core/a2a.mjs) on a temp workspace so the interop is
 * proven, not simulated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { A2ABus } from '../core/a2a.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import {
	rankAgentsByCapability,
	pickByLoad,
	buildTaskDelegation,
	delegateStep,
	ingestResultReport,
	buildSteeringRelay,
	mirrorResourceClaim,
	stepResourceId,
} from '../core/routing.mjs';
import { makeClock } from './harness/orchWorkspace.ts';
import type { TaskPort } from '../core/orchStore.mjs';

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const FAR_FUTURE = 1893456000000;

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-orch-routing-'));
}

/** A fake taskPort so graphs link to T-tasks (the a2a payloads require them). */
function fakeTaskPort(): TaskPort {
	let counter = 0;
	return {
		async createTask(args: { title: string }) {
			counter += 1;
			return { taskId: `T-${String(counter).padStart(3, '0')}` };
		},
		async appendEvent() {
			return { task: null };
		},
		async appendEvidence() {
			counter += 1;
			return { evidenceId: `E-${String(counter).padStart(6, '0')}`, seq: counter };
		},
	};
}

function makeStore(root: string, withPort = true): OrchestrationStore {
	const { clock } = makeClock(1700000000000);
	return new OrchestrationStore(root, { clock, taskPort: withPort ? fakeTaskPort() : null });
}

async function approvedGraph(root: string, steps: Array<Record<string, unknown>>, withPort = true): Promise<{ store: OrchestrationStore; graphId: string; taskId: string }> {
	const store = makeStore(root, withPort);
	const submitted = await store.submitGraph({ title: 'routing graph', steps, actor: 'agent', origin: 'test:routing' });
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:routing' });
	return { store, graphId: submitted.graphId, taskId: submitted.taskId ?? 'T-001' };
}

// ---------------------------------------------------------------------------
// routing decision support: capability matching + load balancing
// ---------------------------------------------------------------------------

test('capability matching ranks qualified agents and explains rejections', () => {
	const verdict = rankAgentsByCapability(
		[
			{ agentId: 'flauz.agent.worker-1', capabilities: ['terminal', 'browser'] },
			{ agentId: 'flauz.agent.worker-2', capabilities: ['terminal', 'browser', 'files'] },
			{ agentId: 'flauz.agent.worker-3', capabilities: ['files'] },
			{ agentId: 'not-valid id!', capabilities: ['terminal'] },
		],
		{ requiredCapability: 'browser' },
	);
	// both browser-capable agents qualify; the most specific first, deterministic order
	assert.deepEqual(verdict.qualified, ['flauz.agent.worker-2', 'flauz.agent.worker-1']);
	assert.equal(verdict.rejected.length, 2);
	assert.ok(verdict.rejected.some((entry) => entry.reason.includes('missing capability')));
	assert.ok(verdict.rejected.some((entry) => entry.reason.includes('not an agent id')));
	// allowedAgents narrows further
	const narrowed = rankAgentsByCapability(
		[
			{ agentId: 'flauz.agent.worker-1', capabilities: ['browser'] },
			{ agentId: 'flauz.agent.worker-2', capabilities: ['browser'] },
		],
		{ requiredCapability: 'browser', allowedAgents: ['flauz.agent.worker-2'] },
	);
	assert.deepEqual(narrowed.qualified, ['flauz.agent.worker-2']);
	assert.equal(narrowed.rejected.length, 1);
	assert.match(narrowed.rejected[0].reason, /allowedAgents/);
});

test('load balancing picks the least loaded candidate deterministically', () => {
	assert.equal(pickByLoad([{ agentId: 'a-1', load: 3 }, { agentId: 'b-2', load: 1 }, { agentId: 'c-3', load: 2 }]).agentId, 'b-2');
	// ties break by id
	assert.equal(pickByLoad([{ agentId: 'b-2', load: 1 }, { agentId: 'a-1', load: 1 }]).agentId, 'a-1');
	assert.throws(() => pickByLoad([]), (error: unknown) => /non-empty/.test(messageOf(error)));
	assert.throws(() => pickByLoad([{ agentId: 'a-1', load: 'high' } as never]), (error: unknown) => /load/.test(messageOf(error)));
});

// ---------------------------------------------------------------------------
// delegation on the real A2A bus
// ---------------------------------------------------------------------------

test('delegateStep: routing decision record + typed delegation + receipt, end to end', async () => {
	const root = makeRoot();
	const { store, graphId, taskId } = await approvedGraph(root, [
		{ stepId: 'S-01', title: 'research the logs', instruction: 'search the logs for the failing request id', routing: { requiredCapability: 'log-analysis' } },
	]);
	const bus = new A2ABus(root);
	const delegation = await delegateStep(store, bus, {
		graphId,
		stepId: 'S-01',
		targetAgent: 'flauz.agent.worker-1',
		reason: 'capability-match',
		details: { requiredCapability: 'log-analysis', matched: ['flauz.agent.worker-1'] },
		fromAgent: 'flauz.agent',
	});
	// the routing decision record is durable journal evidence
	const decision = store.journalRows.find((row) => row.type === 'route-decided');
	assert.equal(decision?.payload.targetAgent, 'flauz.agent.worker-1');
	assert.equal(decision?.payload.reason, 'capability-match');
	assert.deepEqual(decision?.payload.details, { requiredCapability: 'log-analysis', matched: ['flauz.agent.worker-1'] });
	// the delegation message landed on the REAL bus journal, typed and canonical
	const busLines = readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n').filter((line) => line.length > 0);
	assert.equal(busLines.length, 1);
	const message = JSON.parse(busLines[0]);
	assert.equal(message.kind, 'task-delegation');
	assert.equal(message.from, 'flauz.agent');
	assert.equal(message.to, 'flauz.agent.worker-1');
	assert.equal(message.id, delegation.messageId);
	// the delegation-sent receipt links decision row + bus message
	const receipt = store.journalRows.find((row) => row.type === 'delegation-sent');
	assert.equal(receipt?.payload.decisionRowId, decision?.rowId);
	assert.equal(receipt?.payload.messageId, delegation.messageId);
	// the step is running, owned by the delegated agent
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string; runnerId: string | null }> };
	assert.equal(state.steps['S-01'].status, 'running');
	assert.equal(state.steps['S-01'].runnerId, 'flauz.agent.worker-1');
	// the mailbox of the worker holds the delegation (projection of the journal)
	const collected = bus.collect({ agentId: 'flauz.agent.worker-1' });
	assert.equal(collected.messages.length, 1);
	assert.equal(collected.messages[0].payload.taskId, taskId);
});

test('private context NEVER enters the delegation (shared-task-state separation)', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [
		{ stepId: 'S-01', title: 'shared title', instruction: 'the shared instruction', tool: 'flauz_terminal', toolInput: { command: 'echo private-secret-internal' } },
	]);
	const bus = new A2ABus(root);
	const delegation = await delegateStep(store, bus, {
		graphId,
		stepId: 'S-01',
		targetAgent: 'flauz.agent.worker-2',
		reason: 'operator-choice',
	});
	// the payload carries EXACTLY the shared-task-state keys
	const payload = (delegation.message as { payload: Record<string, unknown> }).payload;
	assert.deepEqual(Object.keys(payload).sort(), ['prompt', 'taskDescription', 'taskId']);
	// and none of the private context
	const serialized = JSON.stringify(payload);
	assert.equal(serialized.includes('toolInput'), false);
	assert.equal(serialized.includes('private-secret-internal'), false);
	assert.equal(serialized.includes('command'), false);
	// the graph-side private state stays in the graph DEFINITION, not the bus
	const graphs = readFileSync(join(root, '.flauz', 'orchestration', 'graphs.json'), 'utf-8');
	assert.ok(graphs.includes('flauz_terminal'), 'the tool port name lives in the graph definition');
});

test('a worker result-report maps back onto the graph with a2a provenance', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [
		{ stepId: 'S-01', title: 'delegated work', instruction: 'do the work' },
		{ stepId: 'S-02', title: 'local work', instruction: 'local follow-up', dependsOn: ['S-01'] },
	]);
	const bus = new A2ABus(root);
	const delegation = await delegateStep(store, bus, {
		graphId,
		stepId: 'S-01',
		targetAgent: 'flauz.agent.worker-1',
		reason: 'capability-match',
	});
	// the worker reports back (a result-report message on the bus)
	const report = await bus.post({
		message: {
			kind: 'result-report',
			from: 'flauz.agent.worker-1',
			to: 'flauz.agent',
			payload: { taskId: ((delegation.message as { payload: { taskId: string } }).payload).taskId, outcome: 'ok', evidenceIds: [], summary: 'the log search found request id req-42' },
		},
	});
	const ingested = await ingestResultReport(store, {
		graphId,
		stepId: 'S-01',
		messageId: report.id,
		outcome: 'ok',
		summary: 'the log search found request id req-42',
		fromAgent: 'flauz.agent.worker-1',
	});
	assert.match(ingested.origin, /^a2a:flauz\.agent\.worker-1$/);
	const received = store.journalRows.find((row) => row.type === 'result-received');
	assert.equal(received?.origin, 'a2a:flauz.agent.worker-1');
	assert.equal(received?.payload.messageId, report.id);
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string }> };
	assert.equal(state.steps['S-01'].status, 'succeeded', 'the delegated step completed via the report');
	assert.equal(state.steps['S-02'].status, 'ready', 'the dependent unblocked');
	// a failed report maps to a failed step (policy owns the retry)
	const failed = await bus.post({
		message: {
			kind: 'result-report',
			from: 'flauz.agent.worker-1',
			to: 'flauz.agent',
			payload: { taskId: ((delegation.message as { payload: { taskId: string } }).payload).taskId, outcome: 'failed', evidenceIds: [], summary: 'the worker could not reach the logs' },
		},
	});
	// (S-01 already succeeded; a second report for it is rejected by the machine)
	await assert.rejects(
		() => ingestResultReport(store, { graphId, stepId: 'S-01', messageId: failed.id, outcome: 'failed', summary: 'x', fromAgent: 'flauz.agent.worker-1' }),
		(error: unknown) => /not allowed from step status succeeded/.test(messageOf(error)),
	);
});

test('steering relay carries mid-run steering for a delegated step', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [{ stepId: 'S-01', title: 'long task', instruction: 'keep working' }]);
	const bus = new A2ABus(root);
	await delegateStep(store, bus, { graphId, stepId: 'S-01', targetAgent: 'flauz.agent.worker-1', reason: 'operator-choice' });
	const steering = buildSteeringRelay(store, { graphId, stepId: 'S-01', message: 'focus on the auth logs instead' });
	const posted = await bus.post({
		message: { kind: 'steering-relay', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: steering },
	});
	assert.equal(posted.message.kind, 'steering-relay');
	const mailbox = bus.collect({ agentId: 'flauz.agent.worker-1' });
	const steeringMessage = mailbox.messages.find((message) => message.kind === 'steering-relay');
	assert.equal(steeringMessage?.payload.message, 'focus on the auth logs instead');
});

// ---------------------------------------------------------------------------
// claims + leases at the graph level, mirrored as bus notices
// ---------------------------------------------------------------------------

test('graph-level claims are exclusive and mirrored as resource-claim notices', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [{ stepId: 'S-01', title: 'shared work', instruction: 'work on a shared file' }]);
	const bus = new A2ABus(root);
	const claim = await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'flauz.agent.worker-1', actor: 'agent', origin: 'test:routing' });
	assert.equal(claim.payload.claimId, 'C-001-01');
	// mirror the claim as a bus notice (a claim IS a lease on the bus)
	const notice = await mirrorResourceClaim(bus, {
		action: 'acquire',
		resource: stepResourceId(graphId, 'S-01'),
		holder: 'flauz.agent.worker-1',
		leaseUntil: 1700000060000,
	});
	assert.match(notice.messageId, /^M-\d{6}$/);
	// another agent starting the claimed step records a conflict notice (v0 informational)
	await store.startStep({ graphId, stepId: 'S-01', runnerId: 'flauz.agent.worker-2', actor: 'agent', origin: 'test:routing' });
	const conflicts = store.journalRows.filter((row) => row.type === 'conflict-noticed');
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].payload.violation, 'claim');
	// release mirrors as a release notice
	await store.releaseClaim({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:routing' });
	await mirrorResourceClaim(bus, { action: 'release', resource: stepResourceId(graphId, 'S-01'), holder: 'flauz.agent.worker-1' });
	const notices = JSON.parse(readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n')[1]);
	assert.equal(notices.kind, 'resource-claim');
	assert.equal(notices.payload.action, 'release');
	assert.equal(notices.payload.leaseUntil, null);
});

test('leases expire and recovery frees them (with an expiry notice on the bus)', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [{ stepId: 'S-01', title: 'leased work', instruction: 'work under lease' }]);
	const bus = new A2ABus(root);
	const lease = await store.acquireLease({ graphId, stepId: 'S-01', holder: 'flauz.agent.worker-1', ttlMs: 1000, actor: 'agent', origin: 'test:routing' });
	assert.match(String(lease.payload.leaseId), /^L-001-01-1$/);
	await mirrorResourceClaim(bus, { action: 'acquire', resource: stepResourceId(graphId, 'S-01'), holder: 'flauz.agent.worker-1', leaseUntil: 1700000001000 });
	// renewal extends
	await store.renewLease({ graphId, stepId: 'S-01', ttlMs: 5000, actor: 'agent', origin: 'test:routing' });
	// restart AFTER expiry: recovery marks it expired and the step becomes claimable again
	const reloaded = new OrchestrationStore(root, { clock: makeClock(1700000090000).clock, taskPort: fakeTaskPort() });
	const report = await recoveryScan(reloaded, { now: FAR_FUTURE });
	assert.ok(report.actions.includes('G-001:lease-expired:L-001-01-1'), JSON.stringify(report.actions));
	const state = reloaded.getGraphState(graphId) as { leases: Record<string, unknown> };
	assert.deepEqual(state.leases, {}, 'the expired lease is freed');
	// another holder can now lease the step
	reloaded.acquireLease({ graphId, stepId: 'S-01', holder: 'flauz.agent.worker-2', ttlMs: 10000, actor: 'agent', origin: 'test:routing' });
	// and the expiry mirrors onto the bus
	await mirrorResourceClaim(bus, { action: 'expire', resource: stepResourceId(graphId, 'S-01'), holder: 'flauz.agent.worker-1' });
	const lastNotice = JSON.parse(readFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8').split('\n').filter((line: string) => line.length > 0).slice(-1)[0]);
	assert.equal(lastNotice.payload.action, 'expire');
});

test('a delegated step that crashes recovers and replays (delegation + durability compose)', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [
		{ stepId: 'S-01', title: 'delegated', instruction: 'do the delegated work' },
		{ stepId: 'S-02', title: 'local', instruction: 'local wrap-up', dependsOn: ['S-01'] },
	]);
	const bus = new A2ABus(root);
	await delegateStep(store, bus, { graphId, stepId: 'S-01', targetAgent: 'flauz.agent.worker-1', reason: 'capability-match' });
	// the parent crashes; a fresh store + bus reload
	const reloaded = new OrchestrationStore(root, { clock: makeClock(1700000050000).clock, taskPort: fakeTaskPort() });
	const report = await recoveryScan(reloaded, { now: FAR_FUTURE });
	// the delegated attempt is REMOTE: the parent's crash did not interrupt it
	assert.equal(report.actions.includes('G-001:step-interrupted:S-01'), false, JSON.stringify(report.actions));
	const preReport = reloaded.getGraphState(graphId) as { steps: Record<string, { status: string }> };
	assert.equal(preReport.steps['S-01'].status, 'running', 'the remote attempt is still in flight');
	// the worker's report still lands on the (durable) bus after the restart
	const reloadedBus = new A2ABus(root);
	const reportMessage = await reloadedBus.post({
		message: {
			kind: 'result-report',
			from: 'flauz.agent.worker-1',
			to: 'flauz.agent',
			payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: [], summary: 'completed after the parent restart' },
		},
	});
	await ingestResultReport(reloaded, { graphId, stepId: 'S-01', messageId: reportMessage.id, outcome: 'ok', summary: 'completed after the parent restart', fromAgent: 'flauz.agent.worker-1' });
	// the local runtime drains the rest
	const drive = await driveGraph(reloaded, {
		graphId,
		sink: { async run() { return { ok: true, value: 'local ok', replayed: false }; } },
		now: FAR_FUTURE,
		runnerId: 're-drive',
	});
	assert.equal(drive.completed, true);
	const state = reloaded.getGraphState(graphId) as { graphStatus: string };
	assert.equal(state.graphStatus, 'completed');
});

test('delegation requires a T-task link (standalone graphs cannot post task-delegations)', async () => {
	const root = makeRoot();
	const { store, graphId } = await approvedGraph(root, [{ stepId: 'S-01', title: 'orphan', instruction: 'no task link' }], false);
	const bus = new A2ABus(root);
	await assert.rejects(
		() => delegateStep(store, bus, { graphId, stepId: 'S-01', targetAgent: 'flauz.agent.worker-1', reason: 'operator-choice' }),
		(error: unknown) => /linked to a T-task/.test(messageOf(error)),
	);
});
