// Fixture source: provider wiring for the flauz-browser view.
export function registerViews(api: { registerTreeDataProvider(viewId: string, provider: unknown): unknown }): void {
	api.registerTreeDataProvider('flauz.browser', { getChildren: () => [] });
}
