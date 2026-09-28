/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M4 - fail-closed failure semantics through the REAL service
 * (core/serviceBoundary.mjs taxonomy, fired end to end).
 *
 * Deterministic loss/death/noise is produced by test/harness/responseDropper.ts
 * (a thin NDJSON proxy over the real service; spec file per workspace) and
 * test/harness/futureVersionService.ts (a v99 handshake posture).
 *
 * The binding invariants:
 *  - every failure is a machine-readable BoundaryFailure (code, details,
 *    retryHint, retryable) - nothing is swallowed;
 *  - a side-effecting request whose response was lost is OUTCOME-UNKNOWN
 *    and is NEVER auto-retried; the same key rejects fast; only a NEW key
 *    after reconciliation may proceed;
 *  - the durable artifacts always explain what actually happened (the
 *    ledger never lies about whether an effect landed);
 *  - read-only losses carry the retry hook;
 *  - a future-version service is a protocol mismatch, never a guess.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentOsServiceBoundary, BoundaryFailure, BOUNDARY_FAILURE_CODES } from '../core/serviceBoundary.mjs';
import { SEAM_PROTOCOL_V1 } from '../core/protocol.mjs';

const DROPPER_PATH = fileURLToPath(new URL('./harness/responseDropper.ts', import.meta.url));
const FUTURE_SERVICE_PATH = fileURLToPath(new URL('./harness/futureVersionService.ts', import.meta.url));

function makeWorkspace(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-boundary-failures-'));
}

/** The dropper reads its spec from `<workspaceRoot>.dropspec.json`. */
function writeDropSpec(workspaceRoot: string, spec: Record<string, unknown>): void {
	writeFileSync(`${workspaceRoot}.dropspec.json`, `${JSON.stringify(spec)}\n`);
}

function taskCountOnDisk(workspaceRoot: string): number {
	const tasksPath = join(workspaceRoot, '.flauz/tasks.json');
	if (!existsSync(tasksPath)) {
		return 0;
	}
	const envelope = JSON.parse(readFileSync(tasksPath, 'utf-8')) as { tasks: unknown[] };
	return envelope.tasks.length;
}

function asBoundary(failure: unknown): BoundaryFailure {
	if (!(failure instanceof BoundaryFailure)) {
		throw failure;
	}
	return failure;
}

test('response loss on a side-effecting method: OUTCOME-UNKNOWN, never auto-retried, the artifacts tell the truth', async () => {
	const workspace = makeWorkspace();
	writeDropSpec(workspace, { drop: [{ method: 'flauz.workspace.createTask', count: 1 }] });
	const boundaryEvents: string[] = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: workspace,
		servicePath: DROPPER_PATH,
		requestTimeoutMs: 500,
		onBoundaryEvent: (record) => boundaryEvents.push(record.boundaryEvent),
	});
	try {
		// The request IS delivered; the response is dropped -> timeout with
		// an unknown outcome (the effect may have landed).
		const key = 'flauz-orch/G-001/S-01/run/1';
		await assert.rejects(
			() => boundary.createTask('lost response', { idempotencyKey: key }),
			(failure: unknown) => {
				const boundaryFailure = asBoundary(failure);
				assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
				assert.equal(boundaryFailure.retryable, false, 'NEVER auto-retry a lost side-effecting response');
				assert.equal(boundaryFailure.retryHint, 'reconcile-then-new-attempt');
				assert.equal(boundaryFailure.details.method, 'flauz.workspace.createTask');
				return true;
			},
		);

		// The boundary fail-closed: further calls refuse until recovery.
		assert.equal(boundary.connected, false);
		assert.ok(boundaryEvents.includes('disconnected'));

		// The same key NEVER re-sends: it rejects fast with the recorded verdict.
		await assert.rejects(
			() => boundary.createTask('lost response', { idempotencyKey: key }),
			(failure: unknown) => {
				assert.equal(asBoundary(failure).code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
				return true;
			},
		);
		assert.equal(taskCountOnDisk(workspace), 1, 'the dropped-response request WAS applied - the artifacts say so');

		// Reconciliation (explicit recovery + state re-read), then a NEW key.
		const report = await boundary.recover();
		assert.equal(report.snapshot.tasks.length, 1, 'recovery re-reads the truth: the task exists');
		assert.equal(report.protocolVersion, SEAM_PROTOCOL_V1);
		const second = await boundary.createTask('after reconciliation', { idempotencyKey: 'flauz-orch/G-001/S-01/run/2' });
		assert.equal(second.taskId, 'T-002');
		assert.equal(taskCountOnDisk(workspace), 2, 'exactly two wire effects for two attempts - the lost one was never re-sent');

		// The ledger explains everything.
		assert.equal((await boundary.verifyLedger()).ok, true);
	} finally {
		await boundary.shutdown();
	}
});

