/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-001 — the Flauz activity-bar shell surfaces owned by flauz-workspace.
 *
 *   flauz.home  — workspace overview: task/evidence counts plus the state of
 *                 the .flauz/ peer artifacts (environments registry, browser
 *                 policy, workflow index), each row jumping to its surface.
 *   flauz.tasks — the task envelope (.flauz/tasks.json) as tree rows, with
 *                 each task's evidence (hash-chained ledger rows filtered by
 *                 taskId) as child rows.
 *
 * State contract (docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 5) and premium
 * contract (docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md sections 2/4/5/6): empty
 * state = viewsWelcome; failures render an error row whose tree-item command
 * is the view's retry (refresh) command; async loads ride the stock tree
 * progress indicator; a failed refresh keeps the LAST-KNOWN-GOOD rows below
 * the error row instead of blanking the view; every displayed state is read
 * from the LIVE services — never fabricated.
 *
 * TL4-002: the tasks view registers through createTreeView (not
 * registerTreeDataProvider) because row-level reveal navigation
 * (flauz.workspace.revealTask — session-to-task with focus restoration, see
 * the premium spec section 5) needs the TreeView handle; the provider
 * implements getParent so reveal can resolve the element chain.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import { ACTIVE_STATUSES, joinPath, LEDGER_PATH, type LedgerRow, type Task, type TaskStatus } from './api.ts';
import { evidenceIdOf } from './ledger.ts';
import { formatAge, formatTimestamp } from './format.ts';
import type { WorkspaceServices } from './commands.ts';

/** View ids this extension contributes into the `flauz` container (see package.json). */
export const HOME_VIEW_ID = 'flauz.home';
export const TASKS_VIEW_ID = 'flauz.tasks';

/** Focus + refresh + reveal commands for the views above (category "Flauz", see package.json). */
export const VIEW_COMMAND_IDS = [
	'flauz.focusView',
	'flauz.focusView.home',
	'flauz.focusView.tasks',
	'flauz.workspace.refreshHome',
	'flauz.workspace.refreshTasks',
	'flauz.workspace.revealTask',
] as const;

/** The built-in command that reveals + focuses the whole `flauz` view container. */
const CONTAINER_FOCUS_COMMAND = 'workbench.view.extension.flauz.focus';

/** Command that opens an evidence artifact by id (registered in commands.ts). */
const OPEN_EVIDENCE_COMMAND = 'flauz.workspace.openEvidence';

/** Contexts for view/item/menu contributions (the error context is the premium-UX shared token). */
const TASK_CONTEXT = 'flauzTask';
const EVIDENCE_CONTEXT = 'flauzEvidence';
const ERROR_CONTEXT = 'flauzError';

/** Retry-affordance sentence every error/degraded tooltip ends with (premium spec section 4). */
const RETRY_SENTENCE = 'Select this row to retry.';

/**
 * Live context the providers read. `getServices` returning undefined means
 * "no workspace folder open" — the views show their viewsWelcome state.
 * `clock` is injectable so age rendering stays deterministic in tests
 * (defaults to Date.now; premium spec section 2.4).
 */
export interface WorkspaceViewContext {
	/** The activation-time services; undefined when no workspace folder is open. */
	readonly getServices: () => WorkspaceServices | undefined;
	/** Absolute path of the (first) workspace folder; undefined when none is open. */
	readonly getWorkspaceRoot: () => string | undefined;
	/** Reads a utf8 file relative to the workspace root; undefined = absent. */
	readonly readFile: (relativePath: string) => Promise<string | undefined>;
	/** Optional clock for the relative-age descriptions (tests pass a fixed one). */
	readonly clock?: () => number;
}

/** Registered shell surface + the disposables to push onto context.subscriptions. */
export interface WorkspaceViews {
	readonly disposables: readonly vscode.Disposable[];
	/** Fires both providers' change events (e.g. after .flauz/ bootstrap). */
	refresh(): void;
}

