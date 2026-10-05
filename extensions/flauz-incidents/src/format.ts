/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Incidents shared timestamp formatting (A-PROD-006-W1).
 *
 * THE determinism LAW (the grep gate): this module uses NO host-clock calls and NO
 * `new Date()` -- the ISO stamp is computed from the injected epoch-ms by
 * pure arithmetic (the Howard Hinnant civil-from-days algorithm). The clock
 * is injected by the caller; this module is a pure function of epoch ms.
 *
 * This module is deliberately NOT byte-equal with the other flauz extensions'
 * format.ts (those use host-clock construction; this wave's grep gate forbids it in
 * src/). The station's PU6 premium-ux-gate is a separate concern at harvest;
 * this wave's own gates (the six in the work order) are the ones this module
 * must pass.
 */

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

function pad3(value: number): string {
	if (value < 10) {
		return `00${value}`;
	}
	if (value < 100) {
		return `0${value}`;
	}
	return String(value);
}

/**
 * Convert a non-negative epoch-ms stamp into UTC calendar parts (year, month
 * 1-12, day 1-31, hours 0-23, minutes 0-59, seconds 0-59, ms 0-999). Uses the
 * Howard Hinnant civil-from-days algorithm (the pure-arithmetic date calculator;
 * no host-clock construction). Throws on a negative epoch (the incident plane's clock is
 * the injected clock; a negative stamp is a programming error).
 */
function utcParts(epochMs: number): { year: number; month: number; day: number; hours: number; minutes: number; seconds: number; ms: number } {
	if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs < 0) {
		throw new Error(`flauz.incidents/v1: cannot format a non-finite or negative epoch stamp (${String(epochMs)})`);
	}
	const totalMs = Math.floor(epochMs);
	const ms = totalMs % 1000;
	const totalSeconds = Math.floor(totalMs / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	let days = Math.floor(totalHours / 24);

	// Howard Hinnant civil_from_days (days since 1970-01-01 -> {year, month, day}).
	days += 719468;
	const era = Math.floor(days >= 0 ? days / 146097 : Math.ceil(days / 146097 - 1));
	const doe = days - era * 146097; // [0, 146097)
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399)
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
	const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
	const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
	const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
	const year = m <= 2 ? y + 1 : y;
	return { year, month: m, day: d, hours, minutes, seconds, ms };
}

/**
 * Machine-grade ISO-8601 UTC stamp for protocol records (the incident
 * `reportedAtIso`, the loop journal `timestampIso`, the status record stamp):
 * `YYYY-MM-DDTHH:MM:SS.sssZ`. Pure-arithmetic; no host-clock construction.
 */
export function toIsoStamp(epochMs: number): string {
	const { year, month, day, hours, minutes, seconds, ms } = utcParts(epochMs);
	return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(ms)}Z`;
}

/**
 * Absolute UTC timestamp `YYYY-MM-DD HH:MM` for tooltips/receipts.
 * Pure-arithmetic; no host-clock construction.
 */
export function formatTimestamp(epochMs: number): string {
	const { year, month, day, hours, minutes } = utcParts(epochMs);
	return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hours)}:${pad2(minutes)}`;
}

/** Absolute UTC calendar date `YYYY-MM-DD` (ages beyond a week). */
export function formatDate(epochMs: number): string {
	const { year, month, day } = utcParts(epochMs);
	return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** One minute/hour/day in milliseconds (the relative-age helpers). */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Relative age for row descriptions: "just now", "5m ago", "3h ago", "2d ago",
 * then "YYYY-MM-DD". `nowMs` is injectable so tests stay deterministic.
 */
export function formatAge(epochMs: number, nowMs: number): string {
	const age = nowMs - epochMs;
	if (age < MINUTE_MS) {
		return 'just now';
	}
	if (age < HOUR_MS) {
		return `${Math.max(1, Math.floor(age / MINUTE_MS))}m ago`;
	}
	if (age < DAY_MS) {
		return `${Math.floor(age / HOUR_MS)}h ago`;
	}
	if (age < WEEK_MS) {
		return `${Math.floor(age / DAY_MS)}d ago`;
	}
	return formatDate(epochMs);
}

/**
 * The filename-safe stamp helper (the export-stamp convention; the loop
 * journal and the status record carry the stamp in their paths). Removes the
 * colons so the stamp is a single path segment on every platform.
 */
export function incidentsStamp(epochMs: number): string {
	return toIsoStamp(epochMs).replaceAll(':', '');
}
