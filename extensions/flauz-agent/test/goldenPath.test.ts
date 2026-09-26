/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The golden-path vertical slice: participant + orchestrator + terminal
 * tool + REAL core service (child process) + fake workspace, driven
 * end-to-end through the fidelity vscode mock.
 *
 * Golden path: request -> createTask -> submit-plan -> approve -> terminal
 * tool (mocked exec) -> evidence rows -> checkpoint -> report -> verify-pass
 * (actor: tool) -> sign-off -> done.
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockVscode } from './harness/vscode-mock.ts';
import { createFakeWorkspace, startRealSeam, wireBridge, drive } from './harness/fakeWorkspace.ts';
import { GOLDEN_COMMAND, extractTextResult } from '../src/orchestrator.ts';
import { rowHash } from '../core/contracts.mjs';

async function setup(options?: { confirmationPolicy?: (name: string, confirmation: { title: string; message: string }) => boolean; models?: Array<{ vendor: string; id: string; family: string; version: string; name: string }> }) {
        const workspace = createFakeWorkspace();
        const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-golden-storage-'));
        mkdirSync(globalStorage, { recursive: true });
        const { vscode: api, state } = createMockVscode({
                models: options?.models ?? [{ vendor: 'flauz-mock', id: 'echo-1', family: 'flauz-echo', version: '1', name: 'Flauz Mock Echo' }],
                confirmationPolicy: options?.confirmationPolicy ?? (() => true),
        });
        const seam = await startRealSeam(workspace, globalStorage);
        const bridge = await wireBridge(api, state, seam, workspace.root);
        return { workspace, globalStorage, api, state, seam, bridge };
}

test('golden path: plan -> approve -> tool -> evidence -> verify-pass -> sign-off -> done', async () => {
        const { workspace, state, seam, bridge } = await setup();
        try {
                // 1. Free prompt -> task + plan + awaiting-approval.
                const planned = await drive(bridge.handler, { prompt: 'prove the golden path end to end' });
                const planText = planned.markdown.join('\n');
                match(planText, /Flauz plan — T-001/);
                match(planText, /\/approve/);
                match(planText, /Model in scope: flauz-mock\/flauz-echo \(echo-1\)/);
                strictEqual(workspace.readTasks().tasks[0].status, 'awaiting-approval');

                // 2. Human approval -> tool invocation with confirmation + evidence.
                const approved = await drive(bridge.handler, { command: 'approve', prompt: '' });
                strictEqual(workspace.readTasks().tasks[0].status, 'awaiting-signoff');
                strictEqual(state.invocations.length, 1, 'one tool invocation');
                strictEqual(state.invocations[0].name, 'flauz_terminal');
                ok(state.invocations[0].confirmationAsked, 'HumanApproval confirmation was requested');
                strictEqual(state.invocations[0].input.command, GOLDEN_COMMAND);
                strictEqual(state.terminals[0].commands[0], GOLDEN_COMMAND);
                match(approved.markdown.join('\n'), /verified/);

                // 3. Evidence rows on disk: command-output + changeset, hash-chained.
                const lines = workspace.readLedgerLines();
                strictEqual(lines.length, 2, 'command-output + changeset');
                const row1 = JSON.parse(lines[0]);
                const row2 = JSON.parse(lines[1]);
                strictEqual(row1.kind, 'command-output');
                strictEqual(row1.taskId, 'T-001');
                strictEqual(row1.prev, null);
                strictEqual(row2.kind, 'changeset');
                strictEqual(row2.prev, rowHash(row1), 'row 2 chains to row 1');
                strictEqual(row1.sha256, createHash('sha256').update('flauz-golden-path-ok', 'utf-8').digest('hex'), 'artifact hash matches the tool output');
                strictEqual(workspace.readArtifact(row1.uri), 'flauz-golden-path-ok', 'artifact written under .flauz/artifacts/');

                // 4. Event trail with the documented actors.
                const task = workspace.readTasks().tasks[0];
                deepEqualTrail(task.events.map((event) => `${event.actor}/${event.type}`), [
                        'agent/created',
                        'agent/submit-plan',
                        'human/approve',
                        'agent/report',
                        'tool/verify-pass',
                ]);
                ok(task.changes.length >= 1);
                match(String(task.changes[0].checkpointRef), /^flauz-ckpt-[0-9a-f]{12}$/);

                // 5. Ledger verifies through the seam.
                const verdict = await seam.verifyLedger();
                ok(verdict.ok);
                strictEqual(verdict.rows, 2);

                // 6. Human sign-off -> done.
                const signed = await drive(bridge.handler, { command: 'sign-off', prompt: '' });
                strictEqual(workspace.readTasks().tasks[0].status, 'done');
                match(signed.markdown.join('\n'), /done/);
                strictEqual(workspace.readTasks().tasks[0].events.length, 6, 'created, submit-plan, approve, report, verify-pass, sign-off');
        } finally {
                await seam.dispose();
        }
});

