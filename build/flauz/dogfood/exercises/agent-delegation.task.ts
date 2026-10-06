/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W7 (the agent-with-tools dogfood lane) -- EXERCISE 3:
 * agent-delegation.
 *
 * Drives the REAL flauz-agent orchestration pipeline the way the product's
 * own golden path does (extensions/flauz-agent/test/goldenPath.test.ts +
 * takeover.p2fix204.test.ts -- the exact machinery, the sanctioned
 * test-time cross-extension imports):
 *
 *   (1) the golden path WITH a refusal leg: a real task envelope through
 *       plan -> HUMAN APPROVAL (/approve) -> the flauz_terminal tool
 *       invocation whose confirmation gate the human DENIES first (the
 *       fail-closed refusal: the task fails, NO evidence rows) -> a fresh
 *       task whose approved execution REALLY runs the golden command in a
 *       real /bin/sh terminal -> evidence rows (command-output + changeset)
 *       -> report -> verify-pass (the ledger verified through the real
 *       seam) -> HUMAN SIGN-OFF (/sign-off -> done);
 *   (2) the DELEGATION edge: an orchestration graph whose delegated step
 *       passes the step-level approval gate (approval-requested ->
 *       approval-granted, actor human), then the real composed ops
 *       (core/routing.mjs): route-decided (WHY this agent) + startStep
 *       (runner = the worker) + the typed a2a task-delegation message
 *       posted through the REAL core service's flauz.aa seam + the
 *       delegation-sent receipt; a SECOND agent session (the worker) opens
 *       (mailbox collection + session-tier memory + the exclusive claim),
 *       receives the delegated sub-task and performs a REAL
 *       implementation-and-test act: it creates a scratch module + test in
 *       the session workspace and runs the test through the REAL tool
 *       invocation (the confirmation gate in front), evidencing the output
 *       as a command-output ledger row through the real service; the
 *       worker's a2a result-report is ingested (ingestResultReport ->
 *       result-received + step-succeeded) and the graph completes;
 *   (3) the TAKEOVER transition: a gated step stuck on a pending approval
 *       (gate 'human-approval' + approval-requested) is taken over through
 *       the agent runtime's user-facing surface (the participant /takeover
 *       command -> the real takeover port -> request -> accept ->
 *       complete, every journal row actor `human`, the step NEVER started
 *       by an agent, takeover evidence minted into the shared ledger).
 *
 * The friction log captures EVERY human intervention as a first-class
 * friction row (each approval, each confirmation, each sign-off, the
 * takeover) -- that is the point of the exercise.
 *
 * Model intelligence: the golden-path orchestrator's deterministic plan
 * over the mock model selection (the product's own documented v0
 * simplification -- fixture level, claimed exactly so); the SEAMS are all
 * local-real (the real core-service child process, the real a2a bus, the
 * real orchestration store/mediator, the real terminal tool over a real
 * /bin/sh child).
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { SeamClient } from '../../../../extensions/flauz-agent/src/seamClient.ts';
import { Orchestrator, GOLDEN_COMMAND, type ToolResultLike } from '../../../../extensions/flauz-agent/src/orchestrator.ts';
import { registerParticipant, PARTICIPANT_ID } from '../../../../extensions/flauz-agent/src/participant.ts';
import { selectPreferredModels, type ModelSelection } from '../../../../extensions/flauz-agent/src/models.ts';
import { createOrchTakeoverPort, seamTaskPort, type TakeoverPort } from '../../../../extensions/flauz-agent/src/takeover.ts';
import { writeCommandOutput } from '../../../../extensions/flauz-agent/src/artifacts.ts';
import { registerTerminalTool } from '../../../../extensions/flauz-agent/src/tools/terminalTool.ts';
import { drive } from '../../../../extensions/flauz-agent/test/harness/fakeWorkspace.ts';
import { OrchestrationStore } from '../../../../extensions/flauz-agent/core/orchStore.mjs';
import { delegateStep, ingestResultReport } from '../../../../extensions/flauz-agent/core/routing.mjs';
import { MemoryStore } from '../../../../extensions/flauz-memory/src/memory.ts';
import { createAgentToolSurface, mintToolReceipt, type AgentToolSurface, type ToolReceipt } from '../agentTools.ts';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem } from '../harnessTypes.ts';

/** The pinned schema id of the exercise's session report. */
export const DELEGATION_REPORT_SCHEMA = 'flauz.dogfood-delegation-report/v1';

/** The primary agent (the delegating parent session). */
export const PRIMARY_AGENT = 'flauz.agent.primary';

/** The worker agent (the delegated second session). */
export const WORKER_AGENT = 'flauz.agent.worker';

/** The delegated scratch module (the implementation-and-test act's subject). */
export const DELEGATED_MODULE_REL = 'scratch/w7-delegated-gcd.mjs';
export const DELEGATED_TEST_REL = 'scratch/w7-delegated-gcd.test.mjs';

/** The command the delegated test run executes through the real tool invocation. */
export const DELEGATED_TEST_COMMAND = 'node scratch/w7-delegated-gcd.test.mjs';

/** The module the worker authors (a tiny deterministic gcd implementation -- the dogfooded implementation work). */
export const DELEGATED_MODULE_SOURCE = [
        '/**',
        ' * The A-PROD-003-W7 delegated scratch module (the worker session\'s implementation act).',
        ' */',
        'export function flauzW7Gcd(a, b) {',
        '        let x = Math.abs(a);',
        '        let y = Math.abs(b);',
        '        while (y !== 0) {',
        '                const next = x % y;',
        '                x = y;',
        '                y = next;',
        '        }',
        '        return x;',
        '}',
        '',
].join('\n');

