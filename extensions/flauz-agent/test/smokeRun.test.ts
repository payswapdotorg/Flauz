/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Smoke run: one continuous pass over the real service exercising the whole
 * command surface end-to-end (handshake -> task lifecycle -> evidence ->
 * ledger verification -> checkpoint -> clean shutdown). Prints a trace for
 * the verification receipts.
 */

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeamClient } from '../src/seamClient.ts';

test('smokeRun: full command-surface pass over the real service', async () => {
	const workspace = mkdtempSync(join(tmpdir(), 'flauz-smoke-'));
	const client = await SeamClient.start({ workspaceRoot: workspace });
	const trace: string[] = [];

	const { taskId } = await client.createTask('smoke run task');
	trace.push(`createTask -> ${taskId}`);

	await client.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: { plan: 'smoke' } });
	let task = (await client.getTask(taskId)).task;
	trace.push(`submit-plan -> ${task.status}`);
	strictEqual(task.status, 'awaiting-approval');

	await client.appendEvent(taskId, { actor: 'human', type: 'approve', payload: {} });
	task = (await client.getTask(taskId)).task;
	trace.push(`approve -> ${task.status}`);
	strictEqual(task.status, 'execute');

	const artifact = 'flauz-smoke-output';
	const sha256 = createHash('sha256').update(artifact, 'utf-8').digest('hex');
	const evidence = await client.appendEvidence(taskId, { kind: 'command-output', uri: '.flauz/artifacts/T-001/command-output-1.txt', sha256 });
	trace.push(`appendEvidence -> ${evidence.evidenceId} (seq ${evidence.seq})`);

	const checkpoint = await client.createCheckpoint(taskId, 'req-smoke-1');
	trace.push(`createCheckpoint -> ${String(checkpoint.checkpointRef)}`);
	ok(checkpoint.checkpointRef !== null && checkpoint.checkpointRef.startsWith('flauz-ckpt-'));

	await client.appendEvent(taskId, { actor: 'agent', type: 'report', payload: { evidenceId: evidence.evidenceId } });
	await client.appendEvent(taskId, { actor: 'tool', type: 'verify-pass', payload: { ledger: 'ok' } });
	task = (await client.getTask(taskId)).task;
	trace.push(`report + verify-pass -> ${task.status}`);
	strictEqual(task.status, 'awaiting-signoff');

	await client.appendEvent(taskId, { actor: 'human', type: 'sign-off', payload: {} });
	task = (await client.getTask(taskId)).task;
	trace.push(`sign-off -> ${task.status}`);
	strictEqual(task.status, 'done');

	const ledger = await client.verifyLedger();
	trace.push(`verifyLedger -> ok=${String(ledger.ok)} rows=${String(ledger.rows)}`);
	ok(ledger.ok, 'ledger hash chain must verify');
	strictEqual(ledger.rows, 1);

	// Checkpoint on a terminal task yields null (documented behavior).
	const terminalCheckpoint = await client.createCheckpoint(taskId, 'req-smoke-2');
	strictEqual(terminalCheckpoint.checkpointRef, null);

	const rawLedger = readFileSync(join(workspace, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
	const row = JSON.parse(rawLedger.trim());
	strictEqual(row.taskId, taskId);
	strictEqual(row.kind, 'command-output');
	strictEqual(row.sha256, sha256);
	strictEqual(row.prev, null, 'first row has null prev');

	await client.dispose();
	console.log(`smokeRun trace:\n  ${trace.join('\n  ')}`);
});
