// Fixture source: provider wiring for the two flauz-workspace views.
// TL4-002 coverage: BOTH provider registration forms — registerTreeDataProvider
// (flauz.home) and createTreeView (flauz.tasks, the reveal-navigation handle;
// docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md section 5) — must satisfy IA6.
export function registerViews(api: {
	registerTreeDataProvider(viewId: string, provider: unknown): unknown;
	createTreeView(viewId: string, options: { treeDataProvider: unknown }): unknown;
}): void {
	api.registerTreeDataProvider('flauz.home', { getChildren: () => [] });
	api.createTreeView('flauz.tasks', { treeDataProvider: { getChildren: () => [] } });
}
