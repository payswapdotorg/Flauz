/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-001 M1 core suite: the durable task-graph state machine, its strict
 * persistence formats and the replay derivation. Same discipline as the
 * 9-transition seam: legal transitions only, unknown keys rejected, every
 * validation rule violated by at least one bad fixture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ORCH_GRAPHS_SCHEMA,
	ORCH_JOURNAL_ROW_SCHEMA,
	STEP_TRANSITIONS,
	GRAPH_TRANSITIONS,
	JOURNAL_EVENT_TYPES,
	STEP_STATUSES,
	GRAPH_STATUSES,
	rowIdOf,
	rowHashOf,
	contentHashOf,
	journalLine,
	validateStepSpec,
	validateGraphRecord,
	validateJournalRow,
	validateJournalPayload,
	deriveGraphState,
	idempotencyKeyOf,
	claimIdOf,
	leaseIdOf,
	isStepId,
	isGraphId,
	OrchestrationError,
} from '../core/orchestration.mjs';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { validateRetryPolicy, DEFAULT_RETRY_POLICY, planRetry, backoffDelayMs, classifyFailure, planCancellation } from '../core/policy.mjs';

/** The error-message extractor for assert predicates (unknown-safe). */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-orch-core-'));
}

function makeStore(root: string, clockBase = 1700000000000): OrchestrationStore {
	let value = clockBase;
	return new OrchestrationStore(root, { clock: () => (value += 1000) });
}

const GOOD_STEPS: Array<Record<string, unknown>> = [
	{ stepId: 'S-01', title: 'first', instruction: 'run the first step' },
	{ stepId: 'S-02', title: 'second', instruction: 'run the second step', dependsOn: ['S-01'], gate: 'human-approval' },
];

async function submittedStore(root: string, steps = GOOD_STEPS, policy = {}): Promise<{ store: OrchestrationStore; graphId: string }> {
	const store = makeStore(root);
	const submitted = await store.submitGraph({ title: 'core graph', steps, policy, actor: 'agent', origin: 'test:core' });
	return { store, graphId: submitted.graphId };
}

// ---------------------------------------------------------------------------
// ids, keys, hashes
// ---------------------------------------------------------------------------

test('idempotency keys follow the <surface>/<id>/run/<attempt> house pattern', () => {
	assert.equal(idempotencyKeyOf('G-001', 'S-01', 2), 'flauz-orch/G-001/S-01/run/2');
	assert.equal(idempotencyKeyOf('G-012', 'S-07', 1), 'flauz-orch/G-012/S-07/run/1');
});

test('claim and lease ids are deterministic derivations', () => {
	assert.equal(claimIdOf('G-001', 'S-02'), 'C-001-02');
	assert.equal(leaseIdOf('G-001', 'S-02', 3), 'L-001-02-3');
	assert.equal(rowIdOf(1), 'R-000001');
	assert.equal(rowIdOf(123456), 'R-123456');
});

test('rowHashOf covers all 14 fields except prev; journalLine is canonical', async () => {
	const { store, graphId } = await submittedStore(makeRoot());
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	const row = store.journalRows[1];
	const line = journalLine(row);
	assert.ok(line.startsWith('{"$schema":'));
	assert.equal(JSON.parse(line).seq, row.seq);
	// mutating any covered field changes the hash; prev is excluded
	for (const field of ['rowId', 'ts', 'actor', 'origin', 'payload']) {
		const mutated = { ...row, [field]: field === 'payload' ? { ...row.payload, note: 'x' } : 'mutated' };
		assert.notEqual(rowHashOf(mutated as never), rowHashOf(row), field);
	}
	const prevMutated = { ...row, prev: 'f'.repeat(64) };
	assert.equal(rowHashOf(prevMutated as never), rowHashOf(row));
});

// ---------------------------------------------------------------------------
// step/graph spec validation
// ---------------------------------------------------------------------------

