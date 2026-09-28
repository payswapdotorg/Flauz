/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-004 closure suite (M5): approval/takeover/lease integration into the
 * durable graph - FIRST-CLASS transitions with EVIDENCE ROWS.
 *
 * BINDING CONTRACT (work order section 1, M5):
 *  - approval requests, takeover records and lease notices are first-class
 *    transitions with evidence rows (not side-channels): every
 *    approval/takeover/claim/lease/conflict op mints ONE flauz.tasks/v0
 *    ledger row and embeds the minted evidenceId in the journal payload;
 *  - the approval lifecycle is complete: approval-requested -> granted |
 *    denied | expired; expiry is SERVICE-ONLY and fail-closed (cancelled,
 *    never auto-granted) and only a deadline-bearing request can expire;
 *  - the human authorization boundary is PRESERVED (the terminalTool
 *    confirmation posture): approvals/takeovers are requests that GATE
 *    execution - a non-human grant/accept/complete is rejected by the
 *    transition tables and NEVER mints an evidence row (no fabricated
 *    ledger facts for events that did not happen);
 *  - the evidence linkage is verifiable: each ledger row's sha256 is the
 *    content hash of the canonical transition facts, recomputable from the
 *    landed journal row; the uri references the journal rowId;
 *  - lease conflicts join claim conflicts as informational notices (v0
 *    enforcement at the extension layer, the routing-module posture).
 *
 * The kill-and-recover coverage for the new transition classes lives in
 * test/orchestration.killRecoverTl2004.test.ts (the extended matrix).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationStore } from '../core/orchStore.mjs';
import { WorkspaceSeam } from '../core/service.mjs';
import { recoveryScan } from '../core/recovery.mjs';
import { driveGraph } from '../core/runtime.mjs';
import { contentHashOf, OrchestrationError } from '../core/orchestration.mjs';
import { makeClock, sha256Of } from './harness/orchWorkspace.ts';

interface LedgerRow {
	seq?: number;
	taskId?: string;
	kind?: string;
	uri?: string;
	sha256?: string;
	evidenceId?: string;
}

function makeRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `flauz-tl2004-${prefix}-`));
}

/** A store wired to the REAL WorkspaceSeam taskPort (full-fidelity evidence minting). */
function makeWiredStore(prefix: string, base = 1700000000000): { store: OrchestrationStore; root: string; seam: WorkspaceSeam } {
	const root = makeRoot(prefix);
	const { clock } = makeClock(base);
	const seam = new WorkspaceSeam(root);
	const store = new OrchestrationStore(root, { taskPort: seam, clock });
	return { store, root, seam };
}

function readLedger(root: string): LedgerRow[] {
	const path = join(root, '.flauz', 'evidence', 'ledger.jsonl');
	try {
		return readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as LedgerRow);
	} catch {
		return [];
	}
}

/** The ledger row OF a minted evidence id (the ledger stores seq; the E-id is its padded projection). */
function ledgerRowOfEvidenceId(ledger: LedgerRow[], evidenceId: string): LedgerRow | undefined {
	const seq = Number.parseInt(evidenceId.slice(2), 10);
	return ledger.find((row) => row.seq === seq);
}

/** The canonical transition facts of a journal row (payload minus the minted evidenceId - the recomputable sha256 input). */
function transitionFactsOf(row: { graphId: string; stepId: string | null; type: string; actor: string; origin: string; ts: number; payload: Record<string, unknown> }): Record<string, unknown> {
	const payload = { ...row.payload };
	delete payload.evidenceId;
	return { graphId: row.graphId, stepId: row.stepId, type: row.type, actor: row.actor, origin: row.origin, ts: row.ts, payload };
}

const GATED_STEP = [{ stepId: 'S-01', title: 'gated work', instruction: 'needs a human', gate: 'human-approval' }];

async function submittedApproved(store: OrchestrationStore, steps: Array<Record<string, unknown>> = GATED_STEP, policy: Record<string, unknown> = {}): Promise<string> {
	const submitted = await store.submitGraph({ title: 'tl2004 graph', steps, policy, actor: 'agent', origin: 'test:tl2004' });
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:tl2004' });
	return submitted.graphId;
}