/** A single Home row (one Flauz surface summary). */
export interface HomeRow {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly tooltip: string;
	readonly icon: string;
	readonly command?: vscode.Command;
	readonly contextValue: string;
}

/** Tasks-tree element union (task / evidence child / error row). */
export type TasksTreeElement =
	| { readonly kind: 'task'; readonly task: Task }
	| { readonly kind: 'evidence'; readonly row: LedgerRow }
	| { readonly kind: 'error'; readonly message: string; readonly retryCommand: string; readonly stale: boolean };

/** Outcome of reading + parsing a .flauz/ peer artifact for the Home view. */
interface JsonFileState {
	readonly present: boolean;
	readonly value?: unknown;
	readonly error?: string;
}

function isTerminal(status: TaskStatus): boolean {
	return status === 'done' || status === 'failed' || status === 'cancelled';
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shortUri(uri: string, max = 42): string {
	const stripped = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
	return truncate(stripped, max);
}

/** Reads + best-effort parses a workspace JSON artifact (never throws). */
async function readJsonArtifact(readFile: (path: string) => Promise<string | undefined>, path: string): Promise<JsonFileState> {
	let text: string | undefined;
	try {
		text = await readFile(path);
	} catch (err) {
		return { present: false, error: errorMessage(err) };
	}
	if (text === undefined) {
		return { present: false };
	}
	try {
		return { present: true, value: JSON.parse(text) as unknown };
	} catch (err) {
		return { present: true, error: errorMessage(err) };
	}
}

/** Length of an array field on an unknown object, when it is one. */
function countArrayField(value: unknown, field: string): number | undefined {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const candidate = (value as Record<string, unknown>)[field];
		if (Array.isArray(candidate)) {
			return candidate.length;
		}
	}
	return undefined;
}

/** String field on an unknown object, when it is one. */
function stringField(value: unknown, field: string): string | undefined {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const candidate = (value as Record<string, unknown>)[field];
		if (typeof candidate === 'string') {
			return candidate;
		}
	}
	return undefined;
}

/** The Home tree: one row per Flauz surface, always real state. */
export class HomeTreeProvider implements vscode.TreeDataProvider<HomeRow> {
	private readonly context: WorkspaceViewContext;
	private readonly emitter: vscode.EventEmitter<HomeRow | undefined>;

	constructor(context: WorkspaceViewContext) {
		this.context = context;
		const api = vscodeApi();
		this.emitter = new api.EventEmitter<HomeRow | undefined>();
	}

	get onDidChangeTreeData(): vscode.Event<HomeRow | undefined> {
		return this.emitter.event;
	}

	/** Re-reads every section on the next tree refresh. */
	refresh(): void {
		this.emitter.fire(undefined);
	}

	async getChildren(): Promise<HomeRow[]> {
		const services = this.context.getServices();
		if (services === undefined) {
			return [];
		}
		// TL4-002 perceived performance (premium spec section 8): the five
		// sections read in PARALLEL — one slow artifact never serializes Home.
		return await Promise.all([
			this.tasksRow(services),
			this.ledgerRow(services),
			this.environmentsRow(),
			this.browserPolicyRow(),
			this.workflowsRow(),
		]);
	}

	getTreeItem(element: HomeRow): vscode.TreeItem {
		const api = vscodeApi();
		const item = new api.TreeItem(element.label, api.TreeItemCollapsibleState.None);
		item.id = `flauz.home/${element.id}`;
		item.description = element.description;
		item.tooltip = element.tooltip;
		item.iconPath = new api.ThemeIcon(element.icon);
		item.contextValue = element.contextValue;
		// Premium spec section 6: summary-row a11y grammar "<label>: <description>".
		item.accessibilityInformation = { label: `${element.label}: ${element.description}` };
		if (element.command !== undefined) {
			item.command = element.command;
		}
		return item;
	}