test('validateStepSpec accepts the minimal and the full shape', () => {
	assert.equal(validateStepSpec({ stepId: 'S-01', title: 't', instruction: 'i' }).ok, true);
	const verdict = validateStepSpec({
		stepId: 'S-01', title: 't', instruction: 'i', tool: 'flauz_terminal', toolInput: { command: 'echo hi' },
		gate: 'human-approval', dependsOn: [], retryPolicy: { maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 10 }, retryOn: ['transient'] },
		routing: { allowedAgents: ['flauz.agent.worker-1'], requiredCapability: 'terminal' },
	});
	assert.equal(verdict.ok, true);
});

test('validateStepSpec rejects every malformed shape', () => {
	const cases: Array<[unknown, string]> = [
		[{ stepId: 'X-1', title: 't', instruction: 'i' }, 'stepId'],
		[{ stepId: 'S-01', title: '', instruction: 'i' }, 'title'],
		[{ stepId: 'S-01', title: 't', instruction: '' }, 'instruction'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', gate: 'always' }, 'gate'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', dependsOn: ['S-01'] }, 'self'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', routing: { allowedAgents: [] } }, 'allowedAgents'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', unknown: 1 }, 'unknown'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', retryPolicy: { maxAttempts: 0, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['transient'] } }, 'maxAttempts'],
		[{ stepId: 'S-01', title: 't', instruction: 'i', retryPolicy: { maxAttempts: 2, backoff: { kind: 'fixed', baseMs: 1 }, retryOn: ['invalid-input'] } }, 'terminal class'],
	];
	for (const [value, label] of cases) {
		assert.equal(validateStepSpec(value).ok, false, label);
	}
});

test('validateGraphRecord rejects duplicate ids, unknown deps, cycles, bad policy', () => {
	const base = { graphId: 'G-001', taskId: null, title: 'g', policy: {}, steps: GOOD_STEPS, createdAt: 1, updatedAt: 1 };
	assert.equal(validateGraphRecord(base).ok, true);
	assert.equal(validateGraphRecord({ ...base, steps: [...GOOD_STEPS, { stepId: 'S-01', title: 'x', instruction: 'x' }] }).ok, false);
	assert.equal(validateGraphRecord({ ...base, steps: [{ stepId: 'S-01', title: 'x', instruction: 'x', dependsOn: ['S-09'] }] }).ok, false);
	assert.equal(validateGraphRecord({
		...base,
		steps: [
			{ stepId: 'S-01', title: 'a', instruction: 'a', dependsOn: ['S-02'] },
			{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
		],
	}).ok, false);
	assert.equal(validateGraphRecord({ ...base, policy: { onStepFailure: 'explode' } }).ok, false);
	assert.equal(validateGraphRecord({ ...base, taskId: 'T-xx' }).ok, false);
	assert.equal(validateGraphRecord({ ...base, extra: 1 }).ok, false);
});

// ---------------------------------------------------------------------------
// envelope version discipline (strict load, unknown keys rejected)
// ---------------------------------------------------------------------------

test('graphs envelope rejects unknown keys, bad schema, malformed records', async () => {
	const root = makeRoot();
	const { store } = await submittedStore(root);
	const dir = join(root, '.flauz', 'orchestration');
	const good = readFileSync(join(dir, 'graphs.json'), 'utf-8');
	const parsed = JSON.parse(good);
	const badCases: Array<[string, unknown]> = [
		['unknown envelope key', { ...parsed, extra: 1 }],
		['bad schema', { ...parsed, $schema: 'flauz.orch.graphs/v0' }],
		['unknown graph key', { ...parsed, graphs: [{ ...parsed.graphs[0], extra: 1 }] }],
		['unknown step key', { ...parsed, graphs: [{ ...parsed.graphs[0], steps: [{ ...parsed.graphs[0].steps[0], extra: 1 }] }] }],
	];
	for (const [label, envelope] of badCases) {
		writeFileSync(join(dir, 'graphs.json'), JSON.stringify(envelope, null, 2) + '\n');
		assert.throws(() => makeStore(root), (error: unknown) => error instanceof OrchestrationError, label);
	}
	writeFileSync(join(dir, 'graphs.json'), good);
	assert.doesNotThrow(() => makeStore(root));
});

test('journal load rejects non-canonical bytes, broken chains, mid-file corruption', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root);
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	const path = join(root, '.flauz', 'orchestration', 'journal.jsonl');
	const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0);
	// non-canonical bytes: the same JSON value with NON-sorted key order
	const row = JSON.parse(lines[0]);
	const nonCanonical = `${JSON.stringify({ actor: row.actor, type: row.type, ...row })}\n${lines.slice(1).join('\n')}\n`;
	writeFileSync(path, nonCanonical);
	assert.throws(() => makeStore(root), (error: unknown) => /not canonical/.test(messageOf(error)));
	// tamper A - payload byte mutation: the content-hash linkage breaks at LOAD
	writeFileSync(path, `${lines[0].replace('"stepCount":2', '"stepCount":3')}\n${lines[1]}\n`);
	assert.throws(() => makeStore(root), (error: unknown) => /contentHash|FINAL/.test(messageOf(error)));
	// tamper B - actor byte mutation (outside the payload): structurally valid at
	// load (the chain covers the bytes via the NEXT row's prev, and this is the
	// last row), but the REPLAY layer catches the actor-gate violation
	writeFileSync(path, `${lines[0]}\n${lines[1].replace('"actor":"human"', '"actor":"agent"')}\n`);
	const tampered = makeStore(root);
	assert.throws(() => tampered.getGraphState(graphId), (error: unknown) => /requires actor human/.test(messageOf(error)));
	// a corrupt NON-final line fails loudly even when the tail is valid
	writeFileSync(path, `not-json\n${lines[0]}\n`);
	assert.throws(() => makeStore(root), (error: unknown) => /FINAL line/.test(messageOf(error)));
});

