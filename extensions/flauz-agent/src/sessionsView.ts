/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-001 — the `flauz.agentSessions` view (container `flauz`): live status of
 * the agent bridge — core service, chat participant, terminal tool, model
 * selection and the active task — read from the REAL runtime state fed by
 * extension.ts at its activation milestones (docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md
 * section 5).
 *
 * State contract: empty (viewsWelcome) when no workspace folder is open; an
 * error row with a Retry command when the seam probe fails; everything shown
 * is observed state, never fabricated.
 *
 * DI shape mirrors src/tools/terminalTool.ts: the module takes the vscode
 * slices it needs as parameters so tests run under plain `node --test`
 * without the editor.
 */

import type * as vscode from 'vscode';
import type { Task } from './types.ts';
import type { ModelSelection } from './models.ts';
import { formatAge, formatTimestamp } from './format.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const SESSIONS_VIEW_ID = 'flauz.agentSessions';

/** Focus + refresh commands for the view (category "Flauz", see package.json). */
export const VIEW_COMMAND_IDS = [
        'flauz.focusView.agentSessions',
        'flauz.agent.refreshSessions',
] as const;

/**
 * Session-to-task reveal navigation (TL4-PREMIUM-UX.md section 5): registered
 * by flauz-workspace, which owns the flauz.tasks TreeView handle. Falls back
 * to focusing the Tasks view when the id cannot be revealed.
 */
const REVEAL_TASK_COMMAND = 'flauz.workspace.revealTask';

/** Live bridge status, fed by extension.ts. All fields are observed facts. */
export interface BridgeStatus {
        /** True once the core service handshake completed. */
        readonly coreConnected: boolean;
        /** Set when the core service failed to start (message from the activation log). */
        readonly coreError?: string;
        /** True once the flauz.agent chat participant is registered. */
        readonly participantRegistered: boolean;
        /** True once the flauz_terminal language model tool is registered. */
        readonly terminalToolRegistered: boolean;
        /** Current model selection (undefined until warmed). */
        readonly modelSelection?: ModelSelection;
        /** True when a workspace folder is open (the bridge needs one). */
        readonly workspaceOpen: boolean;
        /** Probes the seam for the active task; undefined when the seam is down. */
        readonly activeTask?: () => Promise<Task | undefined>;
}

/** Tree element union: one status row, the active task row, or an error row. */
export type SessionsTreeElement =
        | { readonly kind: 'status'; readonly id: 'core' | 'participant' | 'terminalTool' | 'models'; readonly label: string; readonly description: string; readonly tooltip: string; readonly icon: string; readonly contextValue: string }
        | { readonly kind: 'task'; readonly task: Task }
        | { readonly kind: 'error'; readonly message: string; readonly retryCommand: string };

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface SessionsViewApi {
        registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<SessionsTreeElement>): vscode.Disposable;
        registerCommand(command: string, handler: (arg?: unknown) => unknown): vscode.Disposable;
        executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
        EventEmitter: new <T>() => vscode.EventEmitter<T>;
        TreeItem: typeof vscode.TreeItem;
        ThemeIcon: typeof vscode.ThemeIcon;
        TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

/** Injectable seam probe used when the provider refreshes the active-task row. */
export type ActiveTaskProbe = () => Promise<Task | undefined>;