// ---------------------------------------------------------------------------
// The approval lifecycle: request -> granted | denied | expired (evidence on every leg)
// ---------------------------------------------------------------------------

test('approval request/grant/deny are first-class transitions with verifiable evidence rows', async () => {
	const { store, root } = makeWiredStore('approval-grant');
	const graphId = await submittedApproved(store);
	const requested = await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'deploy needs a human', expiresAt: 1700000900000, actor: 'agent', origin: 'test:tl2004' });
	// the request carries its minted evidence row
	assert.match(requested.payload.evidenceId as string, /^E-\d{6,}$/);
	const granted = await store.approvalDecide({ graphId, stepId: 'S-01', decision: 'granted', note: 'go ahead', actor: 'human', origin: 'chat:/approve' });
	assert.match(granted.payload.evidenceId as string, /^E-\d{6,}$/);
	// the linkage is VERIFIABLE: for each evidence-bearing row, the ledger row's sha256
	// recomputes from the journal row and the uri references the rowId
	const ledger = readLedger(root);
	assert.equal(ledger.length, 2, 'request + grant each minted exactly one ledger row');
	for (const row of [requested, granted]) {
		const ledgerRow = ledgerRowOfEvidenceId(ledger, row.payload.evidenceId as string);
		assert.ok(ledgerRow !== undefined, `evidence row ${String(row.payload.evidenceId)} exists in the ledger`);
		assert.equal(ledgerRow?.uri, `flauz-orch-transition://${row.rowId}`);
		assert.equal(ledgerRow?.kind, 'note');
		assert.equal(ledgerRow?.sha256, contentHashOf(transitionFactsOf(row)), 'the sha256 recomputes from the journal row (no fabricated evidence)');
	}
	// the grant unlocked the gate: the step may now run
	const started = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:tl2004' });
	assert.equal(started.attempt, 1);
	// denial path (a second graph)
	const graphId2 = await submittedApproved(store);
	await store.approvalRequest({ graphId: graphId2, stepId: 'S-01', reason: 'again', actor: 'agent', origin: 'test:tl2004' });
	const denied = await store.approvalDecide({ graphId: graphId2, stepId: 'S-01', decision: 'denied', note: 'not this command', actor: 'human', origin: 'chat:/deny' });
	assert.match(denied.payload.evidenceId as string, /^E-\d{6,}$/);
	const state2 = store.getGraphState(graphId2) as { steps: Record<string, { status: string; failure: { class: string } | null }> };
	assert.equal(state2.steps['S-01'].status, 'cancelled');
	assert.equal(state2.steps['S-01'].failure?.class, 'approval-denied');
});

test('approval expiry: fail-closed, service-only, deadline-bearing requests only', async () => {
	const { store, root } = makeWiredStore('approval-expiry');
	const graphId = await submittedApproved(store, GATED_STEP, { onStepFailure: 'fail-graph' });
	await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'timed gate', expiresAt: 1700000500000, actor: 'agent', origin: 'test:tl2004' });
	const ledgerBefore = readLedger(root).length;
	// BEFORE the deadline the expiry is refused (expiredAt may not predate the deadline)
	await assert.rejects(() => store.expireApproval({ graphId, stepId: 'S-01', expiredAt: 1700000400000, actor: 'service', origin: 'test:tl2004' }), (error: unknown) => error instanceof OrchestrationError && /may not predate the request deadline/.test(error.message));
	// a non-service actor cannot expire (the actor gate: only a mechanical timeout, never a human-granted outcome)
	await assert.rejects(() => store.expireApproval({ graphId, stepId: 'S-01', expiredAt: 1700000600000, actor: 'human', origin: 'test:tl2004' }), (error: unknown) => error instanceof OrchestrationError && /requires actor service/.test(error.message));
	assert.equal(readLedger(root).length, ledgerBefore, 'the refused expiries minted NOTHING (no fabricated evidence)');
	// the real expiry: the step is CANCELLED with the approval-expired failure class - never auto-granted
	const expired = await store.expireApproval({ graphId, stepId: 'S-01', actor: 'service', origin: 'service:gate-expiry' });
	assert.equal(expired.payload.expiredAt, 1700000500000);
	assert.match(expired.payload.evidenceId as string, /^E-\d{6,}$/);
	const state = store.getGraphState(graphId) as { graphStatus: string; steps: Record<string, { status: string; approval: { state: string; expiresAt?: number; evidenceId?: string } | null; failure: { class: string; retryPlanned: boolean } | null }> };
	assert.equal(state.steps['S-01'].status, 'cancelled');
	assert.equal(state.steps['S-01'].approval?.state, 'expired');
	assert.equal(state.steps['S-01'].approval?.expiresAt, 1700000500000);
	assert.equal(state.steps['S-01'].failure?.class, 'approval-expired');
	assert.equal(state.steps['S-01'].failure?.retryPlanned, false);
	// the gate-terminal cancellation feeds the graph policy (fail-graph): driving resolves the graph to failed
	await driveGraph(store, { graphId, sink: { run: async () => ({ ok: true, value: 'never', replayed: false }) }, now: 1893456000000 });
	assert.equal((store.getGraphState(graphId) as { graphStatus: string }).graphStatus, 'failed');
	// a request WITHOUT a deadline never expires (a human must decide or the graph is cancelled)
	const graphId2 = await submittedApproved(store);
	await store.approvalRequest({ graphId: graphId2, stepId: 'S-01', reason: 'no deadline', actor: 'agent', origin: 'test:tl2004' });
	await assert.rejects(() => store.expireApproval({ graphId: graphId2, stepId: 'S-01', actor: 'service', origin: 'test:tl2004' }), (error: unknown) => error instanceof OrchestrationError && /never expires/.test(error.message));
});

