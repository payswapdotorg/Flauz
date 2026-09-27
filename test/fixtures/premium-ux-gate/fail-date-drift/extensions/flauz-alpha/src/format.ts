// Fixture source: implementation A of the shared timestamp module.
export function formatTimestamp(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ');
}
