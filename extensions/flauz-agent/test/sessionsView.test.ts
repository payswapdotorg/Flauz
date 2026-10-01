/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/sessionsView.ts (the flauz.agentSessions view). The module
 * takes its vscode slices as parameters, so these run under plain
 * `node --test` — the harness mock is only needed for extension-level wiring
 * (extension.test.ts covers that).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import type * as vscode from 'vscode';
import {
	SESSIONS_VIEW_ID,
	VIEW_COMMAND_IDS,
	TAKEOVER_ROW_COMMAND,
	AgentSessionsTreeProvider,
	bridgeStatusRows,
	registerAgentSessionsView,
	type BridgeStatus,
	type SessionsTreeElement,
	type SessionsViewApi,
} from '../src/sessionsView.ts';
import type { TakeoverStepSnapshot } from '../src/takeover.ts';
import type { Task } from '../src/types.ts';

const COLLAPSIBLE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Minimal vscode slices the view needs (hand-rolled doubles). */
function createApiDouble() {
	const registeredHandlers = new Map<string, (arg?: unknown) => unknown>();
	const registeredViews: string[] = [];
	const executed: string[] = [];
	const api: SessionsViewApi & {
		readonly registeredHandlers: Map<string, (arg?: unknown) => unknown>;
		readonly registeredViews: string[];
		readonly executedCommands: string[];
	} = {
		registeredHandlers,
		registeredViews,
		executedCommands: executed,
		registerTreeDataProvider: (viewId, provider) => {
			registeredViews.push(viewId);
			ok(typeof provider.getChildren === 'function');
			return { dispose: () => undefined };
		},
		registerCommand: (command, handler) => {
			registeredHandlers.set(command, handler);
			return { dispose: () => registeredHandlers.delete(command) };
		},
		executeCommand: async command => {
			executed.push(command);
			return undefined;
		},
		EventEmitter: class {
			private listeners: Array<(e: unknown) => void> = [];
			get event() {
				return (listener: (e: unknown) => void) => {
					this.listeners.push(listener);
					return { dispose: () => undefined };
				};
			}
			fire(e: unknown): void {
				for (const listener of [...this.listeners]) {
					listener(e);
				}
			}
			dispose(): void {
				this.listeners = [];
			}
		} as unknown as SessionsViewApi['EventEmitter'],
		TreeItem: class {
			label?: string;
			id?: string;
			description?: string | boolean;
			tooltip?: string;
			iconPath?: { id: string };
			command?: { command: string; title: string; arguments?: unknown[] };
			contextValue?: string;
			accessibilityInformation?: { label: string; role?: string };
			collapsibleState: number;
			constructor(label: string, collapsibleState = COLLAPSIBLE.None) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		} as unknown as SessionsViewApi['TreeItem'],
		ThemeIcon: class {
			readonly id: string;
			constructor(id: string) {
				this.id = id;
			}
		} as unknown as SessionsViewApi['ThemeIcon'],
		TreeItemCollapsibleState: COLLAPSIBLE as unknown as SessionsViewApi['TreeItemCollapsibleState'],
	};
	return api;
}

const HEALTHY: BridgeStatus = {
	coreConnected: true,
	participantRegistered: true,
	terminalToolRegistered: true,
	workspaceOpen: true,
	modelSelection: { models: [chatModelDouble()], status: 'ready' },
};

/** Double for vscode.LanguageModelChat (only the fields the view reads). */
function chatModelDouble(): vscode.LanguageModelChat {
	return { vendor: 'flauz-mock', id: 'echo-1' } as unknown as vscode.LanguageModelChat;
}

/** iconPath narrowed to the ThemeIcon shape the view sets. */
function iconId(item: vscode.TreeItem): string | undefined {
	return (item.iconPath as unknown as { id?: string } | undefined)?.id;
}

/** tooltip narrowed to the plain string the view sets. */
function tooltipText(item: vscode.TreeItem): string | undefined {
	return item.tooltip as unknown as string | undefined;
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 'T-001',
		title: 'Ship the slice',
		status: 'execute',
		events: [],
		timing: { created: 1, updatedAt: 2 },
		changes: [],
		...overrides,
	};
}

