// Fixture source: the Agent Sessions provider carrying the discovery
// contract rows DA07/DA12/DA13/DA21/DA22 (status rows stay; the error row is
// appended after them; the active task reveals in the Tasks view).
import type * as vscode from 'vscode';
import { formatAge, formatTimestamp } from './format.ts';

export const SESSIONS_VIEW_ID = 'flauz.agentSessions';
const REVEAL_TASK_COMMAND = 'flauz.workspace.revealTask';

export function bridgeStatusRows(status: { coreConnected: boolean }): object[] {
	const rows: object[] = [];
	rows.push({
		kind: 'status',
		id: 'core',
		label: 'Core Service',
		description: status.coreConnected ? 'connected' : 'not connected',
		tooltip: 'The Flauz core service is running — task, evidence and checkpoint commands are available.',
		icon: 'plug',
		contextValue: 'flauzSessionCore',
	});
	return rows;
}

export class AgentSessionsTreeProvider implements vscode.TreeDataProvider<object> {
	async getChildren(): Promise<object[]> {
		const status = { coreConnected: true };
		const rows = bridgeStatusRows(status);
		try {
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

	getTreeItem(element: object): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.accessibilityInformation = { label: 'row' };
		return item;
	}

	private errorItem(message: string, retryCommand: string): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.label = 'Unable to Load Active Task';
		item.tooltip = `${message}\n\nSelecting this row retries the probe.`;
		item.contextValue = 'flauzError';
		item.command = { command: retryCommand, title: 'Retry' };
		item.accessibilityInformation = { label: `Error loading the active task: ${message}. Select to retry.` };
		return item;
	}

	private taskItem(task: { id: string; title: string; status: string; timing: { created: number; updatedAt: number } }): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.description = `Active Task ${task.id} · ${task.status} · updated ${formatAge(task.timing.updatedAt)}`;
		item.tooltip = `Created: ${formatTimestamp(task.timing.created)} UTC (${task.timing.created})`;
		item.command = { command: REVEAL_TASK_COMMAND, title: 'Reveal Flauz Task', arguments: [{ taskId: task.id }] };
		item.accessibilityInformation = { label: `Active task ${task.id}, ${task.title}, status ${task.status}` };
		return item;
	}
}
