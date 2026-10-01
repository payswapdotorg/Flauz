/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-115 (A-PROD-003-W2.2) — the failure-time non-completable signal.
 *
 * The finding (docs/FLAUZ-PROGRAM/findings/P2-FIX-115-late-graph-completion-signal.md):
 * a step that failed via finishStep(outcome: 'failed') while the mission graph
 * has no remaining path to completion produces NO signal at failure time; the
 * non-completable state surfaces only when a later completeGraph is rejected.
 *
 * The acceptance under test:
 *  - a failed finishStep on a step whose failure leaves no completable path
 *    emits a TYPED warning on the result carrying the non-completable reason;
 *  - the evidence ledger records the failure-time signal (a note row whose uri
 *    references the landed step-failed rowId);
 *  - existing legal completions stay byte-identical (the step-failed journal
 *    row payload keeps exactly [failureClass, message, retryPlanned], the
 *    completion-time rejection law is unchanged, retryable failures stay
 *    silent, and the retry path keeps working exactly as before).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore, type TaskPort } from '../core/orchStore.mjs';
import { journalLine } from '../core/orchestration.mjs';

/** The error-message extractor for assert predicates (unknown-safe). */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-p2fix115-'));
}

function makeStore(root: string, clockBase = 1700000000000, taskPort: TaskPort | null = null): OrchestrationStore {
	let value = clockBase;
	return new OrchestrationStore(root, { clock: () => (value += 1000), ...(taskPort !== null ? { taskPort } : {}) });
}

/** A capture fake for the taskPort (the evidence-ledger linkage). */
function makeCapturePort(): { port: TaskPort; appends: Array<{ taskId: string; row: Record<string, unknown> }> } {
	const appends: Array<{ taskId: string; row: Record<string, unknown> }> = [];
	const port: TaskPort = {
		async createTask() {
			return { taskId: 'T-001' };
		},
		async appendEvent() {
			return { task: null };
		},
		async appendEvidence(args: { taskId: string; row: Record<string, unknown> }) {
			appends.push(args);
			return { evidenceId: `E-${String(appends.length).padStart(6, '0')}`, seq: appends.length };
		},
	};
	return { port, appends };
}

async function runningStep(store: OrchestrationStore, graphId: string, stepId = 'S-01') {
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:p2fix115' });
	await store.startStep({ graphId, stepId, runnerId: 'runner-a', actor: 'agent', origin: 'test:p2fix115' });
}

// ---------------------------------------------------------------------------
// the early signal (the finding's core)
// ---------------------------------------------------------------------------

