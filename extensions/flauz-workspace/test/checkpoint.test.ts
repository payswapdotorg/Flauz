/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — test/checkpoint.test.ts
 *
 *  The checkpoint interop decision matrix at HEAD 9bf9ae764da:
 *    - attested: a caller-held stopId (from ChatResultStream.externalEdit within a
 *      live request) is accepted, recorded on the timeline and in `changes`;
 *    - blocked: no stopId -> {checkpointRef: null} + a gap row in the evidence ledger
 *      (never a faked reference);
 *    - unknown tasks reject.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWorkspace } from './helpers.ts';
import { GAP_CHECKPOINT_URI } from '../src/checkpoint.ts';

test('attested path: stopId is returned, recorded in changes and on the timeline', async () => {
	const ws = await bootWorkspace();
	await ws.tasks.createTask('checkpointed');
	const outcome = await ws.checkpoints.create({ taskId: 'T-001', requestId: 'req-1', stopId: 'stop-abc' });
	assert.equal(outcome.checkpointRef, 'stop-abc');
	assert.equal(outcome.mode, 'attested');
	const task = await ws.tasks.getTask('T-001');
	assert.deepEqual(task.changes, [{ uri: 'flauz-checkpoint://stop-abc', checkpointRef: 'stop-abc' }]);
	const checkpointEvent = task.events[task.events.length - 1];
	assert.equal(checkpointEvent?.type, 'checkpoint');
	assert.equal(checkpointEvent?.actor, 'tool');
	assert.deepEqual(checkpointEvent?.payload, { mode: 'attested', requestId: 'req-1', stopId: 'stop-abc' });
});

test('blocked path: no stopId returns null and records a gap row (never a fake ref)', async () => {
	const ws = await bootWorkspace();
	await ws.tasks.createTask('blocked');
	const outcome = await ws.checkpoints.create({ taskId: 'T-001', requestId: 'req-2' });
	assert.equal(outcome.checkpointRef, null);
	assert.equal(outcome.mode, 'blocked');
	assert.equal(outcome.gapSeq, 1);
	const rows = await ws.ledger.readRows();
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.kind, 'note');
	assert.equal(rows[0]?.uri, GAP_CHECKPOINT_URI);
	assert.equal(rows[0]?.taskId, 'T-001');
	const verification = await ws.ledger.verify();
	assert.equal(verification.ok, true);
	const task = await ws.tasks.getTask('T-001');
	const checkpointEvent = task.events[task.events.length - 1];
	assert.deepEqual(checkpointEvent?.payload, { mode: 'blocked', requestId: 'req-2', gap: { uri: GAP_CHECKPOINT_URI, seq: 1 } });
});

test('unknown task rejects with the standard error', async () => {
	const ws = await bootWorkspace();
	await assert.rejects(
		ws.checkpoints.create({ taskId: 'T-009', requestId: 'req-x' }),
		/unknown task 'T-009'/,
	);
});