test('recovery expires deadline-bearing approvals that passed while the process was down; live deadlines hold', async () => {
	const { store, root } = makeWiredStore('approval-recovery');
	const graphId = await submittedApproved(store, GATED_STEP, { onStepFailure: 'fail-graph' });
	await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'expired while down', expiresAt: 1700000200000, actor: 'agent', origin: 'test:tl2004' });
	const graphId2 = await submittedApproved(store, GATED_STEP, { onStepFailure: 'manual' });
	await store.approvalRequest({ graphId: graphId2, stepId: 'S-01', reason: 'still live', expiresAt: 1893456001000, actor: 'agent', origin: 'test:tl2004' });
	const rowsBefore = store.journalRows.length;
	const report = await recoveryScan(store, { now: 1893456000000, record: true });
	// the passed deadline expired; the live one held (the human gate survives restarts)
	assert.ok(report.actions.includes(`${graphId}:approval-expired:S-01`), report.actions.join(','));
	assert.ok(!report.actions.some((action) => action.startsWith(`${graphId2}:approval-expired`)), 'the live deadline held');
	const expiredRow = store.journalRows.slice(rowsBefore).find((row) => row.type === 'approval-expired');
	assert.ok(expiredRow !== undefined);
	assert.equal(expiredRow?.actor, 'service');
	assert.equal(expiredRow?.origin, 'recovery');
	assert.equal(expiredRow?.payload.expiredAt, 1700000200000);
	const state2 = store.getGraphState(graphId2) as { steps: Record<string, { status: string }> };
	assert.equal(state2.steps['S-01'].status, 'awaiting-approval', 'the live approval still gates execution after restart');
	// the uri linkage survives recovery (every evidence uri references a real journal row)
	const rowIds = new Set(store.journalRows.map((row) => row.rowId));
	for (const ledgerRow of readLedger(root)) {
		if (typeof ledgerRow.uri === 'string' && ledgerRow.uri.startsWith('flauz-orch-transition://')) {
			assert.ok(rowIds.has(ledgerRow.uri.slice('flauz-orch-transition://'.length)), `uri references a real row: ${String(ledgerRow.uri)}`);
		}
	}
});

// ---------------------------------------------------------------------------
// The human authorization boundary: no fabricated evidence, no auto-grants
// ---------------------------------------------------------------------------