// ---------------------------------------------------------------------------
// journal row validation (every rule violated)
// ---------------------------------------------------------------------------

function baseRow(): Record<string, unknown> {
	return {
		$schema: ORCH_JOURNAL_ROW_SCHEMA,
		seq: 1,
		rowId: 'R-000001',
		ts: 1700000000001,
		graphId: 'G-001',
		stepId: null,
		type: 'graph-submitted',
		actor: 'agent',
		origin: 'test:core',
		attempt: null,
		idempotencyKey: null,
		payload: { title: 'g', stepCount: 1, taskId: null },
		contentHash: '',
		prev: null,
	};
}

test('validateJournalRow accepts the canonical shape and rejects each violation', () => {
	const good = { ...baseRow(), contentHash: contentHashOf(baseRow().payload) };
	assert.equal(validateJournalRow(good).ok, true);
	const cases: Array<[Record<string, unknown>, string]> = [
		[{ ...good, $schema: 'flauz.orch.journal/v0' }, 'schema'],
		[{ ...good, rowId: 'R-000002' }, 'rowId'],
		[{ ...good, actor: 'user' }, 'actor vocabulary'],
		[{ ...good, origin: '' }, 'origin'],
		[{ ...good, type: 'graph-exploded' }, 'type'],
		[{ ...good, stepId: 'S-01' }, 'graph-level stepId'],
		[{ ...good, type: 'step-started', stepId: null }, 'step-level stepId'],
		[{ ...good, payload: { title: 'g', stepCount: 1 } }, 'payload keys'],
		[{ ...good, contentHash: '0'.repeat(64) }, 'contentHash'],
		[{ ...good, prev: 'zz' }, 'prev'],
		[{ ...good, ts: 0 }, 'ts'],
		[{ ...good, extra: 1 }, 'extra key'],
	];
	for (const [row, label] of cases) {
		assert.equal(validateJournalRow(row).ok, false, label);
	}
});

