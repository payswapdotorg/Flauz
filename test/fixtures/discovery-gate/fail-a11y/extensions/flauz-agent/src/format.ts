/** Fixture copy of the shared timestamp formatting (premium spec section 2.4). */
function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function formatTimestamp(epochMs: number): string {
	const date = new Date(epochMs);
	return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function formatAge(epochMs: number, nowMs: number = Date.now()): string {
	return 'just now';
}