test('a rejected human-gate decision mints NOTHING (the preview runs before the mint)', async () => {
	const { store, root } = makeWiredStore('no-fabrication');
	const graphId = await submittedApproved(store);
	await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', actor: 'agent', origin: 'test:tl2004' });
	const ledgerBefore = readLedger(root).length;
	const rowsBefore = store.journalRows.length;
	// agent grant, tool grant, service denial: all rejected by the actor gate
	const attempts: Array<{ decision: 'granted' | 'denied'; actor: string }> = [
		{ decision: 'granted', actor: 'agent' },
		{ decision: 'granted', actor: 'tool' },
		{ decision: 'denied', actor: 'service' },
	];
	for (const args of attempts) {
		await assert.rejects(() => store.approvalDecide({ graphId, stepId: 'S-01', origin: 'test:tl2004', ...args }), (error: unknown) => error instanceof OrchestrationError && /requires actor human/.test(error.message));
	}
	// takeover accept by an agent: rejected, nothing minted
	await assert.rejects(() => store.takeoverRequest({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:tl2004' }).then(() => store.takeoverAccept({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:tl2004' })), (error: unknown) => error instanceof OrchestrationError && /requires actor human/.test(error.message));
	// a double lease acquire: rejected by the exclusivity law, nothing minted
	await store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-a', ttlMs: 5000, actor: 'agent', origin: 'test:tl2004' });
	await assert.rejects(() => store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-b', ttlMs: 5000, actor: 'agent', origin: 'test:tl2004' }), (error: unknown) => error instanceof OrchestrationError && /is active/.test(error.message));
	assert.equal(readLedger(root).length, ledgerBefore + 2, 'only the LEGAL ops minted (the takeover request + the lease acquire); the illegal decisions minted nothing');
	assert.equal(store.journalRows.length, rowsBefore + 2, 'only the legal takeover-request and lease-acquire rows landed');
});

test('without a taskPort the transitions still land (the journal row stays the primary record)', async () => {
	const root = makeRoot('no-taskport');
	const { clock } = makeClock(1700000000000);
	const store = new OrchestrationStore(root, { clock });
	const graphId = await submittedApproved(store);
	const requested = await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', expiresAt: 1700000900000, actor: 'agent', origin: 'test:tl2004' });
	assert.equal('evidenceId' in requested.payload, false, 'no evidenceId key without a taskPort');
	assert.equal(readLedger(root).length, 0);
	const expired = await store.expireApproval({ graphId, stepId: 'S-01', actor: 'service', origin: 'test:tl2004' });
	assert.equal('evidenceId' in expired.payload, false);
	assert.equal((store.getGraphState(graphId) as { steps: Record<string, { status: string }> }).steps['S-01'].status, 'cancelled');
	assert.equal(store.verifyJournal().ok, true);
});

// ---------------------------------------------------------------------------
// Takeover: a distinct transition class with provenance and evidence
// ---------------------------------------------------------------------------

test('takeover lifecycle: provenance chain + evidence rows on every leg', async () => {
	const { store, root } = makeWiredStore('takeover');
	const graphId = await submittedApproved(store, [{ stepId: 'S-01', title: 'stuck work', instruction: 'the agent struggles' }]);
	const started = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:tl2004' });
	// an AGENT may request a takeover (a suggestion to the human); only a human accepts
	const requested = await store.takeoverRequest({ graphId, stepId: 'S-01', reason: 'the agent is stuck; a human should finish', actor: 'agent', origin: 'agent:flauz.agent' });
	assert.match(requested.payload.evidenceId as string, /^E-\d{6,}$/);
	const accepted = await store.takeoverAccept({ graphId, stepId: 'S-01', note: 'human takes it from here', actor: 'human', origin: 'chat:/takeover' });
	assert.match(accepted.payload.evidenceId as string, /^E-\d{6,}$/);
	const summary = 'finished by hand';
	const completed = await store.takeoverComplete({
		graphId, stepId: 'S-01', summary, actor: 'human', origin: 'chat:/takeover',
		evidence: [{ kind: 'note', uri: `flauz-test://takeover/${started.idempotencyKey}`, sha256: sha256Of(summary) }],
	});
	assert.match(completed.payload.evidenceId as string, /^E-\d{6,}$/);
	const state = store.getGraphState(graphId) as { steps: Record<string, { status: string; takeover: Record<string, unknown> | null }> };
	assert.equal(state.steps['S-01'].status, 'succeeded');
	const takeover = state.steps['S-01'].takeover as { requestedBy: string; state: string };
	assert.equal(takeover.requestedBy, 'agent', 'the provenance records WHO requested the takeover');
	assert.equal(takeover.state, 'completed');
	// every takeover leg's evidence row references its journal row
	const ledger = readLedger(root);
	for (const row of [requested, accepted, completed]) {
		const ledgerRow = ledgerRowOfEvidenceId(ledger, row.payload.evidenceId as string);
		assert.equal(ledgerRow?.uri, `flauz-orch-transition://${row.rowId}`);
		assert.equal(ledgerRow?.sha256, contentHashOf(transitionFactsOf(row)));
	}
});

