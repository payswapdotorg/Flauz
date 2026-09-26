/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Wave 4 Lane K, M3 - A2A bus tests, G side.
 *
 * End-to-end: the flauz.a2a.* commands round-trip through the REAL core
 * service (core/service.mjs spawned over stdio) - post mints seq/id, collect
 * drains the per-agent mailbox, cursors persist so a restarted service
 * replays nothing already drained, and the on-disk journal is canonical JSONL
 * under workspace-committed .flauz/ (DL-9).
 *
 * Unit-level (the bus directly): the journal loader rejects tampering (a
 * non-canonical line, a seq gap, a structurally invalid row) and collect
 * peeking does not advance the cursor.
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, match, throws } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeamClient } from '../src/seamClient.ts';
import { A2ABus } from '../core/a2a.mjs';

function makeWorkspace(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-a2a-'));
}

const DELEGATION = {
	kind: 'task-delegation',
	from: 'flauz.agent',
	to: 'flauz.agent.worker-1',
	payload: { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review the package.json structure.', workflowId: 'W-001' },
};

test('flauz.a2a.post / collect / list round-trip through the real service', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		const posted = await client.request<{ id: string; seq: number; message: { id: string } }>('flauz.a2a.post', { message: DELEGATION });
		strictEqual(posted.id, 'M-000001', 'the bus mints the id from seq');
		strictEqual(posted.message.id, 'M-000001');
		await client.request('flauz.a2a.post', { message: { kind: 'steering-relay', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: { taskId: 'T-001', message: 'Focus on the dependency section only.' } } });

		const inbox = await client.request<{ messages: Array<{ id: string; kind: string; to: string }> }>('flauz.a2a.collect', { agentId: 'flauz.agent.worker-1' });
		strictEqual(inbox.messages.length, 2, 'both messages addressed to the worker');
		strictEqual(inbox.messages[0].kind, 'task-delegation');
		strictEqual(inbox.messages[1].kind, 'steering-relay');

		const again = await client.request<{ messages: unknown[] }>('flauz.a2a.collect', { agentId: 'flauz.agent.worker-1' });
		strictEqual(again.messages.length, 0, 'collect drains: nothing replays');

		const peeked = await client.request<{ messages: unknown[] }>('flauz.a2a.collect', { agentId: 'flauz.agent.worker-1', consume: false });
		strictEqual(peeked.messages.length, 0, 'peek after drain is empty and does not resurrect');

		const listed = await client.request<{ agents: Array<{ agentId: string; pending: number }> }>('flauz.a2a.list');
		deepStrictEqual(listed.agents, [
			{ agentId: 'flauz.agent', pending: 0 },
			{ agentId: 'flauz.agent.worker-1', pending: 0 },
		], 'both agents drained, sorted by id');

		const parentInbox = await client.request<{ messages: Array<{ id: string }> }>('flauz.a2a.collect', { agentId: 'flauz.agent' });
		strictEqual(parentInbox.messages.length, 0, 'the parent sent both messages; its own mailbox is empty');

		const journal = readFileSync(join(workspace, '.flauz', 'a2a', 'messages.jsonl'), 'utf-8');
		match(journal, /\n$/, 'journal ends with a newline');
		const lines = journal.split('\n').filter(line => line.length > 0);
		strictEqual(lines.length, 2);
		strictEqual(JSON.parse(lines[0]).id, 'M-000001');
		strictEqual(JSON.parse(lines[1]).id, 'M-000002');
		const cursors = JSON.parse(readFileSync(join(workspace, '.flauz', 'a2a', 'cursors.json'), 'utf-8'));
		strictEqual(cursors.$schema, 'flauz.a2a.cursors/v1');
		strictEqual(cursors.cursors['flauz.agent.worker-1'], 3, 'cursor at journal high-water + 1');
	} finally {
		await client.dispose();
	}
});

test('a restarted service replays nothing already drained', async () => {
	const workspace = makeWorkspace();
	let client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		await client.request('flauz.a2a.post', { message: DELEGATION });
		await client.request('flauz.a2a.collect', { agentId: 'flauz.agent.worker-1' });
	} finally {
		await client.dispose();
	}
	client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		const drained = await client.request<{ messages: unknown[] }>('flauz.a2a.collect', { agentId: 'flauz.agent.worker-1' });
		strictEqual(drained.messages.length, 0, 'restart does not replay the drained message');
		await client.request('flauz.a2a.post', { message: { kind: 'result-report', from: 'flauz.agent.worker-1', to: 'flauz.agent', inReplyTo: 'M-000001', payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: ['E-000001'], summary: 'Reviewed.' } } });
		const fresh = await client.request<{ messages: Array<{ id: string; kind: string }> }>('flauz.a2a.collect', { agentId: 'flauz.agent' });
		strictEqual(fresh.messages.length, 1, 'only the post-restart message arrives');
		strictEqual(fresh.messages[0].kind, 'result-report');
	} finally {
		await client.dispose();
	}
});

