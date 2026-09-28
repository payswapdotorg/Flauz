/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Performance marks for the Flauz Agent Bridge.
 *
 * PERF-PLAN section 6.2: only marks with the `code/` prefix are aggregated by the
 * timer service (timerService.ts:617-623 aggregates code/* only). The
 * extension host forwards `performance.mark` calls to the renderer
 * (extHostExtensionService.ts:647-649), so plain `performance.mark()` is the
 * correct emission surface.
 *
 * Mark set (W3-F, PERFORMANCE-PLAN section 2.2):
 *   code/flauz/willConnectCore      code/flauz/didConnectCore
 *   code/flauz/willRegisterParticipants   code/flauz/didRegisterParticipants
 *   code/flauz/willWarmModels       code/flauz/didWarmModels
 *
 * 2026-09-26 integration addendum (first-CI run, PERF section 1.3 row 5): the
 * activation pair willActivateBridge/didActivateBridge is budgeted by the
 * startup-pair gate (build/flauz/scripts/startup-pair.mjs) — added here so
 * every budgeted mark has an emit site (PERF section 6.3/R6).
 *
 * TL4-H1 mark TAP (2026-09-28, the R6 drift closure): the marks emitted here
 * NEVER reach the renderer's timer service, because the ext-host -> renderer
 * relay is a one-time snapshot taken BEFORE this extension activates:
 * `_activateAllStartupFinished()` (src/vs/workbench/api/common/
 * extHostExtensionService.ts:647-663) calls
 * `$setPerformanceMarks(performance.getMarks())` at the TOP of the method and
 * only then iterates the onStartupFinished activation events — flauz-agent
 * (an onStartupFinished extension) emits every mark after the snapshot was
 * already relayed. That is the root cause of the flauz-perf startup-pair R6
 * drift (the three budgeted flauz pairs absent from every
 * --prof-duration-markers TSV run). src/vs is fork-critical and stays
 * pristine (DL-12), so the closure is an OBSERVATIONAL TAP inside this
 * module: when FLAUZ_PERF_MARKS_FILE is set, mark() appends one line
 * `<markName>\t<performance.now()>` to that file. The tap is fail-open (an
 * observability probe must never break activation: any tap error is
 * swallowed), performs ZERO I/O when the env is unset, and uses the
 * extension host's own performance.now() clock — both marks of a pair are
 * read from the same process clock, so pair durations (did.now - will.now,
 * parsed by build/flauz/scripts/perf-log-parse.mjs --parse-tap and asserted
 * by startup-pair.mjs --tap-flauz) carry no cross-process clock skew.
 */

import * as fs from 'node:fs';

export const FLAUZ_MARK_PREFIX = 'code/flauz/';

/** Env var that turns the mark tap on (set per-run by the flauz-perf boot lane). */
export const FLAUZ_PERF_MARKS_FILE_ENV = 'FLAUZ_PERF_MARKS_FILE';

const tapFilePath = process.env[FLAUZ_PERF_MARKS_FILE_ENV] ?? '';

export const FlauzMarks = {
	willConnectCore: `${FLAUZ_MARK_PREFIX}willConnectCore`,
	didConnectCore: `${FLAUZ_MARK_PREFIX}didConnectCore`,
	willRegisterParticipants: `${FLAUZ_MARK_PREFIX}willRegisterParticipants`,
	didRegisterParticipants: `${FLAUZ_MARK_PREFIX}didRegisterParticipants`,
	willWarmModels: `${FLAUZ_MARK_PREFIX}willWarmModels`,
	didWarmModels: `${FLAUZ_MARK_PREFIX}didWarmModels`,
	willActivateBridge: `${FLAUZ_MARK_PREFIX}willActivateBridge`,
	didActivateBridge: `${FLAUZ_MARK_PREFIX}didActivateBridge`,
} as const;

export type FlauzMarkName = (typeof FlauzMarks)[keyof typeof FlauzMarks];

/** Emit a perf mark; safe when `performance` is missing (defensive, no throw). */
export function mark(name: FlauzMarkName | string): void {
	const performanceApi = (globalThis as { performance?: { mark?(name: string): void; now?(): number } }).performance;
	performanceApi?.mark?.(name);
	// TL4-H1 tap: env-gated (empty path = zero I/O), fail-open (never throws —
	// an observability probe must not be able to break activation).
	if (tapFilePath !== '' && performanceApi?.now !== undefined) {
		try {
			fs.appendFileSync(tapFilePath, `${name}\t${performanceApi.now().toString()}\n`);
		} catch {
			// Intentionally swallowed: see the module header (fail-open tap).
		}
	}
}
