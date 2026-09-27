// Fixture source: a tree provider carrying the full premium-UX state-template
// token contract (docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md section 10, PU2).
export class DemoTreeProvider implements TreeDataProvider<string> {
	getChildren(): string[] {
		return [];
	}

	getTreeItem(element: string): TreeItem {
		if (element === 'error') {
			return {
				label: 'Unable to Load Demo Items',
				tooltip: 'The demo file could not be read.\n\nSelect this row to retry.',
				iconPath: 'error',
				contextValue: 'flauzError',
				command: { command: 'flauz.demo.refreshView', title: 'Retry' },
				accessibilityInformation: { label: 'Error loading demo items. Select to retry.' },
			};
		}
		return {
			label: element,
			tooltip: `Demo item ${element}.`,
			iconPath: 'circle',
			contextValue: 'flauzDemoItem',
			accessibilityInformation: { label: `Demo item ${element}` },
		};
	}
}
