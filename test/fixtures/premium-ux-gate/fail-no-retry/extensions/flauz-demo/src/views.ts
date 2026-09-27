// Fixture source: a tree provider WITHOUT the premium-UX state-template tokens
// (no shared `flauzError` context, no Retry-titled command) — PU2 must fail.
export class DemoTreeProvider implements TreeDataProvider<string> {
	getChildren(): string[] {
		return [];
	}

	getTreeItem(element: string): TreeItem {
		return {
			label: element,
			tooltip: `Demo item ${element}.`,
			iconPath: 'circle',
			contextValue: 'flauzDemoItem',
		};
	}
}
