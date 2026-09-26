/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Performance marks for the Flauz Browser Policy extension.
 *
 * PERF-PLAN section 6.2: only `code/`-prefixed marks are aggregated by the
 * timer service (timerService.ts:617-623 aggregates code/* only). The
 * extension host forwards `performance.mark` calls to the renderer, so plain
 * `performance.mark()` is the emission surface (same discipline as the Agent
 * Bridge's src/marks.ts, Wave 3 Lane F).
 *
 * Mark set (W4-I):
 *   code/flauz/willActivateBrowserPolicy  code/flauz/didActivateBrowserPolicy
 *
 * These are inert until a startup-pair pairs-file row budgets them (the
 * pairs file is Lane H's surface -- adding a row there is an integration
 * note in this lane's REPORT, not an edit).
 */

export const FLAUZ_MARK_PREFIX = 'code/flauz/';

export const FlauzBrowserMarks = {
	willActivateBrowserPolicy: `${FLAUZ_MARK_PREFIX}willActivateBrowserPolicy`,
	didActivateBrowserPolicy: `${FLAUZ_MARK_PREFIX}didActivateBrowserPolicy`,
} as const;

export type FlauzBrowserMarkName = (typeof FlauzBrowserMarks)[keyof typeof FlauzBrowserMarks];

/** Emit a perf mark; safe when `performance` is missing (defensive, no throw). */
export function mark(name: FlauzBrowserMarkName | string): void {
	const performanceApi = (globalThis as { performance?: { mark?(name: string): void } }).performance;
	performanceApi?.mark?.(name);
}
