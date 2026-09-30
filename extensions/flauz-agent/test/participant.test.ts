/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for the flauz.agent participant registration and turn routing.
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Orchestrator, GOLDEN_COMMAND, type ChatStreamLike, type ToolResultLike } from '../src/orchestrator.ts';
import { registerParticipant, PARTICIPANT_ID } from '../src/participant.ts';
import { createMockVscode } from './harness/vscode-mock.ts';
import { drive } from './harness/fakeWorkspace.ts';
import type { SeamLike } from '../src/types.ts';
import type * as vscode from 'vscode';

/** In-memory seam double that records calls (no child process). */
function recordingSeam(): SeamLike & { calls: Array<{ cmd: string; args: unknown }> } {
        const calls: Array<{ cmd: string; args: unknown }> = [];
        const seam: SeamLike = {
                async createTask(title) {
                        calls.push({ cmd: 'createTask', args: title });
                        return { taskId: 'T-001' };
                },
                async appendEvent(taskId, event) {
                        calls.push({ cmd: 'appendEvent', args: { taskId, event } });
                        return { task: { id: taskId, title: 't', status: 'plan', events: [], timing: { created: 0, updatedAt: 0 }, changes: [] } };
                },
                async listTasks() {
                        return { tasks: [] };
                },
                async getTask(taskId) {
                        return { task: { id: taskId, title: 't', status: 'plan', events: [], timing: { created: 0, updatedAt: 0 }, changes: [] } };
                },
                async appendEvidence(taskId, row) {
                        calls.push({ cmd: 'appendEvidence', args: { taskId, row } });
                        return { evidenceId: 'E-1', seq: 1 };
                },
                async createCheckpoint(taskId, requestId) {
                        calls.push({ cmd: 'createCheckpoint', args: { taskId, requestId } });
                        return { checkpointRef: 'flauz-ckpt-abc123' };
                },
                async verifyLedger() {
                        return { ok: true, rows: 1 };
                },
        };
        return Object.assign(seam, { calls });
}

function buildParticipant(seam: SeamLike) {
        const { vscode: api, state } = createMockVscode();
        const orchestrator = new Orchestrator({
                seam,
                workspaceRoot: '/tmp/flauz-participant-test',
                getModelSelection: () => ({ models: [], status: 'no-models' }),
                invokeTool: async () => ({ content: [{ value: 'ok' }] }) as ToolResultLike,
        });
        registerParticipant((id, handler) => api.chat.createChatParticipant(id, handler), {
                orchestrator,
                getModelSelection: () => ({ models: [], status: 'no-models' }),
        });
        const entry = state.participants.find((candidate) => candidate.id === PARTICIPANT_ID);
        ok(entry, 'participant registered');
        return { handler: entry.handler as vscode.ChatRequestHandler, state };
}

test('participant registers as flauz.agent with followups for the five human gates', () => {
        const seam = recordingSeam();
        const { state } = buildParticipant(seam);
        strictEqual(state.participants.length, 1);
        strictEqual(state.participants[0].id, 'flauz.agent');
        const followups = state.participants[0].followupProvider?.provideFollowups({} as never, {} as never, undefined as never) as vscode.ChatFollowup[];
        ok(Array.isArray(followups));
        // P2-FIX-204: the takeover escape hatch is the fifth followup (mirrors the
        // package.json participant command — the fifth human gate).
        // P2-FIX-203: the delegation ask rides a prompt-only followup (no command) —
        // filter it out of the command-gate assertion.
        const commandFollowups = followups.filter((followup) => followup.command !== undefined);
        strictEqual(commandFollowups.map((followup) => followup.command).join(','), 'approve,request-changes,sign-off,cancel,takeover');
        const delegateFollowup = followups.find((followup) => (followup.prompt || '').includes('delegate'));
        ok(delegateFollowup !== undefined && delegateFollowup.command === undefined, 'P2-FIX-203: the delegation followup is prompt-only');
});

test('free prompts route to handlePrompt; commands route to handleCommand', async () => {
        const seam = recordingSeam();
        const { handler } = buildParticipant(seam);

        const planned = await drive(handler, { prompt: 'verify the participant wiring' });
        ok(planned.markdown.length > 0);
        match(planned.markdown.join('\n'), /Flauz plan — T-001/);
        match(planned.markdown.join('\n'), new RegExp(GOLDEN_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        ok(seam.calls.some((call) => call.cmd === 'createTask'), 'prompt created a task');
        ok(seam.calls.some((call) => call.cmd === 'appendEvent' && String((call.args as { event: { type: string } }).event.type) === 'submit-plan'), 'prompt submitted the plan');

        const cancelled = await drive(handler, { command: 'cancel', prompt: '' });
        match(cancelled.markdown.join('\n'), /cancelled/);
        ok(seam.calls.some((call) => call.cmd === 'appendEvent' && String((call.args as { event: { type: string } }).event.type) === 'cancel'), 'command routed to the seam');

        const unknown = await drive(handler, { command: 'bogus', prompt: '' });
        match(unknown.markdown.join('\n'), /Unknown command/);
});

test('P2-FIX-203: the participant description names worker-agent delegation (the DA11 surface)', () => {
        const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
                contributes: { chatParticipants: Array<{ id: string; description: string }> };
        };
        const participant = manifest.contributes.chatParticipants.find((entry) => entry.id === 'flauz.agent');
        ok(participant !== undefined, 'flauz.agent is contributed');
        match(participant.description, /delegate steps to worker agents/, 'the description names the delegation capability (the DA11 corpus word)');
        match(participant.description, /approval gates/, 'DA07 regression: the approval gates stay named');
        match(participant.description, /evidence ledger/, 'DA07 regression: the evidence ledger stays named');
});

test('P2-FIX-203: followups offer delegating a step of a multi-step plan to a worker agent', () => {
        const seam = recordingSeam();
        const { state } = buildParticipant(seam);
        const followups = state.participants[0].followupProvider?.provideFollowups({} as never, {} as never, undefined as never) as vscode.ChatFollowup[];
        ok(Array.isArray(followups));
        const delegation = followups.find((followup) => followup.command === undefined);
        ok(delegation !== undefined, 'the prompt-only delegation followup is contributed');
        strictEqual(delegation.prompt, 'delegate a step of this plan to a worker agent');
        strictEqual(delegation.label, 'Delegate a step to a worker agent');
});