test('bridgeStatusRows: healthy bridge renders the four observed status rows', () => {
	const rows = bridgeStatusRows(HEALTHY);
	deepStrictEqual(rows.map(row => (row.kind === 'status' ? row.description : row.kind)), [
		'connected',
		'flauz.agent registered',
		'flauz_terminal ready',
		'flauz-mock/echo-1',
	]);
	deepStrictEqual(rows.map(row => (row.kind === 'status' ? row.icon : '')), ['plug', 'robot', 'terminal', 'sparkle']);
});

test('bridgeStatusRows: core failure and no-models are shown honestly', () => {
	const degraded = bridgeStatusRows({
		coreConnected: false,
		coreError: 'spawn failed',
		participantRegistered: false,
		terminalToolRegistered: false,
		workspaceOpen: true,
		modelSelection: { models: [], status: 'no-models' },
	});
	deepStrictEqual(degraded.map(row => (row.kind === 'status' ? row.description : row.kind)), [
		'failed to start',
		'not registered',
		'not registered',
		'none available',
	]);
	strictEqual(degraded[0]?.kind === 'status' && degraded[0].icon, 'error');
	ok(degraded[0]?.kind === 'status' && degraded[0].tooltip.includes('spawn failed'));
});

test('provider: no workspace folder -> empty (viewsWelcome path)', async () => {
	const api = createApiDouble();
	const provider = new AgentSessionsTreeProvider(api, () => ({ ...HEALTHY, workspaceOpen: false }));
	deepStrictEqual(await provider.getChildren(), []);
});

test('provider: active task row appends with the reveal affordance', async () => {
	const api = createApiDouble();
	const task = makeTask();
	const provider = new AgentSessionsTreeProvider(api, () => ({ ...HEALTHY, activeTask: async () => task }), () => task.timing.updatedAt);
	const rows = await provider.getChildren();
	strictEqual(rows.length, 5);
	const last = rows[4]!;
	strictEqual(last.kind, 'task');
	const item = provider.getTreeItem(last);
	strictEqual(item.label, 'Ship the slice');
	strictEqual(item.description, 'Active Task T-001 · execute · updated just now');
	// TL4-002: session -> task reveal navigation with the task id argument.
	strictEqual(item.command?.command, 'flauz.workspace.revealTask');
	deepStrictEqual(item.command?.arguments, [{ taskId: 'T-001' }]);
	strictEqual(item.command?.title, 'Reveal Flauz Task');
	ok(tooltipText(item)?.includes('Updated: 1970-01-01 00:00 UTC (2)'));
	strictEqual(item.accessibilityInformation?.label, 'Active task T-001, Ship the slice, status execute');
});

test('provider: failing task probe -> error row wired to the retry command', async () => {
	const api = createApiDouble();
	const provider = new AgentSessionsTreeProvider(api, () => ({
		...HEALTHY,
		activeTask: async () => {
			throw new Error('seam request timed out');
		},
	}));
	const rows = await provider.getChildren();
	const last = rows[4]!;
	strictEqual(last.kind, 'error');
	const item = provider.getTreeItem(last);
	strictEqual(iconId(item), 'error');
	strictEqual(item.command?.command, 'flauz.agent.refreshSessions');
	ok(tooltipText(item)?.includes('timed out'));
});

test('registration: view + both commands register; focus delegates to the built-in; refresh fires change', async () => {
	const api = createApiDouble();
	let changeEvents = 0;
	const { provider } = registerAgentSessionsView(api, () => HEALTHY);
	provider.onDidChangeTreeData?.(() => {
		changeEvents++;
	});
	deepStrictEqual(api.registeredViews, [SESSIONS_VIEW_ID]);
	deepStrictEqual([...api.registeredHandlers.keys()].sort(), [...VIEW_COMMAND_IDS].sort());
	await api.registeredHandlers.get('flauz.focusView.agentSessions')?.();
	deepStrictEqual(api.executedCommands, ['flauz.agentSessions.focus']);
	api.registeredHandlers.get('flauz.agent.refreshSessions')?.();
	strictEqual(changeEvents, 1);
});

test('VIEW_COMMAND_IDS pins the two shell commands', () => {
	deepStrictEqual([...VIEW_COMMAND_IDS], ['flauz.focusView.agentSessions', 'flauz.agent.refreshSessions']);
});

test('P2-FIX-204: TAKEOVER_ROW_COMMAND pins the affordance command (extension.ts registers it next to the bridge commands)', () => {
	strictEqual(TAKEOVER_ROW_COMMAND, 'flauz.agent.takeoverStep');
});

