/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-204 — the takeover acceptance tests (the fifth human gate).
 *
 * Finding: the takeover capability (flauz.orch.requestTakeover /
 * acceptTakeover / completeTakeover — actor `human`, kill-recover-proven)
 * had NO user-facing affordance. These tests prove the LEG 9 behavior
 * through the user-facing surfaces this fix lands:
 *
 *   1. the participant `/takeover` command performs the request -> accept ->
 *      complete sequence on the active task's stuck (gate-pending) step,
 *      every journal row attributed to the human, the step completed by the
 *      HUMAN (never an agent execution — no step-started row), and the
 *      takeover evidence rows land in the shared ledger;
 *   2. the Agent Sessions takeover probe reports the stuck step before and
 *      nothing after (the view row's data contract);
 *   3. a half-done takeover (the kill-recover hold: takeover-pending) is
 *      resumed, never re-requested — the human-only transitions hold;
 *   4. /takeover with nothing stuck answers honestly (fail-closed, no
 *      fabricated success).
 *
 * Runtime level: the REAL core service child process (seam), the REAL
 * orchestration store/mediator over the real filesystem — the same stack
 * extension.ts wires.
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockVscode } from './harness/vscode-mock.ts';
import { createFakeWorkspace, drive } from './harness/fakeWorkspace.ts';
import { SeamClient } from '../src/seamClient.ts';
import { Orchestrator, type ToolResultLike } from '../src/orchestrator.ts';
import { registerParticipant, PARTICIPANT_ID } from '../src/participant.ts';
import { createOrchTakeoverPort, seamTaskPort, TAKEOVER_ORIGIN, type TakeoverPort } from '../src/takeover.ts';
import { selectPreferredModels, type ModelSelection } from '../src/models.ts';
import { OrchestrationStore } from '../core/orchStore.mjs';
import type { JournalRow } from '../core/orchestration.mjs';
import type * as vscode from 'vscode';

function sha256Hex(text: string): string {
	return createHash('sha256').update(text, 'utf-8').digest('hex');
}

interface StuckWorkspace {
	root: string;
	seam: SeamClient;
	port: TakeoverPort;
	taskId: string;
	handler: vscode.ChatRequestHandler;
	readLedgerLines(): string[];
	dispose(): Promise<void>;
}

/**
 * The LEG 9 posture: a real task with a real graph whose one step is gated on
 * a PENDING approval — the exact "stuck step" the finding describes — plus the
 * full participant wiring (orchestrator + takeover port) over the real seam.
 */
async function setupStuckWorkspace(): Promise<StuckWorkspace> {
	const workspace = createFakeWorkspace();
	const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-p2fix204-storage-'));
	mkdirSync(globalStorage, { recursive: true });
	const seam = await SeamClient.start({
		workspaceRoot: workspace.root,
		globalStoragePath: globalStorage,
		logger: () => undefined,
	});
	const taskPort = seamTaskPort(seam);
	const { taskId } = await seam.createTask('take over the stuck release decision');
	const store = new OrchestrationStore(workspace.root, { taskPort });
	await store.submitGraph({
		title: 'release decision',
		steps: [{ stepId: 'S-01', title: 'stuck work', instruction: 'needs the human', gate: 'human-approval' }],
		taskId,
		actor: 'agent',
		origin: 'test:p2fix204',
	});
	store.approveGraph({ graphId: 'G-001', actor: 'human', origin: 'test:p2fix204' });
	await store.approvalRequest({ graphId: 'G-001', stepId: 'S-01', reason: 'the gated release decision', actor: 'agent', origin: 'test:p2fix204' });

	const port = createOrchTakeoverPort(workspace.root, taskPort, () => undefined);
	const { vscode: api, state } = createMockVscode({
		models: [{ vendor: 'flauz-mock', id: 'echo-1', family: 'flauz-echo', version: '1', name: 'Flauz Mock Echo' }],
	});
	const selection: { current: ModelSelection } = { current: { models: [], status: 'no-models' } };
	const orchestrator = new Orchestrator({
		seam,
		workspaceRoot: workspace.root,
		getModelSelection: () => selection.current,
		invokeTool: async () => ({ content: [{ value: 'unused' }] }) as ToolResultLike,
		takeoverPort: port,
		logger: () => undefined,
	});
	registerParticipant((id, handler) => api.chat.createChatParticipant(id, handler), {
		orchestrator,
		getModelSelection: () => selection.current,
	});
	selection.current = await selectPreferredModels((selector) => api.lm.selectChatModels(selector));
	const participant = state.participants.find((entry) => entry.id === PARTICIPANT_ID);
	ok(participant, 'participant registered');
	return {
		root: workspace.root,
		seam,
		port,
		taskId,
		handler: participant.handler,
		readLedgerLines: workspace.readLedgerLines,
		dispose: () => seam.dispose(),
	};
}

