/**
 * The Flauz golden-path orchestrator (F side).
 *
 * Drives one task through the seam's legal transitions, calling the
 * `flauz.workspace.*` commands at each milestone and appending evidence
 * rows for tool outputs (command-output) and checkpoints (changeset):
 *
 *   request -> createTask -> submit-plan(agent)
 *           -> approve(human, via /approve chat turn)
 *           -> terminal tool invocation (HumanApproval confirmation gate)
 *           -> appendEvidence(command-output) -> createCheckpoint
 *           -> appendEvidence(changeset) -> report(agent)
 *           -> verify-pass(tool, ledger hash-chain check)
 *           -> sign-off(human, via /sign-off chat turn) -> done
 *
 * v0 simplifications (documented in REPORT §CONTRACT-DEVIATIONS /
 * §GAPS-AND-SKIPS): one active task per orchestrator instance (no chat
 * history persistence), plan text is deterministic (model attribution only,
 * no sendRequest), and the plan/refinement turn model is minimal.
 */

import type * as vscode from 'vscode';
import type { SeamLike, Task } from './types.ts';
import { writeCommandOutput, sha256Of } from './artifacts.ts';
import { modelAttribution, type ModelSelection } from './models.ts';
import { TERMINAL_TOOL_ID } from './tools/terminalTool.ts';

/** The command the golden path runs (echo -> deterministic output). */
export const GOLDEN_COMMAND = 'echo flauz-golden-path-ok';

/** Structural slice of vscode.ChatResponseStream the orchestrator uses. */
export interface ChatStreamLike {
        markdown(value: string): void;
        progress(value: string): void;
}

export interface ToolResultLike {
        content?: Array<{ value?: unknown }>;
}

export type InvokeToolFn = (name: string, options: { toolInvocationToken: unknown; input: Record<string, unknown> }) => Promise<ToolResultLike>;

export interface OrchestratorDeps {
        seam: SeamLike;
        invokeTool: InvokeToolFn;
        workspaceRoot: string;
        /** Current model selection (the participant refreshes it per turn). */
        getModelSelection: () => ModelSelection;
        logger?: (message: string) => void;
}

export function extractTextResult(result: ToolResultLike): string {
        return (result.content ?? [])
                .filter((part) => part !== null && typeof part === 'object' && typeof part.value === 'string')
                .map((part) => String(part.value))
                .join('');
}

export class Orchestrator {
        private readonly deps: OrchestratorDeps;
        private lastTaskId: string | undefined;

        constructor(deps: OrchestratorDeps) {
                this.deps = deps;
        }

        private async activeTask(): Promise<Task | undefined> {
                if (this.lastTaskId) {
                        const { task } = await this.deps.seam.getTask(this.lastTaskId);
                        if (!['done', 'failed', 'cancelled'].includes(task.status)) {
                                return task;
                        }
                }
                const { tasks } = await this.deps.seam.listTasks();
                const active = tasks.filter((task) => !['done', 'failed', 'cancelled'].includes(task.status));
                const chosen = active[active.length - 1];
                this.lastTaskId = chosen?.id;
                return chosen;
        }

        /** Free-prompt turn: create (or refine) a task and submit the plan. */
        async handlePrompt(
                request: { prompt: string; requestId: string; toolInvocationToken: unknown },
                stream: ChatStreamLike,
        ): Promise<void> {
                const existing = await this.activeTask();
                if (existing && existing.status !== 'plan') {
                        stream.markdown(
                                `Task **${existing.id}** is currently **${existing.status}**. Use \`/approve\`, \`/request-changes\`, \`/sign-off\`, or \`/cancel\` to move it forward before starting something new.`,
                        );
                        return;
                }
                let taskId: string;
                if (existing) {
                        taskId = existing.id;
                } else {
                        const title = request.prompt.trim().slice(0, 80) || 'untitled flauz task';
                        const created = await this.deps.seam.createTask(title);
                        taskId = created.taskId;
                        this.lastTaskId = taskId;
                        this.deps.logger?.(`created task ${taskId}`);
                }
                const plan = this.buildPlan(taskId, request.prompt);
                await this.deps.seam.appendEvent(taskId, {
                        actor: 'agent',
                        type: 'submit-plan',
                        payload: { plan, requestId: request.requestId },
                });
                stream.markdown(plan);
        }

        /** Command turn: one of the four human gates (or a participant command). */
        async handleCommand(
                command: string,
                request: { prompt: string; requestId: string; toolInvocationToken: unknown },
                stream: ChatStreamLike,
        ): Promise<void> {
                const task = await this.activeTask();
                if (!task) {
                        stream.markdown('No active Flauz task. Send a prompt first and I will draft a plan for approval.');
                        return;
                }
                const taskId = task.id;
                switch (command) {
                        case 'approve':
                                await this.approve(taskId, request, stream);
                                return;
                        case 'request-changes':
                                await this.deps.seam.appendEvent(taskId, { actor: 'human', type: 'request-changes', payload: { note: request.prompt } });
                                stream.markdown(
                                        `Sent **${taskId}** back to planning. Describe the changes you want and I will submit a revised plan.`,
                                );
                                return;
                        case 'sign-off':
                                await this.signOff(taskId, stream);
                                return;
                        case 'cancel':
                                await this.deps.seam.appendEvent(taskId, { actor: 'human', type: 'cancel', payload: {} });
                                stream.markdown(`Task **${taskId}** cancelled.`);
                                return;
                        default:
                                stream.markdown(`Unknown command \`/${command}\`. Available: /approve, /request-changes, /sign-off, /cancel.`);
                }
        }