test('P2-FIX-115: a terminal failure emits the typed non-completable warning at failure time', async () => {
	const root = makeRoot();
	const { port, appends } = makeCapturePort();
	const store = makeStore(root, 1700000000000, port);
	const submitted = await store.submitGraph({
		title: 'p2fix115 terminal',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(store, submitted.graphId);
	// 'invalid-input' is a TERMINAL failure class: the default (and any) retry policy refuses it
	const finished = await store.finishStep({
		graphId: submitted.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'invalid-input',
		message: 'bad input',
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	const warning = finished.nonCompletable;
	assert.ok(warning !== undefined, 'the failure-time signal must be present (fail-on-base: it does not exist)');
	assert.equal(warning.code, 'graph-non-completable');
	assert.equal(warning.reason, 'terminal-class');
	assert.equal(warning.graphId, submitted.graphId);
	assert.equal(warning.stepId, 'S-01');
	assert.equal(warning.attempt, 1);
	assert.equal(warning.failureClass, 'invalid-input');
	assert.ok(warning.message.includes('no remaining path to completion'), 'the message carries the finding\'s operator guidance');
	assert.ok(warning.message.includes('failGraph'), 'the message names the next legal move');
	// the failure-time ledger record: ONE note row referencing the landed step-failed row
	const stepFailedRow = store.journalRows[store.journalRows.length - 1];
	assert.equal(stepFailedRow.type, 'step-failed');
	assert.equal(warning.evidenceId, 'E-000001');
	const signalAppend = appends.find(append => typeof append.row.uri === 'string' && (append.row.uri as string).startsWith('flauz-orch-noncompletable://'));
	assert.ok(signalAppend !== undefined, 'the evidence ledger records the failure-time signal');
	assert.equal(signalAppend.row.uri, `flauz-orch-noncompletable://${stepFailedRow.rowId}`);
	assert.equal(signalAppend.row.kind, 'note');
	assert.equal(signalAppend.taskId, 'T-001');
	assert.match(String(signalAppend.row.sha256), /^[0-9a-f]{64}$/);
	assert.equal(appends.filter(append => typeof append.row.uri === 'string' && (append.row.uri as string).startsWith('flauz-orch-noncompletable://')).length, 1, 'exactly one signal row is minted');
	// the journal is untouched by the signal: 4 rows (submitted/approved/started/failed), no extra row
	assert.equal(store.journalRows.length, 4);
	assert.deepEqual(store.journalRows.map(row => row.type), ['graph-submitted', 'graph-approved', 'step-started', 'step-failed']);
	assert.equal(store.verifyJournal().ok, true);
});

test('P2-FIX-115: the attempts-exhausted refusal is the other typed reason', async () => {
	const root = makeRoot();
	const store = makeStore(root);
	const submitted = await store.submitGraph({
		title: 'p2fix115 exhausted',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it', retryPolicy: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 10 }, retryOn: ['timeout'] } }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(store, submitted.graphId);
	// 'timeout' is retryable by this policy but attempt 1 exhausted maxAttempts 1
	const finished = await store.finishStep({
		graphId: submitted.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'timeout',
		message: 'slow',
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	assert.ok(finished.nonCompletable !== undefined, 'the budget-exhausted failure also leaves no completable path');
	assert.equal(finished.nonCompletable.reason, 'attempts-exhausted');
});

// ---------------------------------------------------------------------------
// the silence law (no behavior change on the legal paths)
// ---------------------------------------------------------------------------

test('P2-FIX-115: a retryable failure stays silent (no warning, no signal row)', async () => {
	const root = makeRoot();
	const { port, appends } = makeCapturePort();
	const store = makeStore(root, 1700000000000, port);
	const submitted = await store.submitGraph({
		title: 'p2fix115 retryable',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(store, submitted.graphId);
	// 'timeout' is in the default policy's retryOn with attempts remaining
	const finished = await store.finishStep({
		graphId: submitted.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'timeout',
		message: 'slow',
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	assert.equal(finished.nonCompletable, undefined, 'a retry path remains: no signal');
	assert.equal(appends.filter(append => typeof append.row.uri === 'string' && (append.row.uri as string).startsWith('flauz-orch-noncompletable://')).length, 0, 'no signal row is minted');
});

test('P2-FIX-115: retryPlanned pinning does not fabricate completability either way', async () => {
	// (a) pinning retryPlanned TRUE on a terminal-class failure cannot hide the doom: the
	//     policy verdict is the ground truth and retryStep will still refuse the retry
	const rootA = makeRoot();
	const storeA = makeStore(rootA);
	const submittedA = await storeA.submitGraph({
		title: 'p2fix115 pinned-true',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(storeA, submittedA.graphId);
	const finishedA = await storeA.finishStep({
		graphId: submittedA.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'permanent',
		message: 'gone',
		retryPlanned: true,
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	assert.equal(finishedA.payload.retryPlanned, true, 'the row records the caller-pinned claim verbatim');
	assert.ok(finishedA.nonCompletable !== undefined, 'the signal still fires: the pinned flag is not the completable-path analysis');
	assert.equal(finishedA.nonCompletable.reason, 'terminal-class');
	await assert.rejects(() => storeA.retryStep({ graphId: submittedA.graphId, stepId: 'S-01', actor: 'service', origin: 'test:p2fix115' }),
		(error: unknown) => /the retry policy refuses a retry/.test(messageOf(error)), 'retryStep still refuses the terminal retry');

	// (b) pinning retryPlanned FALSE on a retryable failure does not fabricate doom: the
	//     store's retry path remains open (retryStep recomputes the policy verdict)
	const rootB = makeRoot();
	const storeB = makeStore(rootB);
	const submittedB = await storeB.submitGraph({
		title: 'p2fix115 pinned-false',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(storeB, submittedB.graphId);
	const finishedB = await storeB.finishStep({
		graphId: submittedB.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'timeout',
		message: 'slow',
		retryPlanned: false,
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	assert.equal(finishedB.nonCompletable, undefined, 'a retry remains possible through the store: no signal');
	await storeB.retryStep({ graphId: submittedB.graphId, stepId: 'S-01', actor: 'service', origin: 'test:p2fix115' });
	const retried = await storeB.startStep({ graphId: submittedB.graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:p2fix115' });
	assert.equal(retried.attempt, 2, 'the retry path works exactly as before');
});

// ---------------------------------------------------------------------------
// the byte-identity law (legal completions unchanged)
// ---------------------------------------------------------------------------

test('P2-FIX-115: the step-failed journal row stays byte-identical (payload + canonical line)', async () => {
	const root = makeRoot();
	const store = makeStore(root);
	const submitted = await store.submitGraph({
		title: 'p2fix115 bytes',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(store, submitted.graphId);
	await store.finishStep({
		graphId: submitted.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'invalid-input',
		message: 'bad input',
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	const row = store.journalRows[3];
	assert.equal(row.type, 'step-failed');
	// the payload keeps EXACTLY the pre-fix keys (no signal leakage into the row)
	assert.deepEqual(Object.keys(row.payload).sort(), ['failureClass', 'message', 'retryPlanned']);
	assert.deepEqual(row.payload, { failureClass: 'invalid-input', message: 'bad input', retryPlanned: false });
	// the stored line is the canonical 14-field journal row (no extra field)
	const line = journalLine(row);
	assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['$schema', 'actor', 'attempt', 'contentHash', 'graphId', 'idempotencyKey', 'origin', 'payload', 'prev', 'rowId', 'seq', 'stepId', 'ts', 'type']);
	const onDisk = readFileSync(join(root, '.flauz/orchestration/journal.jsonl'), 'utf-8');
	assert.ok(onDisk.endsWith(`${line}\n`), 'the landed bytes are the canonical line');
	assert.equal(store.journalRows.length, 4, 'the signal adds no journal row');
});

test('P2-FIX-115: the completion-time rejection law is unchanged (late rejection still fires)', async () => {
	const root = makeRoot();
	const store = makeStore(root);
	const submitted = await store.submitGraph({
		title: 'p2fix115 late rejection',
		steps: [
			{ stepId: 'S-01', title: 'a', instruction: 'a' },
			{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
		],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:p2fix115' });
	await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:p2fix115' });
	await store.finishStep({ graphId: submitted.graphId, stepId: 'S-01', outcome: 'failed', failureClass: 'invalid-input', message: 'x', actor: 'agent', origin: 'test:p2fix115' });
	// the late rejection: byte-identical message, still rejected (the law is untouched)
	await assert.rejects(() => store.completeGraph({ graphId: submitted.graphId, actor: 'service', origin: 'test:p2fix115' }),
		(error: unknown) => /graph-completed requires every step succeeded \(pending: S-01, S-02\) - fabricated completion is rejected/.test(messageOf(error)));
	// the operator's legal move after the signal: failGraph
	await store.failGraph({ graphId: submitted.graphId, failedStepId: 'S-01', actor: 'agent', origin: 'test:p2fix115' });
	assert.equal(store.stateOf(submitted.graphId).graphStatus, 'failed');
});

test('P2-FIX-115: the legal completion path behaves exactly as before (fail -> retry -> succeed -> complete)', async () => {
	const root = makeRoot();
	const store = makeStore(root);
	const submitted = await store.submitGraph({
		title: 'p2fix115 legal path',
		steps: [
			{ stepId: 'S-01', title: 'a', instruction: 'a' },
			{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
		],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:p2fix115' });
	await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:p2fix115' });
	const failed = await store.finishStep({ graphId: submitted.graphId, stepId: 'S-01', outcome: 'failed', failureClass: 'timeout', message: 'slow', actor: 'agent', origin: 'test:p2fix115' });
	assert.equal(failed.nonCompletable, undefined);
	await store.retryStep({ graphId: submitted.graphId, stepId: 'S-01', actor: 'service', origin: 'test:p2fix115' });
	await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:p2fix115' });
	await store.finishStep({ graphId: submitted.graphId, stepId: 'S-01', outcome: 'succeeded', actor: 'agent', origin: 'test:p2fix115', output: 'ok', evidence: [] });
	await store.startStep({ graphId: submitted.graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:p2fix115' });
	await store.finishStep({ graphId: submitted.graphId, stepId: 'S-02', outcome: 'succeeded', actor: 'agent', origin: 'test:p2fix115', output: 'ok', evidence: [] });
	await store.completeGraph({ graphId: submitted.graphId, actor: 'service', origin: 'test:p2fix115' });
	assert.equal(store.stateOf(submitted.graphId).graphStatus, 'completed');
	assert.notEqual(store.stateOf(submitted.graphId).completedAt, null);
	assert.equal(store.verifyJournal().ok, true);
});

test('P2-FIX-115: without a taskPort the signal degrades honestly (evidenceId null, no crash)', async () => {
	const root = makeRoot();
	const store = makeStore(root);
	const submitted = await store.submitGraph({
		title: 'p2fix115 no port',
		steps: [{ stepId: 'S-01', title: 'only', instruction: 'do it' }],
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	await runningStep(store, submitted.graphId);
	const finished = await store.finishStep({
		graphId: submitted.graphId,
		stepId: 'S-01',
		outcome: 'failed',
		failureClass: 'policy-violation',
		message: 'no',
		actor: 'agent',
		origin: 'test:p2fix115',
	});
	assert.ok(finished.nonCompletable !== undefined);
	assert.equal(finished.nonCompletable.evidenceId, null, 'no ledger linkage without a port; the journal row stays the primary record');
	assert.equal(finished.nonCompletable.reason, 'terminal-class');
	assert.equal(store.verifyJournal().ok, true);
});
