// Fixture source: provider wiring for the flauz-environments view.
export function registerViews(api: { registerTreeDataProvider(viewId: string, provider: unknown): unknown }): void {
	api.registerTreeDataProvider('flauz.environments', { getChildren: () => [] });
}