/** Reads the journal back strictly (a fresh store verifies the chain at load). */
function readJournal(root: string): JournalRow[] {
	return new OrchestrationStore(root).journalRows;
}

test('P2-FIX-204: /takeover performs the request->accept sequence, the step completes as the human, evidence lands in the ledger', async () => {
	const stuck = await setupStuckWorkspace();
	try {
		// (0) the view probe sees the stuck step BEFORE the takeover (the row's data contract).
		const before = await stuck.port.stuckStepOf(stuck.taskId);
		ok(before !== undefined, 'the stuck step is visible to the sessions view probe');
		strictEqual(before.state, 'stuck');
		strictEqual(before.graphId, 'G-001');
		strictEqual(before.stepId, 'S-01');

		// (1) the human gate turn: /takeover with the human's completion note.
		const completionNote = 'the human completed the gated release decision personally';
		const result = await drive(stuck.handler, { command: 'takeover', prompt: completionNote });
		const text = result.markdown.join('\n');
		match(text, /taken over by you/i);
		match(text, /takeover-requested` → `takeover-accepted` → `takeover-completed`/);
		match(text, /flauz-orch-takeover:\/\/G-001\/S-01/);
		match(text, /actor \*\*human\*\*/);

		// (2) the step completed as the HUMAN — never by an agent execution.
		const journal = readJournal(stuck.root);
		const takeoverRows = journal.filter(row => row.type.startsWith('takeover-'));
		strictEqual(takeoverRows.map(row => row.type).join(','), 'takeover-requested,takeover-accepted,takeover-completed');
		ok(takeoverRows.every(row => row.actor === 'human'), 'every takeover journal row carries the human attribution');
		strictEqual(new Set(takeoverRows.map(row => row.origin)).size, 1, 'one provenance origin');
		strictEqual(takeoverRows[0].origin, TAKEOVER_ORIGIN, 'the rows came through the user-facing affordance');
		const completed = takeoverRows.find(row => row.type === 'takeover-completed');
		ok(completed !== undefined, 'the completion row landed');
		ok(journal.every(row => !(row.type === 'step-started' && row.stepId === 'S-01')), 'the gated step NEVER started (fail-closed: no agent execution)');

		// (3) the durable state: step succeeded, takeover state completed.
		const store = new OrchestrationStore(stuck.root);
		const state = store.stateOf('G-001');
		strictEqual(state.steps['S-01']?.status, 'succeeded', 'the taken-over step is completed');
		strictEqual(state.steps['S-01']?.takeover?.state, 'completed', 'the takeover state is recorded on the step');
		strictEqual(store.verifyJournal().ok, true, 'the journal chain verifies');

		// (4) the evidence discipline: the setup's approval row + 3 takeover transition rows + 1 step-evidence row.
		const ledgerLines = stuck.readLedgerLines().map(line => JSON.parse(line) as Record<string, unknown>);
		strictEqual(ledgerLines.length, 5, 'approval-requested + request/accept/complete transitions + the completion evidence');
		strictEqual(ledgerLines.filter(row => row.kind === 'note').length, 5);
		const transitionRows = ledgerLines.filter(row => String(row.uri).startsWith('flauz-orch-transition://R-'));
		strictEqual(transitionRows.length, 4, 'each evidence-bearing op minted its transition row (approval + the three takeover ops)');
		const completionEvidence = ledgerLines.find(row => row.uri === 'flauz-orch-takeover://G-001/S-01');
		ok(completionEvidence !== undefined, 'the LEG 9 evidence uri discipline');
		strictEqual(completionEvidence.sha256, sha256Hex(completionNote), 'the evidence hash covers the human summary');
		strictEqual(completionEvidence.taskId, stuck.taskId, 'the evidence row is attached to the active task');
		const verdict = await stuck.seam.verifyLedger();
		ok(verdict.ok, 'the shared ledger chain verifies through the seam');
		strictEqual(verdict.rows, 5);

		// (5) the evidenceId is embedded in the journal completion row (the graph <-> ledger linkage).
		const evidenceIds = (completed?.payload as { evidence?: Array<{ evidenceId?: string; uri?: string }> }).evidence ?? [];
		strictEqual(evidenceIds[0]?.uri, 'flauz-orch-takeover://G-001/S-01');
		match(String(evidenceIds[0]?.evidenceId ?? ''), /^E-\d{6}$/);

		// (6) after the takeover the probe reports nothing (the row disappears).
		const after = await stuck.port.stuckStepOf(stuck.taskId);
		strictEqual(after, undefined, 'no human-held step remains after the completion');
	} finally {
		await stuck.dispose();
	}
});

test('P2-FIX-204: a half-done takeover (the kill-recover hold) is resumed, never re-requested — human-only transitions hold', async () => {
	const stuck = await setupStuckWorkspace();
	try {
		// The kill-recover posture: a takeover was requested (e.g. before a crash)
		// and the step holds in takeover-pending — recovery NEVER advances it.
		const store = new OrchestrationStore(stuck.root, { taskPort: seamTaskPort(stuck.seam) });
		await store.takeoverRequest({ graphId: 'G-001', stepId: 'S-01', actor: 'human', origin: 'test:p2fix204' });
		const held = await stuck.port.stuckStepOf(stuck.taskId);
		ok(held !== undefined && held.state === 'takeover-pending', 'the probe reports the pending takeover hold');

		const result = await drive(stuck.handler, { command: 'takeover', prompt: 'finished it myself after the restart' });
		match(result.markdown.join('\n'), /takeover-accepted` → `takeover-completed`/);

		const journal = readJournal(stuck.root);
		const takeoverRows = journal.filter(row => row.type.startsWith('takeover-'));
		// Exactly one request total (the pre-crash one) — the /takeover turn only accepted and completed.
		strictEqual(takeoverRows.filter(row => row.type === 'takeover-requested').length, 1);
		strictEqual(takeoverRows.map(row => row.type).join(','), 'takeover-requested,takeover-accepted,takeover-completed');
		ok(takeoverRows.every(row => row.actor === 'human'));
		strictEqual(new OrchestrationStore(stuck.root).stateOf('G-001').steps['S-01']?.status, 'succeeded');
	} finally {
		await stuck.dispose();
	}
});