test('invalid a2a input surfaces as seam rejections (typed gates)', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		await assertRejects(client, 'flauz.a2a.post', { message: { ...DELEGATION, kind: 'gossip' } }, /kind must be one of/);
		await assertRejects(client, 'flauz.a2a.post', { message: { ...DELEGATION, to: 'flauz.agent' } }, /from and to must differ/);
		await assertRejects(client, 'flauz.a2a.post', { message: { ...DELEGATION, inReplyTo: 'M-000999' } }, /does not reference a journaled message/);
		await assertRejects(client, 'flauz.a2a.post', { message: { ...DELEGATION, payload: { ...DELEGATION.payload, taskId: 'T-1' } } }, /taskId must match/);
		await assertRejects(client, 'flauz.a2a.collect', { agentId: 'has spaces' }, /agentId must be an agent id/);
	} finally {
		await client.dispose();
	}
});

async function assertRejects(client: SeamClient, cmd: string, args: Record<string, unknown>, pattern: RegExp): Promise<void> {
	let caught: unknown;
	try {
		await client.request(cmd, args);
	} catch (error) {
		caught = error;
	}
	ok(caught instanceof Error, `${cmd} must reject`);
	match((caught as Error).message, pattern);
}

test('A2ABus (direct): a corrupt journal refuses to load, byte-strict', () => {
	const workspace = makeWorkspace();
	const bus = new A2ABus(workspace);
	bus.post({ message: DELEGATION });
	const journalPath = join(workspace, '.flauz', 'a2a', 'messages.jsonl');
	const good = readFileSync(journalPath, 'utf-8');

	// Non-canonical bytes (keys reordered): same JSON value, different bytes.
	const reordered = `{"seq":1,"kind":${JSON.stringify(DELEGATION.kind)},"from":${JSON.stringify(DELEGATION.from)},"to":${JSON.stringify(DELEGATION.to)},"id":"M-000001","ts":1000,"$schema":"flauz.a2a/v0","inReplyTo":null,"payload":${JSON.stringify(DELEGATION.payload)}}\n`;
	writeFileSync(journalPath, reordered);
	throws(() => new A2ABus(workspace), /not canonical/, 'byte drift is rejected');

	// Seq gap: line 2 carrying seq 3.
	writeFileSync(journalPath, good + good.replace(/"seq":1/, '"seq":3').replace(/"id":"M-000001"/, '"id":"M-000003"'));
	throws(() => new A2ABus(workspace), /seq must be the 1-based journal position/);

	// Structurally invalid row survives neither loader nor validator.
	writeFileSync(journalPath, good + '{"$schema":"flauz.a2a/v0"}\n');
	throws(() => new A2ABus(workspace), /malformed/);
});

test('A2ABus (direct): peek does not advance the cursor; inReplyTo must reference the journal', () => {
	const workspace = makeWorkspace();
	const bus = new A2ABus(workspace);
	bus.post({ message: DELEGATION });
	const peeked = bus.collect({ agentId: 'flauz.agent.worker-1', consume: false });
	strictEqual(peeked.messages.length, 1, 'peek sees the message');
	const rePeeked = bus.collect({ agentId: 'flauz.agent.worker-1', consume: false });
	strictEqual(rePeeked.messages.length, 1, 'peek did not consume');
	const drained = bus.collect({ agentId: 'flauz.agent.worker-1' });
	strictEqual(drained.messages.length, 1, 'drain delivers it once');
	const empty = bus.collect({ agentId: 'flauz.agent.worker-1' });
	strictEqual(empty.messages.length, 0, 'then the mailbox is empty');
	throws(() => bus.post({ message: { kind: 'result-report', from: 'flauz.agent.worker-1', to: 'flauz.agent', inReplyTo: 'M-000999', payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: [], summary: 'n/a' } } }), /does not reference a journaled message/);
	mkdirSync(join(workspace, '.flauz', 'a2a'), { recursive: true });
	const cursors = JSON.parse(readFileSync(join(workspace, '.flauz', 'a2a', 'cursors.json'), 'utf-8'));
	strictEqual(cursors.cursors['flauz.agent.worker-1'], 2, 'cursor written at high-water + 1 after the drain');
});