test('verify-pass is recorded with actor tool (not agent)', async () => {
        const { workspace, seam, bridge } = await setup();
        try {
                await drive(bridge.handler, { prompt: 'actor check' });
                await drive(bridge.handler, { command: 'approve', prompt: '' });
                const verifyPass = workspace.readTasks().tasks[0].events.find((event) => event.type === 'verify-pass');
                ok(verifyPass, 'verify-pass event exists');
                strictEqual(verifyPass.actor, 'tool');
        } finally {
                await seam.dispose();
        }
});

test('request-changes sends the task back to plan and a new plan can be submitted', async () => {
        const { workspace, seam, bridge } = await setup();
        try {
                await drive(bridge.handler, { prompt: 'needs refinement' });
                await drive(bridge.handler, { command: 'request-changes', prompt: 'make it stricter' });
                strictEqual(workspace.readTasks().tasks[0].status, 'plan');
                const replanned = await drive(bridge.handler, { prompt: 'revised plan with stricter verification' });
                strictEqual(workspace.readTasks().tasks[0].status, 'awaiting-approval');
                match(replanned.markdown.join('\n'), /Flauz plan — T-001/);
                const statuses = workspace.readTasks().tasks[0].events.map((event) => event.type);
                ok(statuses.includes('request-changes') && statuses.filter((type) => type === 'submit-plan').length === 2, 'two submit-plans around a request-changes');
                // Same task, not a new one.
                strictEqual(workspace.readTasks().tasks.length, 1);
        } finally {
                await seam.dispose();
        }
});

test('cancel ends the active task; a new prompt starts a fresh task', async () => {
        const { workspace, seam, bridge } = await setup();
        try {
                await drive(bridge.handler, { prompt: 'to be cancelled' });
                await drive(bridge.handler, { command: 'cancel', prompt: '' });
                strictEqual(workspace.readTasks().tasks[0].status, 'cancelled');
                await drive(bridge.handler, { prompt: 'a second task' });
                const tasks = workspace.readTasks().tasks;
                strictEqual(tasks.length, 2);
                strictEqual(tasks[1].id, 'T-002');
                strictEqual(tasks[1].status, 'awaiting-approval');
        } finally {
                await seam.dispose();
        }
});

test('denied confirmation fails the task (execute -> failed) and streams the error', async () => {
        const { workspace, state, seam, bridge } = await setup({ confirmationPolicy: () => false });
        try {
                await drive(bridge.handler, { prompt: 'will be denied' });
                const failed = await drive(bridge.handler, { command: 'approve', prompt: '' });
                strictEqual(workspace.readTasks().tasks[0].status, 'failed');
                const failEvent = workspace.readTasks().tasks[0].events.find((event) => event.type === 'fail');
                ok(failEvent, 'fail event recorded');
                strictEqual(failEvent.actor, 'agent');
                match(failEvent.payload.error as string, /rejected by user/);
                match(failed.markdown.join('\n'), /failed/);
                ok(state.invocations[0].confirmationAsked, 'confirmation was asked before rejection');
                // No evidence rows for the failed run.
                strictEqual(workspace.readLedgerLines().length, 0);
                // extractTextResult sanity (ToolResultPart content extraction).
                strictEqual(extractTextResult({ content: [{ value: 'a' }, { value: 'b' }, {}] }), 'ab');
        } finally {
                await seam.dispose();
        }
});

function deepEqualTrail(actual: string[], expected: string[]): void {
        strictEqual(actual.join(' | '), expected.join(' | '));
}
