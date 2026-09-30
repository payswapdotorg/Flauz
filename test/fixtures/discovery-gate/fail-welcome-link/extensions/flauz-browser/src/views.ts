// Fixture source: the Browser provider carrying the discovery contract rows
// DA08/DA12/DA13/DA21 — the fail-closed invalid-policy row (never a stale
// policy) with the shared error grammar.
import type * as vscode from 'vscode';

export const BROWSER_VIEW_ID = 'flauz.browser';

export class BrowserTreeProvider implements vscode.TreeDataProvider<object> {
	async getChildren(): Promise<object[]> {
		return [];
	}

	getTreeItem(element: object): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.accessibilityInformation = { label: 'row' };
		return item;
	}

	private invalidSourceRow(error: { code: string; message: string }): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.label = 'Policy Source';
		item.description = 'invalid — deny-all in effect';
		item.tooltip = `Policy file INVALID (${error.code}).\n${error.message}\nThe fail-closed built-in deny-all default is in effect. Selecting this row reloads the policy file (retry). The Flauz guide (context menu) explains this surface's files.`;
		item.contextValue = 'flauzError';
		item.command = { command: 'flauz.browser.refreshView', title: 'Retry' };
		return item;
	}
}