        private buildPlan(taskId: string, prompt: string): string {
                const selection = this.deps.getModelSelection();
                const lines = [
                        `## Flauz plan — ${taskId}`,
                        '',
                        `**Request:** ${prompt.trim()}`,
                        '',
                        '1. Run the terminal command `' + `${GOLDEN_COMMAND}` + '` (asks for your confirmation first).',
                        '2. Record the command output as an evidence row and create a checkpoint (changeset row).',
                        '3. Verify the evidence ledger hash chain.',
                        '4. Ask you to sign off.',
                        '',
                        modelAttribution(selection),
                        '',
                        '**Reply `/approve` to start execution**, `/request-changes` to re-plan, or `/cancel` to abort.',
                ];
                return lines.join('\n');
        }

        private async approve(
                taskId: string,
                request: { prompt: string; requestId: string; toolInvocationToken: unknown },
                stream: ChatStreamLike,
        ): Promise<void> {
                await this.deps.seam.appendEvent(taskId, { actor: 'human', type: 'approve', payload: { requestId: request.requestId } });
                stream.progress('Executing (terminal tool will ask for confirmation)…');
                try {
                        const result = await this.deps.invokeTool(TERMINAL_TOOL_ID, {
                                toolInvocationToken: request.toolInvocationToken,
                                input: { command: GOLDEN_COMMAND },
                        });
                        const output = extractTextResult(result);
                        const artifact = await writeCommandOutput(this.deps.workspaceRoot, taskId, 1, output);
                        const commandEvidence = await this.deps.seam.appendEvidence(taskId, {
                                kind: 'command-output',
                                uri: artifact.uri,
                                sha256: artifact.sha256,
                                note: GOLDEN_COMMAND,
                        });
                        this.deps.logger?.(`evidence ${commandEvidence.evidenceId}: ${artifact.uri}`);

                        const checkpoint = await this.deps.seam.createCheckpoint(taskId, request.requestId);
                        if (checkpoint.checkpointRef !== null) {
                                await this.deps.seam.appendEvidence(taskId, {
                                        kind: 'changeset',
                                        uri: `flauz-checkpoint://${taskId}/${request.requestId}`,
                                        sha256: sha256Of(checkpoint.checkpointRef),
                                });
                        }

                        await this.deps.seam.appendEvent(taskId, {
                                actor: 'agent',
                                type: 'report',
                                payload: { commandEvidenceId: commandEvidence.evidenceId, checkpointRef: checkpoint.checkpointRef, output },
                        });
                        await this.verify(taskId, stream);
                } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        await this.deps.seam.appendEvent(taskId, { actor: 'agent', type: 'fail', payload: { error: message } });
                        stream.markdown(`Execution failed: ${message}\n\nTask **${taskId}** is now **failed**.`);
                }
        }

        private async verify(taskId: string, stream: ChatStreamLike): Promise<void> {
                const ledger = await this.deps.seam.verifyLedger();
                const { task } = await this.deps.seam.getTask(taskId);
                if (ledger.ok && task.changes.length >= 1) {
                        await this.deps.seam.appendEvent(taskId, {
                                actor: 'tool',
                                type: 'verify-pass',
                                payload: { rows: ledger.rows, changes: task.changes.length },
                        });
                        stream.markdown(
                                [
                                        `Execution complete and verified (ledger ok, ${String(ledger.rows)} evidence row(s), ${String(task.changes.length)} checkpoint(s)).`,
                                        '',
                                        `**Reply \`/sign-off\` to close task ${taskId}.**`,
                                ].join('\n'),
                        );
                } else {
                        await this.deps.seam.appendEvent(taskId, {
                                actor: 'agent',
                                type: 'verify-fail',
                                payload: { ledgerOk: ledger.ok, firstBadSeq: ledger.firstBadSeq ?? null, changes: task.changes.length },
                        });
                        stream.markdown(
                                `Verification failed (ledger ok=${String(ledger.ok)}${ledger.firstBadSeq !== undefined ? `, firstBadSeq=${String(ledger.firstBadSeq)}` : ''}). Task **${taskId}** is back in **execute** — reply \`/approve\` to retry.`,
                        );
                }
        }

        private async signOff(taskId: string, stream: ChatStreamLike): Promise<void> {
                await this.deps.seam.appendEvent(taskId, { actor: 'human', type: 'sign-off', payload: {} });
                const { task } = await this.deps.seam.getTask(taskId);
                const ledger = await this.deps.seam.verifyLedger();
                stream.markdown(
                        [
                                `Task **${taskId}** is **done**. 🎉`,
                                '',
                                `Evidence ledger: ${ledger.ok ? 'ok' : 'BROKEN'} (${String(ledger.rows)} row(s)). Task changes: ${String(task.changes.length)}.`,
                        ].join('\n'),
                );
        }
}