	private async tasksRow(services: WorkspaceServices): Promise<HomeRow> {
		try {
			const tasks = await services.tasks.listTasks();
			const open = tasks.filter(task => !isTerminal(task.status)).length;
			return {
				id: 'tasks',
				label: 'Tasks',
				description: tasks.length === 0 ? 'none yet' : `${open} open · ${tasks.length} total`,
				tooltip: `Flauz tasks in .flauz/tasks.json (${open} open, ${tasks.length} total). Opens the Tasks view.`,
				icon: 'list-tree',
				command: { command: 'flauz.focusView.tasks', title: 'Focus Flauz Tasks' },
				contextValue: 'flauzHomeTasks',
			};
		} catch (err) {
			return this.unreadableRow('Tasks', `flauz.tasks/v0 envelope: ${errorMessage(err)}`);
		}
	}

	private async ledgerRow(services: WorkspaceServices): Promise<HomeRow> {
		try {
			const rows = await services.ledger.readRows();
			return {
				id: 'ledger',
				label: 'Evidence Ledger',
				description: rows.length === 0 ? 'empty' : `${rows.length} row${rows.length === 1 ? '' : 's'}`,
				tooltip: `Hash-chained evidence ledger at ${LEDGER_PATH} (${rows.length} row${rows.length === 1 ? '' : 's'}). Opens the ledger file.`,
				icon: 'book',
				command: { command: 'vscode.open', title: 'Open Evidence Ledger', arguments: [this.workspaceUri(LEDGER_PATH)] },
				contextValue: 'flauzHomeLedger',
			};
		} catch (err) {
			return this.unreadableRow('Evidence Ledger', errorMessage(err));
		}
	}

	private async environmentsRow(): Promise<HomeRow> {
		const state = await readJsonArtifact(this.context.readFile, '.flauz/environments.json');
		if (state.error !== undefined) {
			return this.unreadableRow('Environments', state.error);
		}
		if (!state.present) {
			return {
				id: 'environments',
				label: 'Environments',
				description: 'not initialized',
				tooltip: 'No .flauz/environments.json yet — the registry is created when the first environment is registered. Opens the Environments view.',
				icon: 'server',
				command: { command: 'flauz.focusView.environments', title: 'Focus Flauz Environments' },
				contextValue: 'flauzHomeEnvironments',
			};
		}
		const count = countArrayField(state.value, 'environments');
		const active = stringField(state.value, 'activeId');
		return {
			id: 'environments',
			label: 'Environments',
			description: `${count ?? '?'} registered${active !== undefined && active !== null ? ` · active: ${active}` : ''}`,
			tooltip: `Environment registry (.flauz/environments.json): ${count ?? '?'} environment${count === 1 ? '' : 's'} registered. Opens the Environments view.`,
			icon: 'server',
			command: { command: 'flauz.focusView.environments', title: 'Focus Flauz Environments' },
			contextValue: 'flauzHomeEnvironments',
		};
	}

	private async browserPolicyRow(): Promise<HomeRow> {
		const state = await readJsonArtifact(this.context.readFile, '.flauz/browser-policy.json');
		if (state.error !== undefined) {
			return this.unreadableRow('Browser Policy', state.error);
		}
		return {
			id: 'browserPolicy',
			label: 'Browser Policy',
			description: state.present ? 'workspace file' : 'built-in default (deny-all)',
			tooltip: state.present
				? 'Workspace browser policy at .flauz/browser-policy.json. Opens the policy file.'
				: 'No .flauz/browser-policy.json — the fail-closed built-in deny-all default is in effect. Creates + opens the policy file.',
			icon: 'shield',
			command: { command: 'flauz.browser.setPolicy', title: 'Open (or Create) Browser Policy File' },
			contextValue: 'flauzHomeBrowserPolicy',
		};
	}