test('P2-FIX-204: /takeover with nothing stuck answers honestly (fail-closed, no fabricated success)', async () => {
	const stuck = await setupStuckWorkspace();
	try {
		// Complete the stuck step first (nothing left to take over).
		await drive(stuck.handler, { command: 'takeover', prompt: 'done by hand' });
		const second = await drive(stuck.handler, { command: 'takeover', prompt: 'try again' });
		const text = second.markdown.join('\n');
		match(text, /Nothing to take over/);
		match(text, /No step of G-001 is waiting on a human gate/);
		// And nothing new landed in either durable surface.
		const journal = readJournal(stuck.root);
		strictEqual(journal.filter(row => row.type.startsWith('takeover-')).length, 3, 'no extra takeover rows');
		strictEqual(stuck.readLedgerLines().length, 5, 'no extra ledger rows');
	} finally {
		await stuck.dispose();
	}
});

test('P2-FIX-204: /takeover without a graph is honest, not fabricated', async () => {
	const workspace = createFakeWorkspace();
	const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-p2fix204-nograph-'));
	mkdirSync(globalStorage, { recursive: true });
	const seam = await SeamClient.start({ workspaceRoot: workspace.root, globalStoragePath: globalStorage, logger: () => undefined });
	try {
		const { taskId } = await seam.createTask('no graph yet');
		const port = createOrchTakeoverPort(workspace.root, seamTaskPort(seam), () => undefined);
		const result = await port.takeOverStep(taskId, '');
		if (result.outcome !== 'none') {
			throw new Error(`expected the honest 'none' outcome, got '${result.outcome}'`);
		}
		match(result.message, /has no orchestration graph to take over/);
	} finally {
		await seam.dispose();
	}
});
