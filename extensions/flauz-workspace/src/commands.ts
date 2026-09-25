/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/commands.ts
 *
 *  The command seam. Seven contract commands (createTask / appendEvent / listTasks /
 *  getTask / appendEvidence / createCheckpoint / verifyLedger) plus one additive
 *  command (openEvidence) required by the SCM artifact mapping — see REPORT
 *  §CONTRACT-DEVIATIONS. Worker F's runtime calls these via vscode.commands;
 *  illegal transitions raise Errors whose messages list the allowed source statuses.
 *
 *  Handlers are pure with respect to vscode (typed via `import type`); registration
 *  goes through globals.vscodeApi() so tests can wire a mock registry.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import type { TaskEvent } from './api.ts';
import type { TaskService } from './taskService.ts';
import type { EvidenceLedger } from './ledger.ts';
import type { CheckpointInterop } from './checkpoint.ts';
import type { FlauzArtifactProvider } from './scmArtifactProvider.ts';
import { validateRowInput } from './ledger.ts';

export const COMMAND_IDS = [
        'flauz.workspace.createTask',
        'flauz.workspace.appendEvent',
        'flauz.workspace.listTasks',
        'flauz.workspace.getTask',
        'flauz.workspace.appendEvidence',
        'flauz.workspace.createCheckpoint',
        'flauz.workspace.verifyLedger',
        'flauz.workspace.openEvidence',
] as const;

export type WorkspaceCommandId = (typeof COMMAND_IDS)[number];

export interface WorkspaceServices {
        readonly tasks: TaskService;
        readonly ledger: EvidenceLedger;
        readonly checkpoints: CheckpointInterop;
        readonly artifacts: FlauzArtifactProvider;
}

export type WorkspaceHandler = (arg: unknown) => Promise<unknown>;

function requireArgs(arg: unknown, command: string, keys: readonly string[]): Record<string, unknown> {
        if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
                throw new Error(`flauz.workspace.${command}: expected an argument object with keys ${keys.join(', ')}`);
        }
        const record = arg as Record<string, unknown>;
        for (const key of keys) {
                if (!(key in record)) {
                        throw new Error(`flauz.workspace.${command}: missing required key '${key}'`);
                }
        }
        return record;
}

function requireString(value: unknown, command: string, key: string): string {
        if (typeof value !== 'string' || value.length === 0) {
                throw new Error(`flauz.workspace.${command}: '${key}' must be a non-empty string`);
        }
        return value;
}

function optionalStringOrNull(value: unknown): string | null | undefined {
        if (value === undefined || value === null) {
                return value === undefined ? undefined : null;
        }
        if (typeof value !== 'string') {
                throw new Error('stopId must be a string when present');
        }
        return value;
}

export function createCommandHandlers(services: WorkspaceServices): Record<WorkspaceCommandId, WorkspaceHandler> {
        return {
                'flauz.workspace.createTask': async arg => {
                        const { title } = requireArgs(arg, 'createTask', ['title']);
                        const task = await services.tasks.createTask(requireString(title, 'createTask', 'title'));
                        return { taskId: task.id };
                },
                'flauz.workspace.appendEvent': async arg => {
                        const args = requireArgs(arg, 'appendEvent', ['taskId', 'event']);
                        const taskId = requireString(args.taskId, 'appendEvent', 'taskId');
                        if (typeof args.event !== 'object' || args.event === null || Array.isArray(args.event)) {
                                throw new Error('flauz.workspace.appendEvent: event must be an object {ts, actor, type, payload}');
                        }
                        const task = await services.tasks.appendEvent(taskId, args.event as TaskEvent);
                        return { task };
                },
                'flauz.workspace.listTasks': async () => {
                        return { tasks: await services.tasks.listTasks() };
                },
                'flauz.workspace.getTask': async arg => {
                        const args = requireArgs(arg, 'getTask', ['taskId']);
                        return { task: await services.tasks.getTask(requireString(args.taskId, 'getTask', 'taskId')) };
                },
                'flauz.workspace.appendEvidence': async arg => {
                        const args = requireArgs(arg, 'appendEvidence', ['taskId', 'row']);
                        const taskId = requireString(args.taskId, 'appendEvidence', 'taskId');
                        // Task existence first — never orphan a ledger row behind a failed timeline write.
                        await services.tasks.getTask(taskId);
                        const row = validateRowInput(args.row);
                        const appended = await services.ledger.append(taskId, row);
                        await services.tasks.recordEvidence(taskId, {
                                evidenceId: appended.evidenceId,
                                seq: appended.seq,
                                kind: appended.row.kind,
                                uri: appended.row.uri,
                                sha256: appended.row.sha256,
                                note: row.note,
                        });
                        services.artifacts.notifyChanged([appended.row.kind]);
                        return { evidenceId: appended.evidenceId, seq: appended.seq };
                },
                'flauz.workspace.createCheckpoint': async arg => {
                        const args = requireArgs(arg, 'createCheckpoint', ['taskId', 'requestId']);
                        const taskId = requireString(args.taskId, 'createCheckpoint', 'taskId');
                        const requestId = requireString(args.requestId, 'createCheckpoint', 'requestId');
                        const stopId = optionalStringOrNull(args.stopId);
                        const outcome = await services.checkpoints.create({ taskId, requestId, stopId });
                        return { checkpointRef: outcome.checkpointRef };
                },
                'flauz.workspace.verifyLedger': async () => {
                        const result = await services.ledger.verify();
                        if (result.firstBadSeq !== undefined) {
                                return { ok: result.ok, rows: result.rows, firstBadSeq: result.firstBadSeq };
                        }
                        return { ok: result.ok, rows: result.rows };
                },
                'flauz.workspace.openEvidence': async arg => {
                        const args = requireArgs(arg, 'openEvidence', ['evidenceId']);
                        const evidenceId = requireString(args.evidenceId, 'openEvidence', 'evidenceId');
                        const row = await services.ledger.rowByEvidenceId(evidenceId);
                        if (row === undefined) {
                                throw new Error(`flauz.workspace.openEvidence: unknown evidence '${evidenceId}'`);
                        }
                        const api = vscodeApi();
                        const uri = api.Uri.parse(row.uri);
                        if (uri.scheme === 'file') {
                                const document = await api.workspace.openTextDocument(uri);
                                await api.window.showTextDocument(document);
                        } else {
                                await api.env.openExternal(uri);
                        }
                        return true;
                },
        };
}

/** Registers all seam commands against the ambient vscode (mock in tests). */
export function registerWorkspaceCommands(services: WorkspaceServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers = createCommandHandlers(services);
        return COMMAND_IDS.map(id => api.commands.registerCommand(id, handlers[id]));
}
