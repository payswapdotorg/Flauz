// Fixture source: provider wiring for the flauz-agent view.
export function registerViews(api: { registerTreeDataProvider(viewId: string, provider: unknown): unknown }): void {
	api.registerTreeDataProvider('flauz.agentSessions', { getChildren: () => [] });
}
