// Fixture source: the Home + Tasks providers carrying the full discovery
// contract (docs/FLAUZ-PROGRAM/acceptance/p2-003-discovery-audit.md rows
// DA05/DA06/DA12/DA13/DA17/DA20/DA21). The NOT-INITIALIZED branches both
// carry commands — the post-fix target for P2-FIX-202.
import type * as vscode from 'vscode';
import { formatAge, formatTimestamp } from './format.ts';

export const HOME_VIEW_ID = 'flauz.home';
export const TASKS_VIEW_ID = 'flauz.tasks';
const OPEN_EVIDENCE_COMMAND = 'flauz.workspace.openEvidence';
const RETRY_SENTENCE = 'Select this row to retry.';

interface JsonFileState { readonly present: boolean; readonly value?: unknown; readonly error?: string; }

async function readJsonArtifact(path: string): Promise<JsonFileState> {
	return { present: false };
}

export class HomeTreeProvider implements vscode.TreeDataProvider<{ id: string; label: string; description: string }> {
	private lastKnownGood: readonly object[] | undefined;

	async getChildren(): Promise<object[]> {
		return [
			await this.environmentsRow(),
			await this.workflowsRow(),
		];
	}

	getTreeItem(element: object): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.accessibilityInformation = { label: `${element.label}: ${element.description}` };
		return item;
	}

	private async environmentsRow(): Promise<object> {
		const state = await readJsonArtifact('.flauz/environments.json');
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
		return {
			id: 'environments',
			label: 'Environments',
			description: '1 registered',
			tooltip: 'Environment registry: 1 environment registered. Opens the Environments view.',
			icon: 'server',
			command: { command: 'flauz.focusView.environments', title: 'Focus Flauz Environments' },
			contextValue: 'flauzHomeEnvironments',
		};
	}

	private async workflowsRow(): Promise<object> {
		const state = await readJsonArtifact('.flauz/workflows/index.json');
		if (!state.present) {
			return {
				id: 'workflows',
				label: 'Workflows',
				description: 'not initialized',
				tooltip: 'No .flauz/workflows/index.json yet — the index is created when a run is saved as a workflow. Save your next run to start it.',
				icon: 'rocket',
				command: { command: 'flauz.workflow.save', title: 'Save Run as Workflow' },
				contextValue: 'flauzHomeWorkflows',
			};
		}
		return {
			id: 'workflows',
			label: 'Workflows',
			description: '0 saved',
			tooltip: 'Workflow envelopes: 0 saved. Opens the workflow index.',
			icon: 'rocket',
			command: { command: 'vscode.open', title: 'Open Workflow Index', arguments: [] },
			contextValue: 'flauzHomeWorkflows',
		};
	}

	private unreadableRow(label: string, message: string): object {
		return {
			label,
			description: 'unreadable',
			tooltip: `${label}: ${message}\n\n${RETRY_SENTENCE} The Flauz guide (context menu) explains this surface's files.`,
			icon: 'warning',
			command: { command: 'flauz.workspace.refreshHome', title: 'Retry' },
			contextValue: 'flauzError',
		};
	}
}

export class TasksTreeProvider implements vscode.TreeDataProvider<object> {
	private lastKnownGoodTasks: readonly object[] | undefined;

	async getChildren(): Promise<object[]> {
		try {
			return [];
		} catch (err) {
			const cached = this.lastKnownGoodTasks ?? [];
			return [
				{ kind: 'error', message: String(err), retryCommand: 'flauz.workspace.refreshTasks', stale: cached.length > 0 },
				...cached,
			];
		}
	}

	getTreeItem(element: object): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.accessibilityInformation = { label: 'row' };
		return item;
	}

	private errorItem(message: string, retryCommand: string, stale: boolean): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.label = 'Unable to Load Tasks';
		item.tooltip = `${message}\n\nThe rows below are the last-known-good snapshot.\n${RETRY_SENTENCE} The Flauz guide (context menu) explains this surface's files.`;
		item.contextValue = 'flauzError';
		item.command = { command: retryCommand, title: 'Retry' };
		item.accessibilityInformation = { label: `Error loading tasks: ${message}. Select to retry.` };
		return item;
	}

	private evidenceItem(row: { seq: number; kind: string; uri: string; ts: number; sha256: string; taskId: string }): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.description = `${row.kind} · ${row.uri} · ${formatAge(row.ts)}`;
		item.tooltip = `Recorded: ${formatTimestamp(row.ts)} UTC (${row.ts})\nSHA-256: ${row.sha256}`;
		item.command = { command: OPEN_EVIDENCE_COMMAND, title: 'Open Evidence', arguments: [{ evidenceId: row.seq }] };
		item.accessibilityInformation = { label: `Evidence ${row.seq}, kind ${row.kind}, for task ${row.taskId}` };
		return item;
	}

	private taskIcon(status: string): string {
		switch (status) {
			case 'done':
				return 'check';
			case 'failed':
				return 'error';
			case 'cancelled':
				return 'close';
			default:
				return 'circle-filled';
		}
	}
}
