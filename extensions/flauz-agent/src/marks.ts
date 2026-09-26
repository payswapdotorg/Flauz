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
 */

export const FLAUZ_MARK_PREFIX = 'code/flauz/';

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
	const performanceApi = (globalThis as { performance?: { mark?(name: string): void } }).performance;
	performanceApi?.mark?.(name);
}
