/**
 * Tests for the flauz.agent participant registration and turn routing.
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
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

test('participant registers as flauz.agent with followups for the four human gates', () => {
        const seam = recordingSeam();
        const { state } = buildParticipant(seam);
        strictEqual(state.participants.length, 1);
        strictEqual(state.participants[0].id, 'flauz.agent');
        const followups = state.participants[0].followupProvider?.provideFollowups({} as never, {} as never, undefined as never) as vscode.ChatFollowup[];
        ok(Array.isArray(followups));
        strictEqual(followups.map((followup) => followup.command).join(','), 'approve,request-changes,sign-off,cancel');
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