test('validateJournalPayload pins each payload class', () => {
	const spotChecks: Array<[string, unknown, boolean]> = [
		['graph-submitted', { title: 'g', stepCount: 2, taskId: 'T-001' }, true],
		['graph-submitted', { title: 'g', stepCount: 2, taskId: 'T-001', note: 'x' }, false],
		['step-started', { runnerId: 'runner-a' }, true],
		['step-started', { runnerId: '' }, false],
		['step-failed', { failureClass: 'timeout', message: 'm', retryPlanned: true }, true],
		['step-failed', { failureClass: 'timeout', message: 'm' }, false],
		['step-retry-scheduled', { nextAttempt: 2, nextAttemptAt: 1700000005000 }, true],
		['step-retry-scheduled', { nextAttempt: 2 }, false],
		['step-cancelled', { cause: 'user-cancel' }, true],
		['step-cancelled', { cause: 'agent-gave-up' }, false],
		['approval-requested', { reason: 'r' }, true],
		['approval-requested', {}, false],
		['claim-acquired', { claimId: 'C-001-01', holder: 'agent-x' }, true],
		['claim-acquired', { claimId: 'C-1-1', holder: 'agent-x' }, false],
		['lease-acquired', { leaseId: 'L-001-01-1', holder: 'agent-x', expiresAt: 1700000009000 }, true],
		['lease-acquired', { leaseId: 'L-001-01-1', holder: 'agent-x' }, false],
		['conflict-noticed', { violation: 'claim', expectedHolder: 'a', actualRunner: 'b' }, true],
		['conflict-noticed', { violation: 'war', expectedHolder: 'a', actualRunner: 'b' }, false],
		['route-decided', { targetAgent: 'worker-1', reason: 'capability-match' }, true],
		['route-decided', { targetAgent: 'worker-1', reason: 'vibes' }, false],
		['delegation-sent', { decisionRowId: 'R-000005', messageId: 'M-000001' }, true],
		['delegation-sent', { decisionRowId: 'R-000005', messageId: 'X-1' }, false],
		['result-received', { messageId: 'M-000001', outcome: 'ok', summary: 's', evidenceIds: ['E-000001'] }, true],
		['result-received', { messageId: 'M-000001', outcome: 'maybe', summary: 's', evidenceIds: [] }, false],
		['cancel-requested', { reason: 'r' }, true],
		['cancel-requested', { reason: '' }, false],
		['step-interrupted', { cause: 'process-exit' }, true],
		['recovery-scan', { actions: [], clean: true }, true],
		['recovery-scan', { actions: [], clean: 'yes' }, false],
	];
	for (const [type, payload, expectedOk] of spotChecks) {
		const error = validateJournalPayload(type, payload);
		assert.equal(error === undefined, expectedOk, `${type} ${JSON.stringify(payload)}`);
	}
});

// ---------------------------------------------------------------------------
// transition legality (the 9-transition-seam discipline)
// ---------------------------------------------------------------------------