	private async workflowsRow(): Promise<HomeRow> {
		const state = await readJsonArtifact(this.context.readFile, '.flauz/workflows/index.json');
		if (state.error !== undefined) {
			return this.unreadableRow('Workflows', state.error);
		}
		if (!state.present) {
			return {
				id: 'workflows',
				label: 'Workflows',
				description: 'not initialized',
				tooltip: 'No .flauz/workflows/index.json yet — the index is created when a run is saved as a workflow.',
				icon: 'rocket',
				contextValue: 'flauzHomeWorkflows',
			};
		}
		const count = countArrayField(state.value, 'workflows');
		return {
			id: 'workflows',
			label: 'Workflows',
			description: `${count ?? '?'} saved`,
			tooltip: `Workflow envelopes (.flauz/workflows/): ${count ?? '?'} saved. Opens the workflow index.`,
			icon: 'rocket',
			command: { command: 'vscode.open', title: 'Open Workflow Index', arguments: [this.workspaceUri('.flauz/workflows/index.json')] },
			contextValue: 'flauzHomeWorkflows',
		};
	}

	/** Absolute file Uri for a workspace-relative path (used by vscode.open rows). */
	private workspaceUri(relativePath: string): vscode.Uri {
		const root = this.context.getWorkspaceRoot();
		const api = vscodeApi();
		return root === undefined ? api.Uri.file(relativePath) : api.Uri.file(joinPath(root, relativePath));
	}

	/**
	 * Degraded section row (premium spec section 4): the section could not be
	 * read, the view stays useful. Carries the shared error tokens —
	 * contextValue `flauzError` + a Retry-titled command — so the stock
	 * view/item/context menu rule offers the Flauz guide on it too.
	 */
	private unreadableRow(label: string, message: string): HomeRow {
		return {
			id: label.toLowerCase().replace(/[^a-z]/g, ''),
			label,
			description: 'unreadable',
			tooltip: `${label}: ${truncate(message, 160)}\n\n${RETRY_SENTENCE} The Flauz guide (context menu) explains this surface's files.`,
			icon: 'warning',
			command: { command: 'flauz.workspace.refreshHome', title: 'Retry' },
			contextValue: 'flauzError',
		};
	}
}

/** The Tasks tree: task rows with their ledger evidence as children. */
export class TasksTreeProvider implements vscode.TreeDataProvider<TasksTreeElement> {
	private readonly context: WorkspaceViewContext;
	private readonly emitter: vscode.EventEmitter<TasksTreeElement | undefined>;
	/** Last successful root render — the recovery cache (premium spec section 4). */
	private lastKnownGoodTasks: readonly Task[] | undefined;

	constructor(context: WorkspaceViewContext) {
		this.context = context;
		const api = vscodeApi();
		this.emitter = new api.EventEmitter<TasksTreeElement | undefined>();
	}

	/** Re-reads the envelope + ledger on the next tree refresh. */
	refresh(): void {
		this.emitter.fire(undefined);
	}

	get onDidChangeTreeData(): vscode.Event<TasksTreeElement | undefined> {
		return this.emitter.event;
	}

	/**
	 * Parent chain for reveal navigation (premium spec section 5): evidence
	 * resolves to its task element (via the last-known-good cache); task and
	 * error rows are roots. The TreeView.reveal API requires this method.
	 */
	getParent(element: TasksTreeElement): TasksTreeElement | undefined {
		if (element.kind !== 'evidence') {
			return undefined;
		}
		const parent = this.lastKnownGoodTasks?.find(task => task.id === element.row.taskId);
		return parent === undefined ? undefined : { kind: 'task', task: parent };
	}

	async getChildren(element?: TasksTreeElement): Promise<TasksTreeElement[]> {
		const services = this.context.getServices();
		if (services === undefined) {
			return [];
		}
		if (element === undefined) {
			try {
				const tasks = await services.tasks.listTasks();
				this.lastKnownGoodTasks = tasks;
				return tasks.map(task => ({ kind: 'task', task }) as const);
			} catch (err) {
				// Recovery law: keep the last-known-good rows below the error
				// row — a failed refresh never blanks a populated view.
				const cached = this.lastKnownGoodTasks ?? [];
				return [
					{ kind: 'error', message: errorMessage(err), retryCommand: 'flauz.workspace.refreshTasks', stale: cached.length > 0 },
					...cached.map(task => ({ kind: 'task', task }) as const),
				];
			}
		}
		if (element.kind !== 'task') {
			return [];
		}
		try {
			const rows = await services.ledger.readRows();
			return rows
				.filter(row => row.taskId === element.task.id)
				.map(row => ({ kind: 'evidence', row }) as const);
		} catch (err) {
			return [{ kind: 'error', message: errorMessage(err), retryCommand: 'flauz.workspace.refreshTasks', stale: false }];
		}
	}