// ---------------------------------------------------------------------------
// Leases and claims: notices with evidence; conflicts informational (v0)
// ---------------------------------------------------------------------------

test('claim/lease lifecycle mints notice evidence; conflicts are informational with per-class notices', async () => {
	const { store, root } = makeWiredStore('lease');
	const graphId = await submittedApproved(store, [{ stepId: 'S-01', title: 'shared work', instruction: 'contended' }]);
	const claim = await store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'a2a:agent-a' });
	const lease = await store.acquireLease({ graphId, stepId: 'S-01', holder: 'agent-a', ttlMs: 60000, actor: 'agent', origin: 'a2a:agent-a' });
	const renewed = await store.renewLease({ graphId, stepId: 'S-01', ttlMs: 60000, actor: 'agent', origin: 'a2a:agent-a' });
	for (const row of [claim, lease, renewed]) {
		assert.match(row.payload.evidenceId as string, /^E-\d{6,}$/);
	}
	// a non-holder start records ONE conflict notice PER violation class (claim + lease), each with evidence, then proceeds
	const started = await store.startStep({ graphId, stepId: 'S-01', runnerId: 'runner-b', actor: 'agent', origin: 'test:tl2004' });
	assert.equal(started.attempt, 1, 'v0 enforcement is informational: the start proceeds after the notices');
	const conflicts = store.journalRows.filter((row) => row.type === 'conflict-noticed');
	assert.equal(conflicts.length, 2);
	assert.deepEqual(conflicts.map((row) => row.payload.violation), ['claim', 'lease']);
	const conflictLedger = readLedger(root);
	for (const row of conflicts) {
		assert.match(row.payload.evidenceId as string, /^E-\d{6,}$/);
		const ledgerRow = ledgerRowOfEvidenceId(conflictLedger, row.payload.evidenceId as string);
		assert.equal(ledgerRow?.uri, `flauz-orch-transition://${row.rowId}`);
	}
	await store.releaseLease({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:tl2004' });
	await store.releaseClaim({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:tl2004' });
	assert.equal(store.verifyJournal().ok, true);
});

// ---------------------------------------------------------------------------
// The runtime gate path: evidence-bearing requests + the drive-loop expiry
// ---------------------------------------------------------------------------

test('driveGraph records evidence-bearing approval requests and expires passed deadlines', async () => {
	const { store, root } = makeWiredStore('runtime-gate');
	const submitted = await store.submitGraph({
		title: 'runtime gate graph',
		steps: [
			{ stepId: 'S-01', title: 'open the gate', instruction: 'first', gate: 'human-approval', },
			{ stepId: 'S-02', title: 'timed gate', instruction: 'second', gate: 'human-approval' },
		],
		policy: { onStepFailure: 'continue' },
		actor: 'agent', origin: 'test:tl2004',
	});
	await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:tl2004' });
	// arm S-02 with a deadline that has ALREADY passed relative to the drive clock
	const requested = await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-02', reason: 'timed', expiresAt: 1700000100000, actor: 'service', origin: 'runtime:gate' });
	assert.match(requested.payload.evidenceId as string, /^E-\d{6,}$/);
	// drive: S-01 gets its REQUEST (evidence-bearing, never a grant) and stalls; S-02's deadline passes -> expired
	const sink = { run: async () => ({ ok: true, value: 'x', replayed: false }) };
	await driveGraph(store, { graphId: submitted.graphId, sink, now: 1893456000000, runnerId: 'runtime' });
	const state = store.getGraphState(submitted.graphId) as { steps: Record<string, { status: string; approval: { state: string; evidenceId?: string } | null }> };
	assert.equal(state.steps['S-01'].status, 'awaiting-approval', 'the human gate holds - never auto-granted');
	assert.equal(state.steps['S-01'].approval?.evidenceId !== undefined, true, 'the runtime-recorded request carries its evidence row');
	assert.equal(state.steps['S-02'].status, 'cancelled', 'the passed deadline expired the gate (fail-closed)');
	assert.equal(state.steps['S-02'].approval?.state, 'expired');
	// the expiry row is journaled with the runtime origin
	const expiredRow = store.journalRows.find((row) => row.type === 'approval-expired');
	assert.equal(expiredRow?.origin, 'runtime:gate-expiry');
	// grant S-01 by a human and drive to completion
	await store.approvalDecide({ graphId: submitted.graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'chat:/approve' });
	await driveGraph(store, { graphId: submitted.graphId, sink, now: 1893456000000, runnerId: 'runtime' });
	const after = store.getGraphState(submitted.graphId) as { graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(after.steps['S-01'].status, 'succeeded');
	// 'continue' policy: the expired S-02 stays cancelled; the graph never completes (a cancelled step is terminal)
	assert.equal(after.graphStatus, 'approved');
	assert.equal(after.steps['S-02'].status, 'cancelled');
	assert.equal(store.verifyJournal().ok, true);
	// every evidence uri in the ledger references a real journal row (the whole-run linkage invariant)
	const rowIds = new Set(store.journalRows.map((row) => row.rowId));
	for (const ledgerRow of readLedger(root)) {
		if (typeof ledgerRow.uri === 'string' && ledgerRow.uri.startsWith('flauz-orch-transition://')) {
			assert.ok(rowIds.has(ledgerRow.uri.slice('flauz-orch-transition://'.length)), String(ledgerRow.uri));
		}
	}
});

test('evidence rows reference the linked task and survive store reload (restart-safe linkage)', async () => {
	const { store, root } = makeWiredStore('reload-linkage');
	const graphId = await submittedApproved(store);
	const requested = await store.approvalRequest({ graphId, stepId: 'S-01', reason: 'gate', actor: 'agent', origin: 'test:tl2004' });
	const evidenceId = requested.payload.evidenceId as string;
	// the ledger row is linked to the graph's T-task
	const linked = ledgerRowOfEvidenceId(readLedger(root), evidenceId);
	assert.equal(linked?.taskId, 'T-001');
	// reload: the same evidenceId replays from the journal (the linkage is durable state, not memory)
	const reloaded = new OrchestrationStore(root, { clock: makeClock(1750000000000).clock });
	const state = reloaded.getGraphState(graphId) as { steps: Record<string, { approval: { evidenceId?: string; state: string } | null }> };
	assert.equal(state.steps['S-01'].approval?.evidenceId, evidenceId);
	assert.equal(state.steps['S-01'].approval?.state, 'pending');
});

// ---------------------------------------------------------------------------
// The transition lock: concurrent ops serialize; the rowId linkage never shifts
// ---------------------------------------------------------------------------

test('concurrent evidence-bearing ops serialize through the transition lock (no shifted linkage)', async () => {
	const { store, root } = makeWiredStore('lock');
	const graphId = await submittedApproved(store, [{ stepId: 'S-01', title: 'a', instruction: 'a' }, { stepId: 'S-02', title: 'b', instruction: 'b' }]);
	// fire concurrent ops on different steps (the lock serializes the mint windows)
	const [claimA, claimB] = await Promise.all([
		store.acquireClaim({ graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'test:lock' }),
		store.acquireClaim({ graphId, stepId: 'S-02', holder: 'agent-b', actor: 'agent', origin: 'test:lock' }),
	]);
	// every minted evidence uri references the row the append actually landed at
	const ledger = readLedger(root);
	for (const row of [claimA, claimB]) {
		const ledgerRow = ledgerRowOfEvidenceId(ledger, row.payload.evidenceId as string);
		assert.equal(ledgerRow?.uri, `flauz-orch-transition://${row.rowId}`, 'the rowId linkage held under concurrency');
	}
	assert.equal(store.verifyJournal().ok, true);
});
