// Fixture source: provider wiring for the flauz-models view.
export function registerViews(api: { registerTreeDataProvider(viewId: string, provider: unknown): unknown }): void {
	api.registerTreeDataProvider('flauz.models', { getChildren: () => [] });
}