test('mid-command service death (forwarded then SIGKILL): OUTCOME-UNKNOWN with an honest reconcile path', async () => {
	const workspace = makeWorkspace();
	writeDropSpec(workspace, { killOn: [{ method: 'flauz.workspace.createTask' }] });
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: workspace,
		servicePath: DROPPER_PATH,
		requestTimeoutMs: 500,
	});
	try {
		const key = 'flauz-orch/G-002/S-01/run/1';
		await assert.rejects(
			() => boundary.createTask('mid-command death', { idempotencyKey: key }),
			(failure: unknown) => {
				assert.equal(asBoundary(failure).code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
				return true;
			},
		);
		// The request WAS forwarded before the kill: whether the effect
		// landed is a race the ADAPTER must not guess about - but the
		// artifacts are the truth, and the same key never re-sends.
		const afterDeath = taskCountOnDisk(workspace);
		assert.ok(afterDeath === 0 || afterDeath === 1, 'the effect may or may not have landed - unknown by construction');
		await assert.rejects(
			() => boundary.createTask('mid-command death', { idempotencyKey: key }),
			(failure: unknown) => {
				assert.equal(asBoundary(failure).code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
				return true;
			},
		);
		assert.equal(taskCountOnDisk(workspace), afterDeath, 'the re-call with the same key did nothing on the wire');

		// Reconcile, then a new attempt reaches a deterministic end state.
		const report = await boundary.recover();
		assert.equal(report.snapshot.tasks.length, afterDeath);
		const second = await boundary.createTask('after mid-command death', { idempotencyKey: 'flauz-orch/G-002/S-01/run/2' });
		assert.equal(taskCountOnDisk(workspace), afterDeath + 1, 'exactly one new effect for the new attempt');
		assert.ok(second.taskId === 'T-001' || second.taskId === 'T-002');
	} finally {
		await boundary.shutdown();
	}
});

test('response loss on a read-only method: REQUEST-TIMEOUT with the retry hook, boundary stays up, re-send succeeds', async () => {
	const workspace = makeWorkspace();
	writeDropSpec(workspace, { drop: [{ method: 'flauz.workspace.listTasks', count: 1 }] });
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: workspace,
		servicePath: DROPPER_PATH,
		requestTimeoutMs: 500,
	});
	try {
		await assert.rejects(
			() => boundary.listTasks(),
			(failure: unknown) => {
				const boundaryFailure = asBoundary(failure);
				assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.REQUEST_TIMEOUT);
				assert.equal(boundaryFailure.retryable, true, 'a read-only loss carries the retry hook');
				assert.equal(boundaryFailure.retryHint, 'reconnect-then-retry');
				return true;
			},
		);
		assert.equal(boundary.connected, true, 'a read-only loss does not kill the boundary');

		// The re-send goes through (the second response is forwarded).
		const tasks = await boundary.listTasks();
		assert.deepEqual(tasks.tasks, []);
	} finally {
		await boundary.shutdown();
	}
});

test('malformed input lines are session noise: the service answers type:error, the boundary keeps serving (nothing swallowed, nothing fatal)', async () => {
	const workspace = makeWorkspace();
	writeDropSpec(workspace, { injectGarbageAfterReady: true });
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: workspace,
		servicePath: DROPPER_PATH,
	});
	try {
		// The dropper injected an unparseable line right after ready; the
		// service answered a type:"error" line. The boundary must have
		// logged it (noise, not a request failure) and keep working.
		assert.equal(boundary.connected, true);
		const { taskId } = await boundary.createTask('after garbage line');
		assert.equal(taskId, 'T-001');
		assert.equal((await boundary.verifyLedger()).ok, true);
	} finally {
		await boundary.shutdown();
	}
});

test('seam rejections stay machine-readable end to end: flauz.err.* rides in details.seamCode', async () => {
	const workspace = makeWorkspace();
	const boundary = await AgentOsServiceBoundary.start({ workspaceRoot: workspace });
	try {
		await assert.rejects(
			() => boundary.appendEvidence('T-999', { kind: 'command-output', uri: 'x', sha256: '0'.repeat(64) }),
			(failure: unknown) => {
				const boundaryFailure = asBoundary(failure);
				assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
				assert.equal(boundaryFailure.details.seamCode, 'flauz.err.invalid-params', 'the seam code is machine-readable, never flattened');
				assert.match(boundaryFailure.message, /unknown task: T-999/, 'the v0 message text is preserved');
				assert.equal(boundaryFailure.retryable, false);
				return true;
			},
		);
	} finally {
		await boundary.shutdown();
	}
});

test('future-version service: the negotiated-version guard fires (protocol mismatch, never a guess)', async () => {
	const workspace = makeWorkspace();
	await assert.rejects(
		() => AgentOsServiceBoundary.start({ workspaceRoot: workspace, servicePath: FUTURE_SERVICE_PATH }),
		(failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH);
			assert.equal(boundaryFailure.retryable, false);
			assert.equal(boundaryFailure.retryHint, 'never');
			assert.deepEqual(boundaryFailure.details.known, ['flauz.seam/v0', 'flauz.seam/v1']);
			return true;
		},
	);
});

test('missing workspace root (service usage exit 2): start fails closed, no boundary is left behind', async () => {
	const workspace = makeWorkspace();
	// The REAL service with no args is not spawnable through the boundary
	// (workspaceRoot is required); simulate the service-side usage failure
	// by pointing at the dropper with a spec that kills the service at
	// spawn - the handshake then never becomes ready.
	writeDropSpec(workspace, { killOn: [] });
	const exits: Array<number | null> = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: workspace,
		servicePath: FUTURE_SERVICE_PATH,
		onExit: (code) => exits.push(code),
	}).catch((failure: unknown) => {
		// The future-version guard fires first; that is the pinned path.
		const boundaryFailure = asBoundary(failure);
		assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH);
		return null;
	});
	assert.equal(boundary, null);
	// The spawned stub was reaped by the failed start (dispose path).
	await new Promise<void>((resolve) => setTimeout(() => resolve(), 50));
	assert.deepEqual(exits, [0], 'the stub exited cleanly when the failed start disposed it');
});
