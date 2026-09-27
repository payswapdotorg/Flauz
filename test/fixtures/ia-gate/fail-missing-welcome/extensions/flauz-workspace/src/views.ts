// Fixture source: provider wiring for the two flauz-workspace views.
export function registerViews(api: { registerTreeDataProvider(viewId: string, provider: unknown): unknown }): void {
	api.registerTreeDataProvider('flauz.home', { getChildren: () => [] });
	api.registerTreeDataProvider('flauz.tasks', { getChildren: () => [] });
}