/** The test the worker authors and runs through the real tool invocation (node's own assert -- the dogfooded test act). */
export const DELEGATED_TEST_SOURCE = [
        'import { flauzW7Gcd } from \'./w7-delegated-gcd.mjs\';',
        'import assert from \'node:assert/strict\';',
        'assert.equal(flauzW7Gcd(12, 18), 6);',
        'assert.equal(flauzW7Gcd(7, 13), 1);',
        'assert.equal(flauzW7Gcd(0, 9), 9);',
        'assert.equal(flauzW7Gcd(-4, 6), 2);',
        'console.log(\'w7 delegated module test: PASS (gcd 12/18=6, 7/13=1, 0/9=9, -4/6=2)\');',
        '',
].join('\n');

/** The a2a evidence id in the E-NNNNNN journal discipline (the seam returns the unpadded seq projection). */
export function paddedEvidenceId(seq: number): string {
        return `E-${String(seq).padStart(6, '0')}`;
}

/** The a2a bus port over the REAL core service seam (the bus the service owns -- the single-writer law). */
function seamBusPort(seam: SeamClient) {
        return {
                post: async (input: { message: Record<string, unknown> }) =>
                        seam.request<{ id: string; seq: number; message: Record<string, unknown> }>('flauz.a2a.post', { message: input.message }),
        };
}

/** The session workspace's fs port (the journey-drill runtime pattern: the same port shape the driver boots). */
function sessionFsPort() {
        return {
                readFileUtf8: async (target: string) => {
                        try {
                                return await nodeFs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target: string, contents: string) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target: string, contents: string) => nodeFs.appendFile(target, contents, { encoding: 'utf-8' }),
                rename: (from: string, to: string) => nodeFs.rename(from, to),
                mkdir: async (target: string) => { await nodeFs.mkdir(target, { recursive: true }); },
                readdir: async (target: string) => (await nodeFs.readdir(target)).sort(),
        };
}

/** Counts the session ledger's rows (the fail-closed discipline's observable). */
async function countSessionLedgerRows(sessionRoot: string): Promise<number> {
        try {
                const text = await nodeFs.readFile(nodePath.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' });
                return text.split('\n').filter(line => line.length > 0).length;
        } catch {
                return 0;
        }
}

async function readSessionA2aMessages(sessionRoot: string): Promise<Array<Record<string, unknown>>> {
        try {
                const text = await nodeFs.readFile(nodePath.join(sessionRoot, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' });
                return text.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as Record<string, unknown>);
        } catch {
                return [];
        }
}

class Recorder {
        readonly checks: ExerciseCheck[] = [];

        check(id: string, ok: boolean, detail: string): boolean {
                this.checks.push({ id, ok, detail });
                return ok;
        }
}

/** Writes one driver-level workspace artifact + its evidence row (the journey's mint pattern). */
async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha256 = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256, note });
        return { item: { kind: 'note', uri, sha256 }, evidenceId: appended.evidenceId };
}

/** The booted agent session (the product's golden-path composition + the takeover port + the REAL terminal). */
export interface SessionFacts {
        sessionRoot: string;
        seam: SeamClient;
        surface: AgentToolSurface;
        orchestrator: Orchestrator;
        handler: (request: { prompt?: string; command?: string }, extra?: { toolInvocationToken?: unknown }) => Promise<{ markdown: string[]; progress: string[] }>;
        takeoverPort: TakeoverPort;
        memory: MemoryStore;
        store: OrchestrationStore;
        dispose(): Promise<void>;
}

/** Boots the full agent session on its own workspace root (the goldenPath composition + the takeover port + the REAL terminal). */
export async function bootAgentSession(sessionRoot: string, log: (line: string) => void): Promise<SessionFacts> {
        await nodeFs.mkdir(sessionRoot, { recursive: true });
        const seam = await SeamClient.start({ workspaceRoot: sessionRoot, logger: () => undefined });
        const surface = createAgentToolSurface({ cwd: sessionRoot, confirmationPolicy: () => true, logger: () => undefined });
        const taskPort = seamTaskPort(seam);
        const takeoverPort = createOrchTakeoverPort(sessionRoot, taskPort, () => undefined);
        const selection: { current: ModelSelection } = { current: { models: [], status: 'no-models' } };
        const orchestrator = new Orchestrator({
                seam,
                workspaceRoot: sessionRoot,
                getModelSelection: () => selection.current,
                invokeTool: (name, options) => surface.api.lm.invokeTool(name, options) as Promise<ToolResultLike>,
                takeoverPort,
                logger: line => log(line),
        });
        const { registerTerminalTool: registerTerminal } = { registerTerminalTool };
        registerTerminal((name, tool) => surface.api.lm.registerTool(name, tool), {
                terminalFactory: surface.terminalFactory,
                logger: line => log(line),
        });
        registerParticipant((id, handler) => surface.api.chat.createChatParticipant(id, handler), {
                orchestrator,
                getModelSelection: () => selection.current,
        });
        selection.current = await selectPreferredModels((selector) => surface.api.lm.selectChatModels(selector));
        const participant = surface.state.participants.find(entry => entry.id === PARTICIPANT_ID);
        if (participant === undefined) {
                throw new Error('the flauz.agent participant did not register (machinery failure)');
        }
        const memory = new MemoryStore({ root: sessionRoot, fs: sessionFsPort(), clock: () => Date.now() });
        await memory.ensure();
        const store = new OrchestrationStore(sessionRoot, { taskPort });
        return {
                sessionRoot,
                seam,
                surface,
                orchestrator,
                handler: request => drive(participant.handler, request),
                takeoverPort,
                memory,
                store,
                dispose: async () => {
                        await seam.dispose();
                        surface.dispose();
                },
        };
}

