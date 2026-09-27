// Fixture source: implementation B of the shared timestamp module — DRIFTED
// from implementation A (different body), so PU6 must fail.
export function formatTimestamp(epochMs: number): string {
	const date = new Date(epochMs);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