function truncate(text: string, max: number): string {
        return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Builds the status rows for a snapshot (pure; exported for tests). */
export function bridgeStatusRows(status: BridgeStatus): SessionsTreeElement[] {
        const rows: SessionsTreeElement[] = [];
        if (status.coreError !== undefined) {
                rows.push({
                        kind: 'status',
                        id: 'core',
                        label: 'Core Service',
                        description: 'failed to start',
                        tooltip: `The Flauz core service failed to start: ${truncate(status.coreError, 160)}\nThe bridge runs degraded — commands that need the seam stay unavailable until it recovers.`,
                        icon: 'error',
                        contextValue: 'flauzSessionCore',
                });
        } else {
                rows.push({
                        kind: 'status',
                        id: 'core',
                        label: 'Core Service',
                        description: status.coreConnected ? 'connected' : 'not connected',
                        tooltip: status.coreConnected
                                ? 'The Flauz core service is running — task, evidence and checkpoint commands are available.'
                                : 'The Flauz core service is not running. The bridge retries on the next activation or refresh.',
                        icon: status.coreConnected ? 'plug' : 'circle',
                        contextValue: 'flauzSessionCore',
                });
        }
        rows.push({
                kind: 'status',
                id: 'participant',
                label: 'Chat Participant',
                description: status.participantRegistered ? 'flauz.agent registered' : 'not registered',
                tooltip: status.participantRegistered
                        ? 'The flauz.agent chat participant is registered — talk to it from the Chat view.'
                        : 'The flauz.agent chat participant is not registered (the bridge needs a workspace folder and the core service).',
                icon: status.participantRegistered ? 'robot' : 'circle',
                contextValue: 'flauzSessionParticipant',
        });
        rows.push({
                kind: 'status',
                id: 'terminalTool',
                label: 'Terminal Tool',
                description: status.terminalToolRegistered ? 'flauz_terminal ready' : 'not registered',
                tooltip: status.terminalToolRegistered
                        ? 'The flauz_terminal tool is registered — agent shell commands pass the human confirmation gate.'
                        : 'The flauz_terminal tool is not registered yet.',
                icon: status.terminalToolRegistered ? 'terminal' : 'circle',
                contextValue: 'flauzSessionTerminalTool',
        });
        const selection = status.modelSelection;
        rows.push({
                kind: 'status',
                id: 'models',
                label: 'Models',
                description: selection === undefined
                        ? 'not warmed'
                        : selection.models.length === 0
                                ? 'none available'
                                : selection.models.map(model => `${model.vendor}/${model.id}`).join(', '),
                tooltip: selection === undefined
                        ? 'Model selection has not been warmed yet (happens at activation).'
                        : selection.models.length === 0
                                ? 'No language models matched the preferred selection — the participant stays available but generation is not possible.'
                                : `Preferred language models: ${selection.models.map(model => `${model.vendor}/${model.id}`).join(', ')}.`,
                icon: selection !== undefined && selection.models.length > 0 ? 'sparkle' : 'circle',
                contextValue: 'flauzSessionModels',
        });
        return rows;
}

/** The Agent Sessions tree: real bridge status + the active task row. */
export class AgentSessionsTreeProvider implements vscode.TreeDataProvider<SessionsTreeElement> {
        private readonly api: SessionsViewApi;
        private readonly getStatus: () => BridgeStatus;
        private readonly clock: () => number;
        private readonly emitter: vscode.EventEmitter<SessionsTreeElement | undefined>;

        constructor(api: SessionsViewApi, getStatus: () => BridgeStatus, clock: () => number = () => Date.now()) {
                this.api = api;
                this.getStatus = getStatus;
                this.clock = clock;
                this.emitter = new api.EventEmitter<SessionsTreeElement | undefined>();
        }

        /** Re-probes the bridge on the next tree refresh. */
        refresh(): void {
                this.emitter.fire(undefined);
        }

        get onDidChangeTreeData(): vscode.Event<SessionsTreeElement | undefined> {
                return this.emitter.event;
        }

        async getChildren(): Promise<SessionsTreeElement[]> {
                const status = this.getStatus();
                if (!status.workspaceOpen) {
                        return [];
                }
                const rows = bridgeStatusRows(status);
                if (status.activeTask === undefined) {
                        return rows;
                }
                try {
                        const task = await status.activeTask();
                        if (task !== undefined) {
                                rows.push({ kind: 'task', task });
                        }
                        return rows;
                } catch (err) {
                        rows.push({
                                kind: 'error',
                                message: err instanceof Error ? err.message : String(err),
                                retryCommand: 'flauz.agent.refreshSessions',
                        });
                        return rows;
                }
        }

        getTreeItem(element: SessionsTreeElement): vscode.TreeItem {
                const api = this.api;
                switch (element.kind) {
                        case 'status': {
                                const item = new api.TreeItem(element.label, api.TreeItemCollapsibleState.None);
                                item.id = `flauz.agentSessions/${element.id}`;
                                item.description = element.description;
                                item.tooltip = element.tooltip;
                                item.iconPath = new api.ThemeIcon(element.icon);
                                item.contextValue = element.contextValue;
                                item.accessibilityInformation = { label: `${element.label}: ${element.description}` };
                                return item;
                        }
                        case 'task': {
                                const task = element.task;
                                const item = new api.TreeItem(task.title, api.TreeItemCollapsibleState.None);
                                item.id = `flauz.agentSessions/task/${task.id}`;
                                item.description = `Active Task ${task.id} · ${task.status} · updated ${formatAge(task.timing.updatedAt, this.clock())}`;
                                item.tooltip = [
                                        `Active task ${task.id} — ${task.title} (status: ${task.status}).`,
                                        `Created: ${formatTimestamp(task.timing.created)} UTC (${task.timing.created})`,
                                        `Updated: ${formatTimestamp(task.timing.updatedAt)} UTC (${task.timing.updatedAt})`,
                                        'Selecting reveals this task in the Flauz Tasks view with its evidence trail expanded.',
                                ].join('\n');
                                item.iconPath = new api.ThemeIcon('list-tree');
                                item.contextValue = 'flauzSessionTask';
                                item.command = { command: REVEAL_TASK_COMMAND, title: 'Reveal Flauz Task', arguments: [{ taskId: task.id }] };
                                item.accessibilityInformation = { label: `Active task ${task.id}, ${task.title}, status ${task.status}` };
                                return item;
                        }
                        case 'error': {
                                const item = new api.TreeItem('Unable to Load Active Task', api.TreeItemCollapsibleState.None);
                                item.id = 'flauz.agentSessions/error';
                                item.description = truncate(element.message, 80);
                                item.tooltip = `${element.message}\n\nSelecting this row retries the probe.`;
                                item.iconPath = new api.ThemeIcon('error');
                                item.contextValue = 'flauzError';
                                item.command = { command: element.retryCommand, title: 'Retry' };
                                item.accessibilityInformation = { label: `Error loading the active task: ${truncate(element.message, 80)}. Select to retry.` };
                                return item;
                        }
                }
        }
}

/**
 * Registers the tree data provider plus its focus/refresh commands and
 * returns the disposables (push onto context.subscriptions immediately).
 * `getStatus` must return the CURRENT bridge status snapshot.
 */
export function registerAgentSessionsView(api: SessionsViewApi, getStatus: () => BridgeStatus, clock: () => number = () => Date.now()): { readonly disposables: readonly vscode.Disposable[]; readonly provider: AgentSessionsTreeProvider } {
        const provider = new AgentSessionsTreeProvider(api, getStatus, clock);
        const handlers: Record<(typeof VIEW_COMMAND_IDS)[number], () => unknown> = {
                'flauz.focusView.agentSessions': () => api.executeCommand(`${SESSIONS_VIEW_ID}.focus`),
                'flauz.agent.refreshSessions': () => provider.refresh(),
        };
        return {
                provider,
                disposables: [
                        api.registerTreeDataProvider(SESSIONS_VIEW_ID, provider),
                        ...VIEW_COMMAND_IDS.map(id => api.registerCommand(id, handlers[id])),
                ],
        };
}