export const AGENT_DELEGATION_EXERCISE: DogfoodExercise = {
        id: 'agent-delegation',
        title: 'agent delegation: golden path + approvals/takeover + a delegated implementation-and-test session',
        prompt: 'Dogfood the real flauz-agent orchestration pipeline end to end: the golden path with its approval gates and terminal tool, a delegated worker session performing a real implementation-and-test act, and a human takeover of a stuck gated step.',
        dimensions: ['multi-agent delegation', 'approvals/takeover', 'implementation/tests as dogfooded work', 'artifacts/evidence', 'slow-path timing'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];
                const receipts: ToolReceipt[] = [];
                const sessionRoot = nodePath.join(harness.root, 'w7-agent-delegation-session');
                const log = (line: string) => {
                        harness.log(line);
                };

                // (0) boot the real session machinery (the goldenPath composition)
                const bootStartedAt = Date.now();
                let session: SessionFacts;
                try {
                        session = await bootAgentSession(sessionRoot, log);
                } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        await harness.friction.friction({
                                phase: 'agent-delegation:session-boot',
                                kind: 'failed-task',
                                detail: `the agent session machinery failed to boot: ${message}`,
                                recovery: '',
                        });
                        recorder.check('delegation.session-booted', false, `the agent session machinery failed to boot: ${message}`);
                        return {
                                schema: 'flauz.dogfood-exercise-receipt/v1',
                                exerciseId: 'agent-delegation',
                                title: 'agent delegation: golden path + approvals/takeover + a delegated implementation-and-test session',
                                dimensions: ['multi-agent delegation', 'approvals/takeover', 'implementation/tests as dogfooded work', 'artifacts/evidence', 'slow-path timing'],
                                verdict: 'FAIL',
                                checks: recorder.checks,
                                evidenceIds,
                                evidenceItems,
                                frictionLogPath: harness.friction.path,
                                frictionRows: { friction: 1, timing: 0, recovery: 0 },
                                evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                                notes,
                        };
                }
                try {
                        await harness.friction.timing({ phase: 'agent-delegation:session-boot', durationMs: Date.now() - bootStartedAt });
                        recorder.check('delegation.session-booted', true, `the REAL core service seam (protocol ${session.seam.protocolVersion}) + the flauz.agent participant + the flauz_terminal tool (real /bin/sh terminal on ${sessionRoot}) booted through the product's own golden-path wiring`);

                        // (1) THE GOLDEN PATH WITH THE REFUSAL LEG ---------------------------------
                        // the human DENIES the first tool confirmation: the task must fail
                        // fail-closed with NO evidence rows (the product's own gate semantics)
                        session.surface.setConfirmationPolicy(() => false);
                        const refusalTurnStartedAt = Date.now();
                        await session.handler({ prompt: 'prove the agent-with-tools golden path end to end (the first attempt will be denied at the tool confirmation gate)' });
                        const refusalTurn = await session.handler({ command: 'approve', prompt: '' });
                        await harness.friction.timing({ phase: 'agent-delegation:golden-refusal-turn', durationMs: Date.now() - refusalTurnStartedAt });
                        const refusalTask = (await session.seam.listTasks()).tasks.find(task => task.id === 'T-001');
                        const refusalFailEvent = refusalTask?.events.find((event: { type: string }) => event.type === 'fail');
                        const refusalDecision = session.surface.decisions[0];
                        const refusalReceipt = mintToolReceipt({
                                receiptId: 'R-1',
                                command: GOLDEN_COMMAND,
                                decision: refusalDecision,
                                refusal: 'the human DENIED the flauz_terminal confirmation at the tool approval gate (the invocation was refused before execution)',
                                ts: refusalDecision?.at ?? Date.now(),
                        });
                        receipts.push(refusalReceipt);
                        const rowsAfterRefusal = await countSessionLedgerRows(sessionRoot);
                        const refusalOk = refusalTask?.status === 'failed'
                                && refusalFailEvent !== undefined
                                && /rejected by user/.test(String((refusalFailEvent as { payload?: { error?: unknown } }).payload?.error ?? ''))
                                && /failed/.test(refusalTurn.markdown.join('\n'))
                                && rowsAfterRefusal === 0
                                && refusalReceipt.approval.asked && !refusalReceipt.approval.granted && refusalReceipt.execution === null;
                        recorder.check('delegation.golden-refusal-fail-closed', refusalOk, refusalOk
                                ? `the DENIED flauz_terminal confirmation failed task T-001 fail-closed (status failed, the fail event carries "rejected by user") and NO evidence rows were minted (ledger rows after the refusal: ${String(rowsAfterRefusal)}); receipt R-1 records the denied gate`
                                : `the refusal leg did not behave fail-closed (task status ${String(refusalTask?.status)}, fail event ${refusalFailEvent === undefined ? 'missing' : 'present'}, ledger rows ${String(rowsAfterRefusal)})`);

                        // the human's interventions so far: the plan approval of T-001, then the denial
                        await harness.friction.friction({
                                phase: 'agent-delegation:golden-plan-approval',
                                kind: 'manual-intervention',
                                detail: 'the human approved the golden-path plan of task T-001 (/approve: awaiting-approval -> execute) -- the execution then reached the flauz_terminal confirmation gate',
                                recovery: '',
                        });
                        await harness.friction.friction({
                                phase: 'agent-delegation:golden-refusal',
                                kind: 'manual-intervention',
                                detail: 'the human DENIED the flauz_terminal confirmation for the golden command on task T-001 (the tool approval gate): the task failed fail-closed and NO evidence rows were minted for it',
                                recovery: 'the work was re-submitted as a fresh task (T-002) whose approved execution completed the golden path end to end (command-output + changeset evidence rows, verify-pass, sign-off)',
                        });

                        // the re-run: the human GRANTS the confirmation; the golden command REALLY executes
                        session.surface.setConfirmationPolicy(() => true);
                        const approvedTurnStartedAt = Date.now();
                        await session.handler({ prompt: 'retry the golden path with the tool confirmation granted this time' });
                        await session.handler({ command: 'approve', prompt: '' });
                        await session.handler({ command: 'sign-off', prompt: '' });
                        await harness.friction.timing({ phase: 'agent-delegation:golden-approved-turn', durationMs: Date.now() - approvedTurnStartedAt });
                        const goldenTask = (await session.seam.listTasks()).tasks.find(task => task.id === 'T-002');
                        const goldenTrail = (goldenTask?.events ?? []).map((event: { actor: string; type: string }) => `${event.actor}/${event.type}`);
                        const goldenLedger = await session.seam.verifyLedger();
                        const goldenExecution = session.surface.executions.find(execution => execution.command === GOLDEN_COMMAND);
                        const goldenDecision = session.surface.decisions[1];
                        const goldenArtifactUri = '.flauz/artifacts/T-002/command-output-1.txt';
                        const goldenArtifact = await nodeFs.readFile(nodePath.join(sessionRoot, goldenArtifactUri), { encoding: 'utf-8' }).catch(() => '');
                        const goldenReceipt = mintToolReceipt({
                                receiptId: 'R-2',
                                command: GOLDEN_COMMAND,
                                decision: goldenDecision,
                                execution: goldenExecution,
                                ts: goldenDecision?.at ?? Date.now(),
                        });
                        receipts.push(goldenReceipt);
                        const goldenRows = await countSessionLedgerRows(sessionRoot);
                        const goldenOk = goldenTask?.status === 'done'
                                && goldenTrail.join(' | ') === 'agent/created | agent/submit-plan | human/approve | agent/report | tool/verify-pass | human/sign-off'
                                && goldenLedger.ok === true && goldenRows === 2
                                && goldenExecution !== undefined && goldenExecution.exitCode === 0
                                && goldenExecution.stdout.trim() === 'flauz-golden-path-ok'
                                && goldenArtifact.trim() === 'flauz-golden-path-ok'
                                && goldenReceipt.approval.asked && goldenReceipt.approval.granted;
                        recorder.check('delegation.golden-path-completed', goldenOk, goldenOk
                                ? `task T-002 completed the golden path (status done; the event trail ${goldenTrail.join(' | ')}; ${String(goldenRows)} evidence rows: command-output + changeset; the ledger verified through the real seam)`
                                : `the golden path did not complete (status ${String(goldenTask?.status)}, trail ${goldenTrail.join(' | ')}, ledger ok=${String(goldenLedger.ok)} rows=${String(goldenRows)})`);
                        recorder.check('delegation.golden-tool-real', goldenExecution !== undefined && goldenExecution.exitCode === 0 && goldenExecution.stdout.trim() === 'flauz-golden-path-ok' && goldenArtifact.trim() === 'flauz-golden-path-ok', `the golden command really executed in the real /bin/sh terminal (exit ${String(goldenExecution?.exitCode ?? -1)}, stdout "${goldenExecution?.stdout.trim() ?? ''}", ${String(goldenExecution?.durationMs ?? 0)} ms) and its output is the hash-pinned command-output artifact; receipt R-2 records the granted confirmation gate (asked=${String(goldenReceipt.approval.asked)}, granted=${String(goldenReceipt.approval.granted)})`);

                        await harness.friction.friction({
                                phase: 'agent-delegation:golden-plan-approval',
                                kind: 'manual-intervention',
                                detail: 'the human approved the plan of the fresh task T-002 (/approve: awaiting-approval -> execute)',
                                recovery: '',
                        });
                        await harness.friction.friction({
                                phase: 'agent-delegation:golden-tool-confirmation',
                                kind: 'manual-intervention',
                                detail: 'the human GRANTED the flauz_terminal confirmation for the golden command on task T-002 (the tool approval gate): the command really executed in the session terminal and its output was evidenced as the command-output row',
                                recovery: '',
                        });
                        await harness.friction.friction({
                                phase: 'agent-delegation:golden-signoff',
                                kind: 'manual-intervention',
                                detail: 'the human signed off task T-002 (/sign-off: awaiting-signoff -> done) after the ledger verified through the real seam',
                                recovery: '',
                        });

                        // (2) THE DELEGATION EDGE ---------------------------------------------------
                        const delegationStartedAt = Date.now();
                        const busPort = seamBusPort(session.seam);
                        const submitted = await session.store.submitGraph({
                                title: 'dogfood: the delegated implementation-and-test step',
                                steps: [{
                                        stepId: 'S-01',
                                        title: 'implement the delegated scratch module and run its test through the terminal tool',
                                        instruction: 'Create the scratch module scratch/w7-delegated-gcd.mjs and its test scratch/w7-delegated-gcd.test.mjs in the session workspace, then run the test through the flauz_terminal tool and evidence the output.',
                                        tool: 'flauz_terminal',
                                }],
                                actor: 'agent',
                                origin: 'dogfood:A-PROD-003-W7',
                        });
                        const delegationGraphId = submitted.graphId;
                        const delegationTaskId = submitted.taskId ?? '';
                        await session.store.approveGraph({ graphId: delegationGraphId, actor: 'human', origin: 'dogfood:A-PROD-003-W7' });
                        await harness.friction.friction({
                                phase: 'agent-delegation:delegation-graph-approval',
                                kind: 'manual-intervention',
                                detail: `the human approved the delegation graph ${delegationGraphId} (approveGraph actor human) -- the delegated implementation-and-test step S-01 was unlocked for routing`,
                                recovery: '',
                        });
                        // the step-level approval gate (the product's approval-requested/approval-granted transitions)
                        await session.store.approvalRequest({ graphId: delegationGraphId, stepId: 'S-01', reason: 'the delegated implementation-and-test step requires the human approval gate before routing', actor: 'agent', origin: 'dogfood:A-PROD-003-W7' });
                        await session.store.approvalDecide({ graphId: delegationGraphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'dogfood:A-PROD-003-W7', note: 'the human grants the delegated step its approval' });
                        await harness.friction.friction({
                                phase: 'agent-delegation:delegated-step-approval',
                                kind: 'manual-intervention',
                                detail: `the human granted the step approval of S-01 of ${delegationGraphId} (approvalDecide actor human: awaiting-approval -> ready)`,
                                recovery: '',
                        });
                        // the composed delegation ops over the REAL a2a bus owned by the REAL service
                        const delegation = await delegateStep(session.store, busPort, {
                                graphId: delegationGraphId,
                                stepId: 'S-01',
                                targetAgent: WORKER_AGENT,
                                reason: 'capability-match',
                                details: { requiredCapability: 'terminal', matched: [WORKER_AGENT], dogfood: 'A-PROD-003-W7' },
                                fromAgent: PRIMARY_AGENT,
                                actor: 'agent',
                                origin: 'dogfood:A-PROD-003-W7',
                        });
                        // the worker session opens: the mailbox collection (the real seam) + the session-tier memory + the exclusive claim
                        const workerMail = await session.seam.request<{ messages: Array<Record<string, unknown>> }>('flauz.a2a.collect', { agentId: WORKER_AGENT, consume: true });
                        const delegationMessage = workerMail.messages.find(message => message.kind === 'task-delegation');
                        await session.store.acquireClaim({ graphId: delegationGraphId, stepId: 'S-01', holder: WORKER_AGENT, actor: 'agent', origin: 'dogfood:A-PROD-003-W7' });
                        await session.memory.record('session', {
                                kind: 'observation',
                                content: `the worker session opened on ${delegationTaskId} by ${WORKER_AGENT} (the delegated sub-task received through the a2a mailbox: ${String(delegationMessage?.id ?? 'n/a')})`,
                                taskId: delegationTaskId,
                                agentId: WORKER_AGENT,
                                provenance: { actor: 'agent', origin: 'a2a-message', ts: Date.now() },
                        });
                        const decisionRow = session.store.journalRows.find(row => row.type === 'route-decided' && row.stepId === 'S-01');
                        const delegationSentRow = session.store.journalRows.find(row => row.type === 'delegation-sent' && row.stepId === 'S-01');
                        const edgeOk = decisionRow !== undefined
                                && delegationSentRow !== undefined
                                && String((delegationSentRow as { payload?: { decisionRowId?: unknown } }).payload?.decisionRowId) === String(decisionRow?.rowId)
                                && String((delegationSentRow as { payload?: { messageId?: unknown } }).payload?.messageId) === delegation.messageId
                                && delegationMessage !== undefined
                                && String(delegationMessage.from) === PRIMARY_AGENT
                                && String(delegationMessage.to) === WORKER_AGENT
                                && String((delegationMessage as { payload?: { taskId?: unknown } }).payload?.taskId) === delegationTaskId;
                        recorder.check('delegation.edge-routed', edgeOk, edgeOk
                                ? `the delegation edge landed: route-decided (${String(decisionRow?.rowId)}: WHY ${WORKER_AGENT}, reason capability-match) + startStep (runner ${WORKER_AGENT}) + the a2a task-delegation message ${delegation.messageId} posted through the REAL service bus + the delegation-sent receipt linking them; the worker's mailbox delivered it (${String(workerMail.messages.length)} message(s))`
                                : 'the delegation edge did not land coherently (decision row / receipt linkage / mailbox)');

                        // (3) THE DELEGATED WORK: a real implementation-and-test act -----------------
                        const scratchDir = nodePath.join(sessionRoot, 'scratch');
                        await nodeFs.mkdir(scratchDir, { recursive: true });
                        await nodeFs.writeFile(nodePath.join(sessionRoot, DELEGATED_MODULE_REL), DELEGATED_MODULE_SOURCE, { encoding: 'utf-8' });
                        await nodeFs.writeFile(nodePath.join(sessionRoot, DELEGATED_TEST_REL), DELEGATED_TEST_SOURCE, { encoding: 'utf-8' });
                        const workerRunStartedAt = Date.now();
                        const workerOutcome = await session.surface.invokeTerminal(DELEGATED_TEST_COMMAND);
                        await harness.friction.timing({ phase: 'agent-delegation:worker-tool-run', durationMs: Date.now() - workerRunStartedAt });
                        const workerArtifact = await writeCommandOutput(sessionRoot, delegationTaskId, 1, workerOutcome.output);
                        const workerEvidence = await session.seam.appendEvidence(delegationTaskId, {
                                kind: 'command-output',
                                uri: workerArtifact.uri,
                                sha256: workerArtifact.sha256,
                                note: DELEGATED_TEST_COMMAND,
                        });
                        const workerReceipt = mintToolReceipt({
                                receiptId: 'R-3',
                                command: DELEGATED_TEST_COMMAND,
                                decision: workerOutcome.decision,
                                execution: workerOutcome.execution,
                                evidence: { evidenceId: paddedEvidenceId(workerEvidence.seq), uri: workerArtifact.uri, sha256: workerArtifact.sha256 },
                                ts: Date.now(),
                        });
                        receipts.push(workerReceipt);
                        await harness.friction.friction({
                                phase: 'agent-delegation:worker-tool-confirmation',
                                kind: 'manual-intervention',
                                detail: `the human GRANTED the flauz_terminal confirmation for the delegated test run '${DELEGATED_TEST_COMMAND}' (the worker session's tool approval gate): node really executed the worker's test in the session terminal`,
                                recovery: '',
                        });
                        const moduleOnDisk = await nodeFs.readFile(nodePath.join(sessionRoot, DELEGATED_MODULE_REL), { encoding: 'utf-8' }).catch(() => '');
                        const testOnDisk = await nodeFs.readFile(nodePath.join(sessionRoot, DELEGATED_TEST_REL), { encoding: 'utf-8' }).catch(() => '');
                        const workerOk = workerOutcome.ok
                                && workerOutcome.execution !== undefined && workerOutcome.execution.exitCode === 0
                                && /w7 delegated module test: PASS/.test(workerOutcome.output)
                                && moduleOnDisk === DELEGATED_MODULE_SOURCE
                                && testOnDisk === DELEGATED_TEST_SOURCE
                                && workerReceipt.approval.asked && workerReceipt.approval.granted
                                && workerEvidence.evidenceId.length > 0;
                        recorder.check('delegation.delegated-work-real', workerOk, workerOk
                                ? `the delegated sub-task performed a REAL implementation-and-test act: the module ${DELEGATED_MODULE_REL} + its test were authored in the session workspace, the test ran through the approved flauz_terminal invocation (exit ${String(workerOutcome.execution?.exitCode ?? -1)}, ${String(workerOutcome.execution?.durationMs ?? 0)} ms) and its output was evidenced as the command-output row ${workerEvidence.evidenceId} (receipt R-3)`
                                : `the delegated work did not complete for real (invoked=${String(workerOutcome.ok)}, exit=${String(workerOutcome.execution?.exitCode ?? -1)}, output="${workerOutcome.output.slice(0, 120)}")`);

                        // (4) THE RESULT REPORT + THE INGESTION -------------------------------------
                        await session.store.releaseClaim({ graphId: delegationGraphId, stepId: 'S-01', actor: 'agent', origin: 'dogfood:A-PROD-003-W7' });
                        const reportPosted = await busPort.post({
                                message: {
                                        kind: 'result-report',
                                        from: WORKER_AGENT,
                                        to: PRIMARY_AGENT,
                                        payload: {
                                                taskId: delegationTaskId,
                                                outcome: 'ok',
                                                evidenceIds: [paddedEvidenceId(workerEvidence.seq)],
                                                summary: `the delegated implementation-and-test act completed: ${DELEGATED_TEST_COMMAND} passed (exit 0) and its output is evidenced as ${workerArtifact.uri}`,
                                        },
                                },
                        });
                        const parentMail = await session.seam.request<{ messages: Array<Record<string, unknown>> }>('flauz.a2a.collect', { agentId: PRIMARY_AGENT, consume: true });
                        const resultMessage = parentMail.messages.find(message => message.kind === 'result-report');
                        const ingestion = await ingestResultReport(session.store, {
                                graphId: delegationGraphId,
                                stepId: 'S-01',
                                messageId: reportPosted.id,
                                outcome: 'ok',
                                summary: `the delegated implementation-and-test act completed: ${DELEGATED_TEST_COMMAND} passed (exit 0)`,
                                evidenceIds: [paddedEvidenceId(workerEvidence.seq)],
                                fromAgent: WORKER_AGENT,
                        });
                        await session.store.completeGraph({ graphId: delegationGraphId, actor: 'agent', origin: 'dogfood:A-PROD-003-W7' });
                        await harness.friction.timing({ phase: 'agent-delegation:delegation-ingest', durationMs: Date.now() - delegationStartedAt });
                        const delegationState = session.store.getGraphState(delegationGraphId) as { graphStatus: string; steps: Record<string, { status: string; runnerId: string | null }> };
                        const resultReceivedRow = session.store.journalRows.find(row => row.type === 'result-received' && row.stepId === 'S-01');
                        const claimRows = session.store.journalRows.filter(row => row.type === 'claim-acquired' || row.type === 'claim-released');
                        const ingestedOk = resultMessage !== undefined
                                && String((resultMessage as { payload?: { evidenceIds?: unknown[] } }).payload?.evidenceIds?.[0]) === paddedEvidenceId(workerEvidence.seq)
                                && resultReceivedRow !== undefined
                                && String((resultReceivedRow as { payload?: { evidenceIds?: unknown[] } }).payload?.evidenceIds?.[0]) === paddedEvidenceId(workerEvidence.seq)
                                && ingestion.receiptRowId.length > 0
                                && delegationState.graphStatus === 'completed'
                                && delegationState.steps['S-01']?.status === 'succeeded'
                                && delegationState.steps['S-01']?.runnerId === WORKER_AGENT
                                && claimRows.length === 2;
                        recorder.check('delegation.result-ingested', ingestedOk, ingestedOk
                                ? `the worker's a2a result-report ${reportPosted.id} was collected by the parent and ingested (result-received row ${String(resultReceivedRow?.rowId)} carrying the evidence id ${paddedEvidenceId(workerEvidence.seq)}; step S-01 succeeded with runner ${WORKER_AGENT}; the graph completed; the worker's claim was acquired + released)`
                                : 'the result ingestion did not land coherently (message / receipt row / step transition / graph completion)');

                        // (5) THE TAKEOVER TRANSITION ------------------------------------------------
                        const takeoverStartedAt = Date.now();
                        const takeoverSubmitted = await session.store.submitGraph({
                                title: 'dogfood: the gated release decision the human takes over',
                                steps: [{
                                        stepId: 'S-02',
                                        title: 'the final release decision',
                                        instruction: 'The gated decision the human will take over by hand.',
                                        gate: 'human-approval',
                                }],
                                actor: 'agent',
                                origin: 'dogfood:A-PROD-003-W7',
                        });
                        const takeoverGraphId = takeoverSubmitted.graphId;
                        const takeoverTaskId = takeoverSubmitted.taskId ?? '';
                        await session.store.approveGraph({ graphId: takeoverGraphId, actor: 'human', origin: 'dogfood:A-PROD-003-W7' });
                        await harness.friction.friction({
                                phase: 'agent-delegation:takeover-graph-approval',
                                kind: 'manual-intervention',
                                detail: `the human approved the takeover graph ${takeoverGraphId} (approveGraph actor human) -- its gated step S-02 then armed its approval request`,
                                recovery: '',
                        });
                        await session.store.approvalRequest({ graphId: takeoverGraphId, stepId: 'S-02', reason: 'the gated release decision waits for the human', actor: 'agent', origin: 'dogfood:A-PROD-003-W7' });
                        const stuckBefore = await session.takeoverPort.stuckStepOf(takeoverTaskId);
                        const completionNote = 'the human completed the gated release decision personally (the A-PROD-003-W7 takeover leg)';
                        const takeoverTurn = await session.handler({ command: 'takeover', prompt: completionNote });
                        await harness.friction.timing({ phase: 'agent-delegation:takeover-turn', durationMs: Date.now() - takeoverStartedAt });
                        // the durable facts: a FRESH store reads the journal back strictly (the no-staleness posture)
                        const freshStore = new OrchestrationStore(sessionRoot);
                        const journalVerdict = freshStore.verifyJournal();
                        const takeoverRows = freshStore.journalRows.filter(row => row.type.startsWith('takeover-'));
                        const decideStarted = freshStore.journalRows.some(row => row.type === 'step-started' && row.graphId === takeoverGraphId);
                        const takeoverState = freshStore.stateOf(takeoverGraphId) as unknown as { steps: Record<string, { status: string; takeover?: { state: string } }>; graphStatus: string };
                        const stuckAfter = await session.takeoverPort.stuckStepOf(takeoverTaskId);
                        const takeoverEvidenceLine = (await nodeFs.readFile(nodePath.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' }))
                                .split('\n').filter(line => line.length > 0)
                                .map(line => JSON.parse(line) as { uri?: string; taskId?: string })
                                .find(row => row.uri === `flauz-orch-takeover://${takeoverGraphId}/S-02`);
                        const takeoverOk = stuckBefore !== undefined && stuckBefore.state === 'stuck' && stuckBefore.stepId === 'S-02'
                                && takeoverRows.map(row => row.type).join(',') === 'takeover-requested,takeover-accepted,takeover-completed'
                                && takeoverRows.every(row => row.actor === 'human')
                                && !decideStarted
                                && takeoverState.steps['S-02']?.status === 'succeeded'
                                && takeoverState.steps['S-02']?.takeover?.state === 'completed'
                                && stuckAfter === undefined
                                && journalVerdict.ok
                                && takeoverEvidenceLine !== undefined && takeoverEvidenceLine.taskId === takeoverTaskId
                                && /taken over by you/i.test(takeoverTurn.markdown.join('\n'));
                        recorder.check('delegation.takeover-transition', takeoverOk, takeoverOk
                                ? `the stuck gated step S-02 of ${takeoverGraphId} was taken over through the participant /takeover human gate (request -> accept -> complete, every journal row actor human, the step NEVER started by an agent, the takeover evidence row flauz-orch-takeover://${takeoverGraphId}/S-02 minted into the shared ledger, the journal chain verifies, the probe reports nothing stuck afterwards)`
                                : `the takeover transition did not land (stuckBefore=${String(stuckBefore?.state ?? 'n/a')}, rows=${takeoverRows.map(row => row.type).join(',')}, stepStatus=${String(takeoverState.steps['S-02']?.status)}, started=${String(decideStarted)}, journalOk=${String(journalVerdict.ok)})`);
                        await harness.friction.friction({
                                phase: 'agent-delegation:takeover',
                                kind: 'manual-intervention',
                                detail: `the human took the stuck step S-02 of ${takeoverGraphId} over by hand (/takeover: takeover-requested -> takeover-accepted -> takeover-completed, every journal row actor human) -- the step completed with takeover evidence and NO agent execution`,
                                recovery: 'the stuck approval gate was resolved by the human completing the step personally; the graph reached completion with the takeover-completed evidence minted into the shared ledger (the LEG 9 discipline)',
                        });

                        // (6) THE FINAL LEDGER + A2A FACTS -------------------------------------------
                        const finalLedger = await session.seam.verifyLedger();
                        const a2aMessages = await readSessionA2aMessages(sessionRoot);
                        const ledgerOk = finalLedger.ok
                                && a2aMessages.map(message => String(message.kind)).join(',') === 'task-delegation,result-report';
                        recorder.check('delegation.shared-state-consistent', ledgerOk, ledgerOk
                                ? `the session's shared surfaces stayed consistent: the evidence ledger verified through the real seam (${String(finalLedger.rows)} rows) and the a2a journal carries exactly the typed task-delegation + result-report pair (${a2aMessages.map(message => String(message.id)).join(', ')})`
                                : `the shared state drifted (ledger ok=${String(finalLedger.ok)}, a2a kinds=${a2aMessages.map(message => String(message.kind)).join(',')})`);

                        // (7) THE REPORT + THE DRIVER-LEVEL EVIDENCE ---------------------------------
                        const report = {
                                schema: DELEGATION_REPORT_SCHEMA,
                                exerciseId: 'agent-delegation',
                                mode: harness.mode,
                                sessionRoot,
                                golden: {
                                        refusal: {
                                                taskId: 'T-001',
                                                status: refusalTask?.status ?? 'n/a',
                                                failEventError: String((refusalFailEvent as { payload?: { error?: unknown } } | undefined)?.payload?.error ?? ''),
                                                ledgerRowsAfter: rowsAfterRefusal,
                                                receipt: refusalReceipt,
                                        },
                                        path: {
                                                taskId: 'T-002',
                                                status: goldenTask?.status ?? 'n/a',
                                                eventTrail: goldenTrail,
                                                ledgerOk: goldenLedger.ok,
                                                ledgerRows: goldenRows,
                                                command: GOLDEN_COMMAND,
                                                execution: goldenExecution,
                                                receipt: goldenReceipt,
                                        },
                                },
                                delegation: {
                                        graphId: delegationGraphId,
                                        taskId: delegationTaskId,
                                        decisionRowId: String(decisionRow?.rowId ?? ''),
                                        delegationSentRowId: String(delegationSentRow?.rowId ?? ''),
                                        messageId: delegation.messageId,
                                        attempt: delegation.attempt,
                                        workerMailboxMessages: workerMail.messages.map(message => String(message.id)),
                                        parentMailboxMessages: parentMail.messages.map(message => String(message.id)),
                                        resultReportMessageId: reportPosted.id,
                                        resultReceivedRowId: ingestion.receiptRowId,
                                        graphStatus: delegationState.graphStatus,
                                        stepStatus: delegationState.steps['S-01']?.status ?? 'n/a',
                                        evidenceIds: [paddedEvidenceId(workerEvidence.seq)],
                                },
                                delegatedWork: {
                                        module: DELEGATED_MODULE_REL,
                                        test: DELEGATED_TEST_REL,
                                        command: DELEGATED_TEST_COMMAND,
                                        output: workerOutcome.output,
                                        exitCode: workerOutcome.execution?.exitCode ?? -1,
                                        evidenceId: workerEvidence.evidenceId,
                                        artifactUri: workerArtifact.uri,
                                        receipt: workerReceipt,
                                },
                                takeover: {
                                        graphId: takeoverGraphId,
                                        taskId: takeoverTaskId,
                                        stuckBefore,
                                        stuckAfter,
                                        rows: takeoverRows.map(row => ({ type: row.type, rowId: row.rowId, actor: row.actor })),
                                        stepStatus: takeoverState.steps['S-02']?.status ?? 'n/a',
                                        journalOk: journalVerdict.ok,
                                        note: completionNote,
                                        markdown: takeoverTurn.markdown,
                                },
                                shared: {
                                        ledgerRows: finalLedger.rows,
                                        ledgerOk: finalLedger.ok,
                                        a2aMessages,
                                },
                                toolReceipts: receipts,
                                evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture (the golden-path orchestrator\'s deterministic plan over the mock model selection -- the product\'s documented v0 simplification; never wording-promoted)' },
                        };
                        const reportUri = `.flauz/artifacts/${harness.taskId}/agent-delegation-report.json`;
                        const reportArtifact = await mintArtifact(harness, reportUri, `${JSON.stringify(report, null, '\t')}\n`, 'the agent-delegation exercise report (the golden path with its approval gates + the delegated worker session + the takeover transition)');
                        evidenceItems.push(reportArtifact.item);
                        evidenceIds.push(reportArtifact.evidenceId);
                        // the session's durable surfaces banked verbatim (the journal + the a2a journal + the ledger): the reviewer can re-check every row by hand
                        const sessionJournal = { schema: 'flauz.dogfood-delegation-session-state/v1', journalRows: freshStore.journalRows, a2aMessages, ledgerLines: (await nodeFs.readFile(nodePath.join(sessionRoot, '.flauz', 'evidence', 'ledger.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0).map(line => JSON.parse(line)) };
                        const sessionStateUri = `.flauz/artifacts/${harness.taskId}/agent-delegation-session-state.json`;
                        const sessionStateArtifact = await mintArtifact(harness, sessionStateUri, `${JSON.stringify(sessionJournal, null, '\t')}\n`, 'the agent-delegation session\'s durable surfaces verbatim (orchestration journal + a2a journal + evidence ledger)');
                        evidenceItems.push(sessionStateArtifact.item);
                        evidenceIds.push(sessionStateArtifact.evidenceId);
                        await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                        await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'agent-delegation.report.json'), `${JSON.stringify(report, null, '\t')}\n`, { encoding: 'utf-8' });
                        recorder.check('delegation.evidence-minted', evidenceItems.length === 2 && evidenceIds.length === 2, `the exercise report + the session-state bundle are hash-pinned into the driver-level evidence ledger (${evidenceIds.join(', ')}); the three tool receipts (R-1 denied gate, R-2 golden run, R-3 delegated test run) are embedded in the report`);

                        // the human-gates check: every intervention logged
                        const frictionRows = await harness.friction.readAll();
                        const interventionRows = frictionRows.filter((row): row is typeof row & { kind: string; recovery: string } => row.type === 'friction');
                        const interventionsOk = interventionRows.length === 10
                                && interventionRows.every(row => row.kind === 'manual-intervention')
                                && interventionRows.filter(row => row.recovery.length > 0).length === 2;
                        recorder.check('delegation.human-gates-logged', interventionsOk, interventionsOk
                                ? `every human intervention is a first-class friction row: ${String(interventionRows.length)} manual-intervention rows (the T-001 plan approval, the DENIED tool confirmation, the T-002 plan approval, the GRANTED tool confirmation, the sign-off, the delegation-graph approval, the delegated-step approval grant, the worker's tool confirmation, the takeover-graph approval, the takeover itself) with the 2 recovery accounts (the denial's re-run, the takeover's completion)`
                                : `the friction log does not capture the human gates exactly (${String(interventionRows.length)} friction rows, kinds ${interventionRows.map(row => row.kind).join(',')}, recoveries ${String(interventionRows.filter(row => row.recovery.length > 0).length)})`);

                        notes.push('the seams are the product\'s own golden-path machinery: the REAL core-service child process over stdio, the REAL orchestrator/participant/terminal-tool wiring, the REAL a2a bus owned by the service, the REAL orchestration store/mediator/takeover port -- all local-real');
                        notes.push('model intelligence: fixture (the golden-path orchestrator\'s deterministic plan over the mock model selection -- the product\'s documented v0 simplification); no live model is claimed by this exercise');
                        notes.push('every human intervention is logged as a manual-intervention friction row: each plan approval, each tool confirmation (granted AND denied), the sign-off, each graph/step approval, and the takeover');
                        notes.push('the delegated sub-task performed real work: the module + test authored in the session workspace, the test run through the approved flauz_terminal invocation in a real /bin/sh child, the output evidenced as a command-output ledger row through the real service');
                } finally {
                        await session.dispose();
                }

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRowsFinal = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'agent-delegation',
                        title: 'agent delegation: golden path + approvals/takeover + a delegated implementation-and-test session',
                        dimensions: ['multi-agent delegation', 'approvals/takeover', 'implementation/tests as dogfooded work', 'artifacts/evidence', 'slow-path timing'],
                        verdict: failCount === 0 ? 'PASS' : 'FAIL',
                        checks: recorder.checks,
                        evidenceIds,
                        evidenceItems,
                        frictionLogPath: harness.friction.path,
                        frictionRows: {
                                friction: frictionRowsFinal.filter(row => row.type === 'friction').length,
                                timing: frictionRowsFinal.filter(row => row.type === 'timing').length,
                                recovery: frictionRowsFinal.filter(row => row.type === 'friction' && typeof row.recovery === 'string' && row.recovery.length > 0).length,
                        },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes,
                };
        },
};
