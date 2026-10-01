/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- the friction-log contract.
 *
 * Schema `flauz.dogfood-friction/v1` (the work order's fixed shape):
 *
 *   - one JSON line per friction event, exactly the mandated fields
 *     plus the schema/type discriminators:
 *
 *         { "schema": "flauz.dogfood-friction/v1", "type": "friction",
 *           "ts": <epoch-ms>, "phase": "...", "kind": "...",
 *           "detail": "...", "recovery": "..." }
 *
 *     `kind` comes from the TL-A handoff's A3 capture list VERBATIM
 *     (failed tasks; repeated manual interventions; confusing UX;
 *     provider failures; browser/environment failures; slow paths;
 *     recovery defects; evidence/provenance gaps; upgrade/migration
 *     defects) mapped to the order's kebab-case tokens:
 *
 *         failed-task | manual-intervention | confusing-ux |
 *         provider-failure | browser-env-failure | slow-path |
 *         recovery-defect | evidence-gap | upgrade-migration
 *
 *     `recovery` is REQUIRED on every friction line: '' when no
 *     recovery has happened (or none applies), and a non-empty account
 *     once the friction was recovered. A line with a non-empty
 *     `recovery` IS the log's "recovery row" (the G5 receipt reads
 *     them this way; documented in the README).
 *
 *   - timing rows for the slow-path measurement, exactly the mandated
 *     fields plus the discriminators, and (P2-FIX-117) the OPTIONAL
 *     wall-clock budget that governed the ask the row measures:
 *
 *         { "schema": "flauz.dogfood-friction/v1", "type": "timing",
 *           "ts": <epoch-ms>, "phase": "...", "durationMs": <number>,
 *           "wallClockBudgetMs": <number, optional> }
 *
 *     `wallClockBudgetMs` is present exactly on ask-measuring timing
 *     rows (the budget actually used, wired through the product's
 *     AdapterConfig.requestTimeoutMs surface); rows that measure
 *     driver-side work (no ask) carry no budget. Rows without the
 *     field (the pre-W2.1 shape, e.g. the banked W2 records) keep
 *     validating -- the field is additive and optional.
 *
 * The log is APPEND-ONLY: every call appends one line to the file and
 * never rewrites existing bytes. Every exercise run produces one log
 * file (the driver names them <exercise-id>.friction.jsonl under the
 * records dir). `ts` is the REAL wall clock (friction timing must be
 * real, not the seams' deterministic stepping clock).
 *
 * This module is a dogfood HARNESS module (build/flauz/dogfood/**), not
 * a gate instrument; it imports nothing from the repo -- plain node.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The pinned schema id (one per line, both row types). */
export const FRICTION_SCHEMA = 'flauz.dogfood-friction/v1';

/** The friction `kind` vocabulary -- the handoff capture list, verbatim order. */
export const FRICTION_KINDS = Object.freeze([
	'failed-task',
	'manual-intervention',
	'confusing-ux',
	'provider-failure',
	'browser-env-failure',
	'slow-path',
	'recovery-defect',
	'evidence-gap',
	'upgrade-migration',
]);

/** True when `value` is one of the fixed friction kinds. */
export function isFrictionKind(value) {
	return typeof value === 'string' && FRICTION_KINDS.includes(value);
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

function isNonNegativeFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validates one parsed log line (either row type) against the schema.
 * Returns { ok: true } or { ok: false, error } -- never throws.
 */
export function validateFrictionLine(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ok: false, error: 'line is not a JSON object' };
	}
	const row = value;
	if (row.schema !== FRICTION_SCHEMA) {
		return { ok: false, error: `schema is ${JSON.stringify(row.schema)} but ${JSON.stringify(FRICTION_SCHEMA)} was expected` };
	}
	if (row.type === 'friction') {
		if (!isNonNegativeFiniteNumber(row.ts)) {
			return { ok: false, error: 'friction row field "ts" must be a finite epoch-ms number >= 0' };
		}
		if (!isNonEmptyString(row.phase)) {
			return { ok: false, error: 'friction row field "phase" must be a non-empty string' };
		}
		if (!isFrictionKind(row.kind)) {
			return { ok: false, error: `friction row field "kind" must be one of ${FRICTION_KINDS.join('|')} (got ${JSON.stringify(row.kind)})` };
		}
		if (!isNonEmptyString(row.detail)) {
			return { ok: false, error: 'friction row field "detail" must be a non-empty string' };
		}
		if (typeof row.recovery !== 'string') {
			return { ok: false, error: 'friction row field "recovery" must be a string ("" when no recovery yet)' };
		}
		return { ok: true };
	}
	if (row.type === 'timing') {
		if (!isNonNegativeFiniteNumber(row.ts)) {
			return { ok: false, error: 'timing row field "ts" must be a finite epoch-ms number >= 0' };
		}
		if (!isNonEmptyString(row.phase)) {
			return { ok: false, error: 'timing row field "phase" must be a non-empty string' };
		}
		if (!isNonNegativeFiniteNumber(row.durationMs)) {
			return { ok: false, error: 'timing row field "durationMs" must be a finite number >= 0' };
		}
		if (row.wallClockBudgetMs !== undefined && !isPositiveFiniteNumber(row.wallClockBudgetMs)) {
			return { ok: false, error: 'timing row field "wallClockBudgetMs", when present, must be a finite number > 0' };
		}
		return { ok: true };
	}
	return { ok: false, error: `row "type" must be 'friction' or 'timing' (got ${JSON.stringify(row.type)})` };
}

/** Parses + validates a whole log file body; one { ok, error, rows } outcome. */
export function parseFrictionLog(text) {
	const rows = [];
	const lines = text.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.length === 0) {
			continue;
		}
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			return { ok: false, error: `line ${String(index + 1)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, rows };
		}
		const validation = validateFrictionLine(parsed);
		if (!validation.ok) {
			return { ok: false, error: `line ${String(index + 1)}: ${validation.error}`, rows };
		}
		rows.push(parsed);
	}
	return { ok: true, error: '', rows };
}

/**
 * The append-only friction log. Constructed per exercise run by the
 * driver; `friction()` and `timing()` append one JSON line each and
 * validate before writing (an invalid row THROWS -- the harness never
 * writes a line the schema would reject).
 */
export class FrictionLog {
	/**
	 * @param {{ path: string, appendFile?: (target: string, contents: string) => Promise<void>, readFile?: (target: string) => Promise<string>, clock?: () => number }} options
	 */
	constructor(options) {
		if (options === null || typeof options !== 'object' || typeof options.path !== 'string' || options.path.length === 0) {
			throw new Error('flauz.dogfood: FrictionLog requires { path }');
		}
		this.path = options.path;
		this.appendFile = options.appendFile ?? ((target, contents) => appendFile(target, contents, { encoding: 'utf-8' }));
		this.readFile = options.readFile ?? ((target) => readFile(target, { encoding: 'utf-8' }));
		this.clock = options.clock ?? (() => Date.now());
		this.lines = 0;
	}

	/** Appends one friction event row. `recovery` defaults to '' (no recovery yet). */
	async friction({ phase, kind, detail, recovery = '' }) {
		const row = { schema: FRICTION_SCHEMA, type: 'friction', ts: this.clock(), phase, kind, detail, recovery };
		const validation = validateFrictionLine(row);
		if (!validation.ok) {
			throw new Error(`flauz.dogfood: refusing to append an invalid friction row: ${validation.error}`);
		}
		await mkdir(dirname(this.path), { recursive: true });
		await this.appendFile(this.path, `${JSON.stringify(row)}\n`);
		this.lines += 1;
		return row;
	}

	/**
	 * Appends one timing row (the slow-path measurement). The
	 * OPTIONAL `wallClockBudgetMs` (P2-FIX-117) records the
	 * wall-clock budget that governed the ask this row measures;
	 * rows without an ask carry no budget.
	 */
	async timing({ phase, durationMs, wallClockBudgetMs }) {
		const row = { schema: FRICTION_SCHEMA, type: 'timing', ts: this.clock(), phase, durationMs, ...(wallClockBudgetMs !== undefined ? { wallClockBudgetMs } : {}) };
		const validation = validateFrictionLine(row);
		if (!validation.ok) {
			throw new Error(`flauz.dogfood: refusing to append an invalid timing row: ${validation.error}`);
		}
		await mkdir(dirname(this.path), { recursive: true });
		await this.appendFile(this.path, `${JSON.stringify(row)}\n`);
		this.lines += 1;
		return row;
	}

	/** Reads the whole log back (parsed + validated; throws on a corrupt line). */
	async readAll() {
		let text;
		try {
			text = await this.readFile(this.path);
		} catch (err) {
			if (err !== null && typeof err === 'object' && err.code === 'ENOENT') {
				return [];
			}
			throw err;
		}
		const outcome = parseFrictionLog(text);
		if (!outcome.ok) {
			throw new Error(`flauz.dogfood: friction log ${this.path} failed validation: ${outcome.error}`);
		}
		return outcome.rows;
	}
}
