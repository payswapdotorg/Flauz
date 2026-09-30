// Fixture source: the Models provider carrying the discovery contract rows
// DA10/DA21 — the honest registered/stub split plus the documented
// no-failure-source posture (premium spec section 9).
// premium-ux-gate: no-failure-source — the rows come from static registration
// data (no runtime fetch); the dormant viewsWelcome is the safety net.
import type * as vscode from 'vscode';

export const MODELS_VIEW_ID = 'flauz.models';

export class ModelsTreeProvider implements vscode.TreeDataProvider<object> {
	async getChildren(): Promise<object[]> {
		return modelsRows([{ vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Deterministic Echo' }]);
	}

	getTreeItem(element: object): vscode.TreeItem {
		const item = {} as vscode.TreeItem;
		item.accessibilityInformation = { label: 'row' };
		return item;
	}
}

export function modelsRows(registered: readonly { vendor: string; modelId: string; modelName: string }[]): object[] {
	const rows: object[] = registered.map(provider => ({
		id: `registered-${provider.vendor}`,
		label: provider.vendor,
		description: `${provider.modelId} · registered · ${provider.modelName}`,
		tooltip: `Vendor '${provider.vendor}' is REGISTERED and serving model '${provider.modelId}'.`,
		icon: 'sparkle',
		contextValue: 'flauzModelRegistered',
	}));
	for (const plan of [{ vendor: 'claude' }, { vendor: 'codex' }, { vendor: 'qwen' }]) {
		rows.push({
			id: `stub-${plan.vendor}`,
			label: plan.vendor,
			description: `plan · design stub · not registered`,
			tooltip: `Vendor '${plan.vendor}' is a DESIGN-ONLY plan: no adapter, no network, no secrets.`,
			icon: 'circle',
			contextValue: 'flauzModelStub',
		});
	}
	return rows;
}