test('every transition class is legal from its source and rejected from others', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'], gate: 'human-approval' },
	]);
	// step-started before graph approval: blocked
	await assert.rejects(() => store.startStep({ graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => error instanceof OrchestrationError && /not allowed from step status blocked/.test(messageOf(error)));
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	// dependency not satisfied yet: S-02 is blocked (dep S-01 has not succeeded)
	await assert.rejects(() => store.startStep({ graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => error instanceof OrchestrationError && /not allowed from step status blocked/.test(messageOf(error)));
	await assert.rejects(() => store.approvalRequest({ graphId, stepId: 'S-02', reason: 'gate', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => error instanceof OrchestrationError && /not allowed from step status blocked/.test(messageOf(error)));
	// run S-01 to success (unblocks S-02)
	const started = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:core' });
	assert.equal(started.attempt, 1);
	await store.finishStep({ graphId, stepId: 'S-01', outcome: 'succeeded', actor: 'agent', origin: 'test:core', output: 'ok', evidence: [] });
	// second completion of S-01 is illegal (succeeded is terminal)
	await assert.rejects(() => store.finishStep({ graphId, stepId: 'S-01', outcome: 'succeeded', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => /not allowed from step status succeeded/.test(messageOf(error)));
	// NOW S-02 is ready: the human-approval gate is the blocking rule (never auto-granted)
	await assert.rejects(() => store.startStep({ graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => error instanceof OrchestrationError && /human-approval/.test(messageOf(error)));
	// request -> grant -> start
	await store.approvalRequest({ graphId, stepId: 'S-02', reason: 'gate', actor: 'agent', origin: 'test:core' });
	await store.approvalDecide({ graphId, stepId: 'S-02', decision: 'granted', actor: 'human', origin: 'test:core' });
	await store.startStep({ graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:core' });
	await store.finishStep({ graphId, stepId: 'S-02', outcome: 'failed', failureClass: 'timeout', message: 'slow', actor: 'agent', origin: 'test:core' });
	// retry from non-failed is illegal (sync store method -> assert.throws)
	await assert.rejects(() => store.retryStep({ graphId, stepId: 'S-01', actor: 'service', origin: 'test:core' }),
		(error: unknown) => /requires step status 'failed'/.test(messageOf(error)));
	await store.retryStep({ graphId, stepId: 'S-02', actor: 'service', origin: 'test:core' });
	const retried = await store.startStep({ graphId, stepId: 'S-02', runnerId: 'r', actor: 'agent', origin: 'test:core' });
	assert.equal(retried.attempt, 2);
	await store.finishStep({ graphId, stepId: 'S-02', outcome: 'succeeded', actor: 'agent', origin: 'test:core', output: 'ok', evidence: [] });
	// completion requires every step succeeded (here: yes) - and double completion is illegal
	await store.completeGraph({ graphId, actor: 'service', origin: 'test:core' });
	await assert.rejects(() => store.completeGraph({ graphId, actor: 'service', origin: 'test:core' }),
		(error: unknown) => /not allowed from graph status completed/.test(messageOf(error)));
});

test('fabricated graph completion is mechanically rejected', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [
		{ stepId: 'S-01', title: 'a', instruction: 'a' },
		{ stepId: 'S-02', title: 'b', instruction: 'b', dependsOn: ['S-01'] },
	]);
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	await store.startStep({ graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:core' });
	await store.finishStep({ graphId, stepId: 'S-01', outcome: 'succeeded', actor: 'agent', origin: 'test:core', output: 'ok', evidence: [] });
	// S-02 not run yet: graph-completed must be rejected with the pending step named
	await assert.rejects(() => store.completeGraph({ graphId, actor: 'service', origin: 'test:core' }),
		(error: unknown) => /requires every step succeeded \(pending: S-02\)/.test(messageOf(error)));
	// graph-failed without a failed step is rejected too
	await assert.rejects(() => store.failGraph({ graphId, failedStepId: 'S-02', actor: 'service', origin: 'test:core' }),
		(error: unknown) => /requires at least one failed or cancelled step/.test(messageOf(error)));
});

test('actor gates: human-only transitions reject service/agent/tool actors', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [{ stepId: 'S-01', title: 'a', instruction: 'a', gate: 'human-approval' }]);
	const humanOnly: Array<[string, () => Promise<unknown>]> = [
		['graph-approved', () => store.approveGraph({ graphId, actor: 'agent', origin: 'test:core' })],
	];
	for (const [label, call] of humanOnly) {
		await assert.rejects(() => call(), (error: unknown) => /requires actor human/.test(messageOf(error)), label);
	}
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', actor: 'service', origin: 'runtime:gate' });
	const decisions: Array<[string, () => Promise<unknown>]> = [
		['approval-granted by service', () => store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', actor: 'service', origin: 'test:core' })],
		['approval-granted by agent', () => store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', actor: 'agent', origin: 'test:core' })],
		['approval-denied by tool', () => store.approvalDecide({ graphId, stepId: 'S-01', decision: 'denied', actor: 'tool', origin: 'test:core' })],
	];
	for (const [label, call] of decisions) {
		await assert.rejects(() => call(), (error: unknown) => /requires actor human/.test(messageOf(error)), label);
	}
	// takeover: request by agent is legal (a suggestion), accept/complete are human-only
	await store.takeoverRequest({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:core' });
	await assert.rejects(() => store.takeoverAccept({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => /requires actor human/.test(messageOf(error)));
	await store.takeoverAccept({ graphId, stepId: 'S-01', actor: 'human', origin: 'test:core' });
	await assert.rejects(() => store.takeoverComplete({ graphId, stepId: 'S-01', actor: 'service', origin: 'test:core' }),
		(error: unknown) => /requires actor human/.test(messageOf(error)));
	await store.takeoverComplete({ graphId, stepId: 'S-01', actor: 'human', origin: 'test:core', summary: 'done by hand' });
	// step-succeeded by human is NOT a legal completion path (takeover-completed is)
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string }> };
	assert.equal(state.steps['S-01'].status, 'succeeded');
});

test('claims are exclusive; leases require release/expiry before re-acquire', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [{ stepId: 'S-01', title: 'a', instruction: 'a' }]);
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'test:core' });
	await assert.rejects(() => store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-b', actor: 'agent', origin: 'test:core' }),
		(error: unknown) => /claims are exclusive/.test(messageOf(error)));
	await store.releaseClaim({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:core' });
	await assert.rejects(() => store.releaseClaim({ graphId, stepId: 'S-01', agent: 'agent', origin: 'test:core', holder: 'x' } as never),
		(error: unknown) => /no active claim/.test(messageOf(error)));
	await store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-a', ttlMs: 5000, actor: 'agent', origin: 'test:core' });
	await assert.rejects(() => store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-b', ttlMs: 5000, actor: 'agent', origin: 'test:core' }),
		(error: unknown) => /while .* is active/.test(messageOf(error)));
	const renewed = await store.renewLease({ graphId, stepId: 'S-01', ttlMs: 10000, actor: 'agent', origin: 'test:core' });
	assert.equal((renewed.payload.expiresAt as number) > 0, true);
	await store.releaseLease({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:core' });
	await assert.rejects(() => store.renewLease({ graphId, stepId: 'S-01', ttlMs: 10000, actor: 'agent', origin: 'test:core' }),
		(error: unknown) => /no active lease/.test(messageOf(error)));
});

test('claim conflict on startStep records conflict-noticed (v0 informational enforcement)', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [{ stepId: 'S-01', title: 'a', instruction: 'a' }]);
	await store.approveGraph({ graphId, actor: 'human', origin: 'test:core' });
	await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'test:core' });
	await store.startStep({ graphId, stepId: 'S-01', runnerId: 'runner-b', actor: 'agent', origin: 'test:core' });
	const conflicts = store.journalRows.filter((row) => row.type === 'conflict-noticed');
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0].payload.violation, 'claim');
	assert.equal(conflicts[0].payload.expectedHolder, 'agent-a');
	assert.equal(conflicts[0].payload.actualRunner, 'runner-b');
});

// ---------------------------------------------------------------------------
// derivation
// ---------------------------------------------------------------------------

test('deriveGraphState is a deterministic pure projection', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root);
	const graph = store.requireGraph(graphId);
	const rows = store.rowsFor(graphId);
	const first = deriveGraphState(graph, rows);
	const second = deriveGraphState(graph, rows);
	assert.deepEqual(first, second);
	assert.equal(first.ok, true);
	if (first.ok) {
		assert.equal(first.state.graphStatus, 'submitted');
		assert.equal(first.state.steps['S-01'].status, undefined);
	}
});

test('deriveGraphState rejects an out-of-order / illegal row sequence', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root, [{ stepId: 'S-01', title: 'a', instruction: 'a' }]);
	const graph = store.requireGraph(graphId);
	const rows = store.rowsFor(graphId);
	// duplicate the submitted row (same seq twice) -> seq-ascending violation
	const duplicate = deriveGraphState(graph, [...rows, rows[0]]);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) {
		assert.match(duplicate.error, /seq-ascending/);
	}
	// a step-succeeded without step-started -> illegal source status
	const forged = { ...rows[0], seq: 2, rowId: 'R-000002', type: 'step-succeeded', stepId: 'S-01', attempt: 1, payload: { evidence: [] }, contentHash: contentHashOf({ evidence: [] }) };
	const illegal = deriveGraphState(graph, [...rows, forged]);
	assert.equal(illegal.ok, false);
	if (!illegal.ok) {
		assert.match(illegal.error, /not allowed from step status/);
	}
});

test('journal event vocabulary covers exactly the transition + coordination classes', () => {
	for (const rule of STEP_TRANSITIONS) {
		assert.ok(JOURNAL_EVENT_TYPES.includes(rule.type), rule.type);
	}
	for (const rule of GRAPH_TRANSITIONS) {
		assert.ok(JOURNAL_EVENT_TYPES.includes(rule.type), rule.type);
	}
	const coordination = ['claim-acquired', 'claim-released', 'lease-acquired', 'lease-renewed', 'lease-released', 'lease-expired', 'conflict-noticed', 'route-decided', 'delegation-sent', 'result-received', 'cancel-requested', 'recovery-scan'];
	for (const type of coordination) {
		assert.ok(JOURNAL_EVENT_TYPES.includes(type), type);
	}
	assert.equal(new Set(JOURNAL_EVENT_TYPES).size, JOURNAL_EVENT_TYPES.length);
	// status vocabularies stay closed sets
	assert.equal(STEP_STATUSES.length, new Set(STEP_STATUSES).size);
	assert.equal(GRAPH_STATUSES.length, new Set(GRAPH_STATUSES).size);
});

// ---------------------------------------------------------------------------
// policy core (M2 layer, validated here alongside the machine)
// ---------------------------------------------------------------------------

test('retry policy validation and backoff shapes', () => {
	assert.equal(validateRetryPolicy(DEFAULT_RETRY_POLICY).ok, true);
	assert.equal(validateRetryPolicy({ maxAttempts: 2, backoff: { kind: 'linear', baseMs: 100 }, retryOn: ['transient'] }).ok, true);
	assert.equal(validateRetryPolicy({ maxAttempts: 2, backoff: { kind: 'quadratic', baseMs: 100 }, retryOn: ['transient'] }).ok, false);
	const fixed = { maxAttempts: 5, backoff: { kind: 'fixed', baseMs: 100 }, retryOn: ['transient'] };
	const linear = { maxAttempts: 5, backoff: { kind: 'linear', baseMs: 100 }, retryOn: ['transient'] };
	const exponential = { maxAttempts: 5, backoff: { kind: 'exponential', baseMs: 100, maxMs: 350 }, retryOn: ['transient'] };
	assert.equal(backoffDelayMs(fixed, 1, 0), 0);
	assert.equal(backoffDelayMs(fixed, 2, 0), 100);
	assert.equal(backoffDelayMs(fixed, 5, 0), 100);
	assert.equal(backoffDelayMs(linear, 3, 0), 200);
	assert.equal(backoffDelayMs(exponential, 3, 0), 200);
	assert.equal(backoffDelayMs(exponential, 4, 0), 350);
	assert.equal(backoffDelayMs(exponential, 9, 0), 350);
});

test('planRetry: terminal classes never retry; attempts budget applies', () => {
	const policy = DEFAULT_RETRY_POLICY;
	const terminal = planRetry({ policy, attempt: 1, failureClass: 'invalid-input', now: 1000 });
	assert.deepEqual(terminal, { retry: false, reason: 'terminal-class' });
	const unlisted = planRetry({ policy: { ...policy, retryOn: ['timeout'] }, attempt: 1, failureClass: 'transient', now: 1000 });
	assert.deepEqual(unlisted, { retry: false, reason: 'terminal-class' });
	const first = planRetry({ policy, attempt: 1, failureClass: 'timeout', now: 1000 });
	assert.equal(first.retry, true);
	if (first.retry) {
		assert.equal(first.nextAttempt, 2);
		assert.equal(first.nextAttemptAt, 2000);
	}
	const exhausted = planRetry({ policy, attempt: 3, failureClass: 'timeout', now: 1000 });
	assert.deepEqual(exhausted, { retry: false, reason: 'attempts-exhausted' });
	assert.equal(classifyFailure({ failureClass: 'timeout' }), 'timeout');
	assert.equal(classifyFailure(new Error('boom')), 'unknown-default');
	assert.equal(classifyFailure(null), 'unknown-default');
});

test('planCancellation sweeps every non-terminal step', () => {
	const plan = planCancellation({
		'S-01': { status: 'succeeded' },
		'S-02': { status: 'running' },
		'S-03': { status: 'blocked' },
		'S-04': { status: 'cancelled' },
		'S-05': { status: 'failed' },
	});
	assert.deepEqual(plan.cancelStepIds, ['S-02', 'S-03', 'S-05']);
});

// ---------------------------------------------------------------------------
// store projections + taskPort linkage
// ---------------------------------------------------------------------------

test('store summarizes graph state and lists graphs', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root);
	const state = store.getGraphState(graphId) as { graphStatus: string; execution: { phase: string }; steps: Record<string, unknown> };
	assert.equal(state.graphStatus, 'submitted');
	assert.equal(state.execution.phase, 'awaiting-graph-approval');
	const list = store.listGraphs();
	assert.equal(list.length, 1);
	assert.equal(list[0].graphId, graphId);
	assert.equal(store.verifyJournal().ok, true);
});

