/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz shared timestamp formatting (docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md
 * section 2.4).
 *
 * This module is deliberately duplicated VERBATIM in every flauz extension
 * that touches timestamps — flauz extensions cannot share source without
 * coupling their builds, and the drift is machine-checked instead:
 * build/flauz/scripts/premium-ux-gate.mjs (PU6) normalizes every flauz
 * extension's src/format.ts and fails unless the copies are identical.
 *
 * Rules:
 *   - row descriptions carry RELATIVE ages: "just now", "5m ago", "3h ago",
 *     "2d ago"; anything older than 7 days renders the calendar date.
 *   - tooltips carry the ABSOLUTE UTC timestamp "YYYY-MM-DD HH:MM".
 *   - raw epoch numbers are never user-visible (tooltips may append the epoch
 *     for log correlation — the number always travels with the stamp).
 *   - protocol records (session descriptors, persisted evidence) carry
 *     machine-grade ISO-8601 stamps via `toIsoStamp` — one timestamp source
 *     of truth for rendering AND serialization (premium spec section 2.4 v2,
 *     recorded at the TL4-002 integration wave).
 */

/** One minute in milliseconds. */
const MINUTE_MS = 60_000;
/** One hour in milliseconds. */
const HOUR_MS = 60 * MINUTE_MS;
/** One day in milliseconds. */
const DAY_MS = 24 * HOUR_MS;
/** Ages beyond a week render as calendar dates instead of "Nd ago". */
const WEEK_MS = 7 * DAY_MS;

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

/** Absolute UTC timestamp "YYYY-MM-DD HH:MM" for tooltips and receipts. */
export function formatTimestamp(epochMs: number): string {
	const date = new Date(epochMs);
	return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/** Absolute UTC calendar date "YYYY-MM-DD" (ages beyond a week). */
export function formatDate(epochMs: number): string {
	return formatTimestamp(epochMs).slice(0, 10);
}

/**
 * Relative age for row descriptions: "just now", "5m ago", "3h ago", "2d ago",
 * then "YYYY-MM-DD". `nowMs` is injectable so tests stay deterministic.
 */
export function formatAge(epochMs: number, nowMs: number = Date.now()): string {
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
 * Machine-grade ISO-8601 UTC stamp for protocol records (session descriptors,
 * persisted evidence): the serialization sibling of `formatTimestamp`. Same
 * source of truth — no flauz code may build a timestamp outside this module
 * (PU6 bright line, premium spec section 2.4).
 */
export function toIsoStamp(epochMs: number): string {
	return new Date(epochMs).toISOString();
}