	getTreeItem(element: TasksTreeElement): vscode.TreeItem {
		switch (element.kind) {
			case 'task':
				return this.taskItem(element.task);
			case 'evidence':
				return this.evidenceItem(element.row);
			case 'error':
				return this.errorItem(element.message, element.retryCommand, element.stale);
		}
	}

	/**
	 * Resolves the tree element for a task id — fresh read first (which also
	 * refreshes the recovery cache), last-known-good fallback — for the
	 * reveal navigation command. Returns undefined when the id is unknown.
	 */
	async taskElementFor(taskId: string): Promise<TasksTreeElement | undefined> {
		const services = this.context.getServices();
		if (services === undefined) {
			return undefined;
		}
		try {
			const tasks = await services.tasks.listTasks();
			this.lastKnownGoodTasks = tasks;
		} catch {
			// fall through to the last-known-good lookup below
		}
		const task = this.lastKnownGoodTasks?.find(candidate => candidate.id === taskId);
		return task === undefined ? undefined : { kind: 'task', task };
	}

	private now(): number {
		return this.context.clock?.() ?? Date.now();
	}

	private taskItem(task: Task): vscode.TreeItem {
		const api = vscodeApi();
		const active = !isTerminal(task.status);
		const item = new api.TreeItem(task.title, active ? api.TreeItemCollapsibleState.Expanded : api.TreeItemCollapsibleState.Collapsed);
		item.id = `flauz.tasks/${task.id}`;
		item.description = `${task.id} · ${task.status} · updated ${formatAge(task.timing.updatedAt, this.now())}`;
		item.tooltip = [
			`Task ${task.id} — ${task.title}`,
			`Status: ${task.status}${ACTIVE_STATUSES.includes(task.status) ? ' (active)' : ''}`,
			`Created: ${formatTimestamp(task.timing.created)} UTC (${task.timing.created})`,
			`Updated: ${formatTimestamp(task.timing.updatedAt)} UTC (${task.timing.updatedAt})`,
			'Evidence rows appear as children; they open their artifact when selected.',
		].join('\n');
		item.iconPath = new api.ThemeIcon(this.taskIcon(task.status));
		item.contextValue = TASK_CONTEXT;
		item.accessibilityInformation = { label: `Task ${task.id}, ${task.title}, status ${task.status}` };
		return item;
	}

	private taskIcon(status: TaskStatus): string {
		switch (status) {
			case 'done':
				return 'check';
			case 'failed':
				return 'error';
			case 'cancelled':
				return 'close';
			default:
				return ACTIVE_STATUSES.includes(status) ? 'circle-filled' : 'circle';
		}
	}

	private evidenceItem(row: LedgerRow): vscode.TreeItem {
		const api = vscodeApi();
		const evidenceId = evidenceIdOf(row.seq);
		const item = new api.TreeItem(evidenceId, api.TreeItemCollapsibleState.None);
		item.id = `flauz.tasks/${row.taskId}/${row.seq}`;
		item.description = `${row.kind} · ${shortUri(row.uri)} · ${formatAge(row.ts, this.now())}`;
		item.tooltip = [
			`Evidence ${evidenceId} (${row.kind}) for task ${row.taskId}`,
			`URI: ${row.uri}`,
			`Recorded: ${formatTimestamp(row.ts)} UTC (${row.ts})`,
			`SHA-256: ${row.sha256}`,
			'Selecting opens the artifact (editor for files, external browser otherwise).',
		].join('\n');
		item.iconPath = new api.ThemeIcon('file');
		item.contextValue = EVIDENCE_CONTEXT;
		item.command = { command: OPEN_EVIDENCE_COMMAND, title: 'Open Evidence', arguments: [{ evidenceId }] };
		item.accessibilityInformation = { label: `Evidence ${evidenceId}, kind ${row.kind}, for task ${row.taskId}` };
		return item;
	}