/** A takeover snapshot double (the port's probe contract). */
function takeoverSnapshot(state: TakeoverStepSnapshot['state']): TakeoverStepSnapshot {
	return { state, graphId: 'G-001', stepId: 'S-01', stepTitle: 'stuck work' };
}

test('P2-FIX-204: a stuck step renders the Take over affordance row under the active task', async () => {
	const api = createApiDouble();
	const task = makeTask();
	const provider = new AgentSessionsTreeProvider(api, () => ({
		...HEALTHY,
		activeTask: async () => task,
		takeoverStep: async () => takeoverSnapshot('stuck'),
	}), () => task.timing.updatedAt);
	const rows = await provider.getChildren();
	strictEqual(rows.length, 6, 'four status rows + the task row + the takeover row');
	const last = rows[5]!;
	strictEqual(last.kind, 'takeover');
	const item = provider.getTreeItem(last);
	strictEqual(item.label, 'Take Over Step S-01…');
	strictEqual(item.description, 'stuck on the approval gate — finish it by hand (human gate)');
	strictEqual(iconId(item), 'person');
	strictEqual(item.contextValue, 'flauzSessionTakeover');
	strictEqual(item.command?.command, TAKEOVER_ROW_COMMAND);
	strictEqual(item.command?.title, 'Take Over Step…');
	deepStrictEqual(item.command?.arguments, [{ taskId: 'T-001' }]);
	ok(tooltipText(item)?.includes('stuck on a pending approval gate'));
	ok(tooltipText(item)?.includes('human-only transitions'));
	ok(tooltipText(item)?.includes('evidence row into the shared ledger'));
	strictEqual(item.accessibilityInformation?.label, 'Take Over Step S-01, stuck work: stuck on the approval gate, finish it by hand (human gate)');
});

test('P2-FIX-204: the taken-over state renders legibly (icon + description, the agent may not run it)', async () => {
	const api = createApiDouble();
	const task = makeTask();
	const provider = new AgentSessionsTreeProvider(api, () => ({
		...HEALTHY,
		activeTask: async () => task,
		takeoverStep: async () => takeoverSnapshot('taken-over'),
	}), () => task.timing.updatedAt);
	const rows = await provider.getChildren();
	const last = rows[5]!;
	strictEqual(last.kind, 'takeover');
	const item = provider.getTreeItem(last);
	strictEqual(item.label, 'Step S-01 taken over');
	strictEqual(item.description, 'held for the human — the agent may not run it');
	strictEqual(iconId(item), 'person');
	ok(tooltipText(item)?.includes('human-only transitions, never auto-advanced'));
	strictEqual(item.accessibilityInformation?.label, 'Step S-01 taken over, held for the human — the agent may not run it');
});

test('P2-FIX-204: takeover-pending renders the acceptance hold; no probe -> no row; probe failure keeps the observed rows', async () => {
	const api = createApiDouble();
	const task = makeTask();
	const pending = new AgentSessionsTreeProvider(api, () => ({
		...HEALTHY,
		activeTask: async () => task,
		takeoverStep: async () => takeoverSnapshot('takeover-pending'),
	}), () => task.timing.updatedAt);
	const pendingRows = await pending.getChildren();
	strictEqual(pendingRows.length, 6);
	const pendingItem = pending.getTreeItem(pendingRows[5]!);
	strictEqual(pendingItem.label, 'Step S-01 takeover requested');
	strictEqual(pendingItem.description, 'waiting for your acceptance (human gate)');

	// No probe wired (the pre-P2-FIX-204 wiring): the tree is exactly what it was.
	const untouched = new AgentSessionsTreeProvider(api, () => ({ ...HEALTHY, activeTask: async () => task }));
	strictEqual((await untouched.getChildren()).length, 5, 'the takeover row is additive — it never displaces the observed rows');

	// A failing probe is last-known-good: the observed rows stay, nothing blanks.
	const failing = new AgentSessionsTreeProvider(api, () => ({
		...HEALTHY,
		activeTask: async () => task,
		takeoverStep: async () => {
			throw new Error('orchestration journal unreadable');
		},
	}));
	const failingRows = await failing.getChildren();
	strictEqual(failingRows.length, 5, 'a probe failure keeps the four status rows + the task row');
	ok(failingRows.every(row => row.kind !== 'error'), 'the probe failure is not surfaced as a tree error row (additive state only)');
});
