/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FIXED_TS, bootWorkspace, nodeFsPort, steppingClock, type TestWorkspace } from './helpers.ts';
import { serializeEnvelope, type Task } from '../src/api.ts';
import { TaskService } from '../src/taskService.ts';

function envelopeFile(ws: TestWorkspace): string {
	return path.join(ws.root, '.flauz', 'tasks.json');
}

function seedTask(id: string, title: string, updatedAt: number): Record<string, unknown> {
	return {
		id,
		title,
		status: 'plan',
		events: [],
		timing: { created: updatedAt, updatedAt },
		changes: [],
	};
}

test('bootstrap creates .flauz/tasks.json and .flauz/evidence/ledger.jsonl', async () => {
	const ws = await bootWorkspace();
	const envelope = await fs.readFile(envelopeFile(ws), { encoding: 'utf-8' });
	assert.equal(envelope, '{\n  "$schema": "flauz.tasks/v0",\n  "tasks": []\n}\n');
	const ledger = await fs.readFile(path.join(ws.root, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' });
	assert.equal(ledger, '');
});

test('bootstrap is idempotent: existing envelope bytes are preserved', async () => {
	const ws = await bootWorkspace();
	await ws.tasks.createTask('keep me');
	const before = await fs.readFile(envelopeFile(ws), { encoding: 'utf-8' });
	const second = new TaskService({ root: ws.root, fs: nodeFsPort() });
	await second.bootstrap();
	const after = await fs.readFile(envelopeFile(ws), { encoding: 'utf-8' });
	assert.equal(after, before);
});

test('load rejects an envelope with the wrong $schema', async () => {
	const ws = await bootWorkspace();
	await fs.writeFile(envelopeFile(ws), JSON.stringify({ $schema: 'flauz.tasks/v9', tasks: [] }, null, 2), { encoding: 'utf-8' });
	const service = new TaskService({ root: ws.root, fs: nodeFsPort() });
	await assert.rejects(service.createTask('x'), /\$schema must be 'flauz\.tasks\/v0'/);
});

test('round-trip identity and determinism: write->read->write is byte-identical', async () => {
	const first = await bootWorkspace();
	const firstId = (await first.tasks.createTask('same ops')).id;
	await first.tasks.appendEvent(firstId, { ts: FIXED_TS, actor: 'human', type: 'comment', payload: { text: 'hello' } });
	const bytes = await fs.readFile(envelopeFile(first), { encoding: 'utf-8' });
	// Literal round-trip: parsing the stored bytes and re-serializing changes nothing.
	assert.equal(serializeEnvelope(JSON.parse(bytes)), bytes);
	// Determinism: the same logical ops on a fresh workspace produce the same bytes.
	const second = await bootWorkspace();
	const secondId = (await second.tasks.createTask('same ops')).id;
	await second.tasks.appendEvent(secondId, { ts: FIXED_TS, actor: 'human', type: 'comment', payload: { text: 'hello' } });
	assert.equal(await fs.readFile(envelopeFile(second), { encoding: 'utf-8' }), bytes);
});

test('canonical bytes: sorted keys, 2-space indent, single trailing newline', async () => {
	const ws = await bootWorkspace({ clock: () => FIXED_TS });
	await ws.tasks.createTask('Fix login flow');
	const expected = ''
		+ '{\n'
		+ '  "$schema": "flauz.tasks/v0",\n'
		+ '  "tasks": [\n'
		+ '    {\n'
		+ '      "changes": [],\n'
		+ '      "events": [],\n'
		+ '      "id": "T-001",\n'
		+ '      "status": "plan",\n'
		+ '      "timing": {\n'
		+ `        "created": ${FIXED_TS},\n`
		+ `        "updatedAt": ${FIXED_TS}\n`
		+ '      },\n'
		+ '      "title": "Fix login flow"\n'
		+ '    }\n'
		+ '  ]\n'
		+ '}\n';
	assert.equal(await fs.readFile(envelopeFile(ws), { encoding: 'utf-8' }), expected);
});

test('createTask allocates T-001 then T-002 with timing from the clock', async () => {
	const ws = await bootWorkspace({ clock: () => FIXED_TS });
	const first = await ws.tasks.createTask('first');
	const second = await ws.tasks.createTask('second');
	assert.equal(first.id, 'T-001');
	assert.equal(second.id, 'T-002');
	assert.equal(first.status, 'plan');
	assert.equal(first.title, 'first');
	assert.deepEqual(first.timing, { created: FIXED_TS, updatedAt: FIXED_TS });
});

test('id allocation continues from the highest existing task id', async () => {
	const ws = await bootWorkspace();
	await fs.writeFile(envelopeFile(ws), JSON.stringify({
		$schema: 'flauz.tasks/v0',
		tasks: [seedTask('T-001', 'a', FIXED_TS), seedTask('T-007', 'b', FIXED_TS)],
	}, null, 2), { encoding: 'utf-8' });
	const service = new TaskService({ root: ws.root, fs: nodeFsPort(), clock: () => FIXED_TS });
	const task = await service.createTask('next');
	assert.equal(task.id, 'T-008');
});

test('plain (non-transition) events append verbatim without touching status', async () => {
	const ws = await bootWorkspace({ clock: steppingClock() });
	const task = await ws.tasks.createTask('observed');
	const event = { ts: 5555, actor: 'human' as const, type: 'comment', payload: { text: 'looks good' } };
	const updated = await ws.tasks.appendEvent(task.id, event);
	assert.equal(updated.status, 'plan');
	assert.equal(updated.events.length, 1);
	assert.deepEqual(updated.events[0], event);
	assert.equal(updated.timing.created, 1000);
	assert.equal(updated.timing.updatedAt, 2000);
});

test('recordEvidence adds a timeline event and a changes entry for changesets only', async () => {
	const ws = await bootWorkspace({ clock: steppingClock() });
	const task = await ws.tasks.createTask('evidenced');
	const withNote = await ws.tasks.recordEvidence(task.id, { evidenceId: 'E-000001', seq: 1, kind: 'changeset', uri: 'file:///w/a.ts', sha256: 'a'.repeat(64), note: 'initial diff' });
	assert.equal(withNote.changes.length, 1);
	assert.deepEqual(withNote.changes[0], { uri: 'file:///w/a.ts', checkpointRef: null });
	const evidenceEvent = withNote.events.find(e => e.type === 'evidence');
	assert.deepEqual(evidenceEvent?.payload, { evidenceId: 'E-000001', seq: 1, kind: 'changeset', uri: 'file:///w/a.ts', sha256: 'a'.repeat(64), note: 'initial diff' });
	const screenshot = await ws.tasks.recordEvidence(task.id, { evidenceId: 'E-000002', seq: 2, kind: 'screenshot', uri: 'file:///w/s.png', sha256: 'b'.repeat(64) });
	assert.equal(screenshot.changes.length, 1);
	const screenshotEvent = screenshot.events.find(e => e.type === 'evidence' && e.payload.seq === 2);
	assert.equal('note' in (screenshotEvent?.payload ?? {}), false);
});

test('atomic writes leave no *.tmp residue under .flauz/', async () => {
	const ws = await bootWorkspace();
	const task = await ws.tasks.createTask('atomic');
	await ws.tasks.appendEvent(task.id, { ts: FIXED_TS, actor: 'agent', type: 'comment', payload: {} });
	await ws.tasks.recordEvidence(task.id, { evidenceId: 'E-000001', seq: 1, kind: 'changeset', uri: 'file:///w/a.ts', sha256: 'a'.repeat(64) });
	const files: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const child = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(child);
			} else {
				files.push(path.relative(ws.root, child));
			}
		}
	};
	await walk(path.join(ws.root, '.flauz'));
	assert.deepEqual(files.sort(), ['.flauz/evidence/ledger.jsonl', '.flauz/tasks.json']);
});