	private errorItem(message: string, retryCommand: string, stale: boolean): vscode.TreeItem {
		const api = vscodeApi();
		const item = new api.TreeItem('Unable to Load Tasks', api.TreeItemCollapsibleState.None);
		item.id = 'flauz.tasks/error';
		item.description = truncate(message, 80);
		item.tooltip = stale
			? `${message}\n\nThe rows below are the last-known-good snapshot.\n${RETRY_SENTENCE} The Flauz guide (context menu) explains this surface's files.`
			: `${message}\n\n${RETRY_SENTENCE} The Flauz guide (context menu) explains this surface's files.`;
		item.iconPath = new api.ThemeIcon('error');
		item.contextValue = ERROR_CONTEXT;
		item.command = { command: retryCommand, title: 'Retry' };
		item.accessibilityInformation = { label: `Error loading tasks: ${truncate(message, 80)}. Select to retry.` };
		return item;
	}
}

/**
 * Registers both tree data providers plus their focus/refresh/reveal commands
 * and returns the disposables (push onto context.subscriptions immediately).
 *
 * The tasks view registers through createTreeView — reveal navigation
 * (flauz.workspace.revealTask) needs the TreeView handle; the home view keeps
 * registerTreeDataProvider (no reveal affordance on summary rows).
 */
export function registerWorkspaceViews(context: WorkspaceViewContext): WorkspaceViews {
	const api = vscodeApi();
	const home = new HomeTreeProvider(context);
	const tasks = new TasksTreeProvider(context);
	const tasksView = api.window.createTreeView(TASKS_VIEW_ID, { treeDataProvider: tasks });
	const revealTask = async (arg?: unknown): Promise<unknown> => {
		const taskId = typeof arg === 'object' && arg !== null && !Array.isArray(arg)
			&& typeof (arg as { taskId?: unknown }).taskId === 'string'
			? (arg as { taskId: string }).taskId
			: undefined;
		const element = taskId === undefined ? undefined : await tasks.taskElementFor(taskId);
		if (element === undefined) {
			// Graceful degradation: unknown id (or no workspace) still lands the
			// user on the Tasks view rather than a dead command.
			return api.commands.executeCommand(`${TASKS_VIEW_ID}.focus`);
		}
		// Premium spec section 5: reveal selects + focuses the task row and
		// expands its evidence children (task-to-evidence affordance).
		return tasksView.reveal(element, { select: true, focus: true, expand: true });
	};
	const handlers: Record<(typeof VIEW_COMMAND_IDS)[number], (arg?: unknown) => unknown> = {
		'flauz.focusView': () => api.commands.executeCommand(CONTAINER_FOCUS_COMMAND),
		'flauz.focusView.home': () => api.commands.executeCommand(`${HOME_VIEW_ID}.focus`),
		'flauz.focusView.tasks': () => api.commands.executeCommand(`${TASKS_VIEW_ID}.focus`),
		'flauz.workspace.refreshHome': () => home.refresh(),
		'flauz.workspace.refreshTasks': () => tasks.refresh(),
		'flauz.workspace.revealTask': revealTask,
	};
	const disposables: vscode.Disposable[] = [
		api.window.registerTreeDataProvider(HOME_VIEW_ID, home),
		tasksView,
		...VIEW_COMMAND_IDS.map(id => api.commands.registerCommand(id, handlers[id])),
	];
	return {
		disposables,
		refresh: () => {
			home.refresh();
			tasks.refresh();
		},
	};
}