test('taskPort links graphs to the flauz.tasks/v0 surfaces', async () => {
	const root = makeRoot();
	mkdirSync(join(root, '.flauz'), { recursive: true });
	const events: Array<Record<string, unknown>> = [];
	const evidence: Array<Record<string, unknown>> = [];
	let taskCounter = 0;
	const taskPort = {
		async createTask(args: { title: string }) {
			taskCounter += 1;
			return { taskId: `T-00${String(taskCounter)}` };
		},
		async appendEvent(args: { taskId: string; event: Record<string, unknown> }) {
			events.push({ taskId: args.taskId, ...args.event });
			return { task: null };
		},
		async appendEvidence(args: { taskId: string; row: Record<string, unknown> }) {
			evidence.push({ taskId: args.taskId, ...args.row });
			return { evidenceId: `E-${String(evidence.length).padStart(6, '0')}`, seq: evidence.length };
		},
	};
	let clockValue = 1700000000000;
	const store = new OrchestrationStore(root, { taskPort, clock: () => (clockValue += 1000) });
	const submitted = await store.submitGraph({ title: 'linked', steps: [{ stepId: 'S-01', title: 'a', instruction: 'a' }], actor: 'agent', origin: 'test:core' });
	assert.equal(submitted.taskId, 'T-001');
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:core' });
	await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', runnerId: 'r', actor: 'agent', origin: 'test:core' });
	const finished = await store.finishStep({
		graphId: submitted.graphId, stepId: 'S-01', outcome: 'succeeded', actor: 'agent', origin: 'test:core',
		output: 'ok', evidence: [{ kind: 'note', uri: 'flauz-test://linked/1', sha256: 'a'.repeat(64) }],
	});
	// the finish row carries the LEDGER-MINTED evidence id (content-hash linkage)
	assert.equal((finished.payload.evidence as Array<{ evidenceId: string }>)[0].evidenceId, 'E-000001');
	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'graph-submitted');
	assert.equal(evidence.length, 1);
});

test('orphans: unknown graph/step errors are typed', async () => {
	const root = makeRoot();
	const { store, graphId } = await submittedStore(root);
	assert.throws(() => store.getGraphState('G-999'), (error: unknown) => error instanceof OrchestrationError && error.code === 'unknown-graph');
	await assert.rejects(() => store.startStep({ graphId, stepId: 'S-99', runnerId: 'r', actor: 'agent', origin: 't' }), (error: unknown) => error instanceof OrchestrationError && error.code === 'unknown-step');
});
