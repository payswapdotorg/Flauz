// Fixture source: the Environments provider carrying the discovery contract
// rows DA09/DA12/DA13/DA21 (error row + last-known-good rows below it).
import type * as vscode from 'vscode';
import { formatAge, formatTimestamp } from './format.ts';

export const ENVIRONMENTS_VIEW_ID = 'flauz.environments';

export class EnvironmentsTreeProvider implements vscode.TreeDataProvider<object> {
	private lastKnownGood: readonly object[] | undefined;

	async getChildren(): Promise<object[]> {
		try {
			const rows: object[] = [];
			this.lastKnownGood = rows;
			return rows;
		} catch (err) {
			const cached = this.lastKnownGood ?? [];
			return [
				{ kind: 'error', message: err instanceof Error ? err.message : String(err), retryCommand: 'flauz.env.refreshView', stale: cached.length > 0 },
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
		item.label = 'Unable to Load Environments';
		item.tooltip = `${message}\n\nThe rows below are the last-known-good snapshot.\nSelecting this row retries the load. The Flauz guide (context menu) explains this surface's files.`;
		item.contextValue = 'flauzBrokenRow';
		item.command = { command: retryCommand, title: 'Retry' };
		item.accessibilityInformation = { label: `Error loading environments: ${message}. Select to retry.` };
		return item;
	}

	private environmentItem(descriptor: { id: string; label: string; kind: string; timing: { createdAt: number; updatedAt: number } }, active: boolean): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.description = `${descriptor.id} · ${descriptor.kind} · updated ${formatAge(descriptor.timing.updatedAt)}`;
		item.tooltip = `Created: ${formatTimestamp(descriptor.timing.createdAt)} UTC (${descriptor.timing.createdAt})`;
		item.contextValue = active ? 'flauzEnvironmentActive' : 'flauzEnvironment';
		item.accessibilityInformation = { label: `Environment ${descriptor.id}, ${descriptor.label}, kind ${descriptor.kind}` };
		return item;
	}
}
