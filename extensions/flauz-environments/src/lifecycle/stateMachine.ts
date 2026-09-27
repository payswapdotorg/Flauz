/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the lifecycle state machine.
 *
 * Typed states:
 *   registered -> created -> starting -> running <-> stopping -> stopped -> destroyed
 *   (+ failed with an error record; + the attach/detach connection substate on
 *   running/stopped, carried as the `/attached` composite).
 *
 * Illegal transitions are TYPED ERRORS, never silent: `transitionFor` throws
 * `EnvironmentLifecycleError` with code `ILLEGAL_TRANSITION` naming the legal
 * ops from the current state. The table below is the single source of truth
 * for the manager; nothing mutates lifecycle state outside it.
 *
 * Transition policy (documented for the report/README):
 *   - create   : registered -> created (mints the lifecycle entry).
 *   - start    : created | stopped | failed -> running (transient `starting`
 *                is persisted first, so a crash mid-start reconciles as
 *                stale). Attach-substate must be released before a restart.
 *   - stop     : running | running/attached | starting -> stopped (a held
 *                lease is released by the stop; transient `stopping`).
 *   - attach   : running | stopped -> running/attached | stopped/attached.
 *   - detach   : the attached composites -> the base phase.
 *   - snapshot : state-preserving (fromState == toState); legal from any
 *                provisioned phase except destroyed.
 *   - destroy  : created | stopping | stopped | stopped/attached | failed ->
 *                destroyed (terminal). A live running environment must be
 *                STOPPED first — predictable teardown (premium-ux discipline);
 *                the local executor still reaps defensively at destroy.
 */
import { ATTACHED_STATES, LIFECYCLE_PHASES, isAttachedState, phaseOf, type EnvironmentLifecycleError, type EnvironmentOpName, type LifecyclePhase, EnvironmentLifecycleError as LifecycleError } from './types.ts';


/** A legal transition rule of the lifecycle machine. */
export interface LifecycleTransitionRule {
	readonly op: EnvironmentOpName;
	/** Full states (incl. `/attached` composites) the op is legal FROM. */
	readonly from: readonly string[];
	/** The phase the op moves TO (snapshots keep the current state). */
	readonly toPhase: LifecyclePhase | 'same';
	/** Transient phase persisted BEFORE the effect (start/stop only). */
	readonly transientPhase?: LifecyclePhase;
	/** Ops whose executor failure lands the environment in `failed`. */
	readonly failsTo: LifecyclePhase | 'same';
}

/** All legal transition rules (single source of truth). */
export const LIFECYCLE_TRANSITIONS: readonly LifecycleTransitionRule[] = [
	{ op: 'create', from: ['registered'], toPhase: 'created', failsTo: 'same' },
	{ op: 'start', from: ['created', 'stopped', 'failed'], toPhase: 'running', transientPhase: 'starting', failsTo: 'failed' },
	{ op: 'stop', from: ['running', 'running/attached', 'starting'], toPhase: 'stopped', transientPhase: 'stopping', failsTo: 'failed' },
	{ op: 'attach', from: ['running', 'stopped'], toPhase: 'same', failsTo: 'same' },
	{ op: 'detach', from: ['running/attached', 'stopped/attached'], toPhase: 'same', failsTo: 'same' },
	{ op: 'snapshot', from: ['created', 'running', 'running/attached', 'stopped', 'stopped/attached', 'failed'], toPhase: 'same', failsTo: 'same' },
	{ op: 'destroy', from: ['created', 'stopping', 'stopped', 'stopped/attached', 'failed'], toPhase: 'destroyed', failsTo: 'same' },
];

const RULES_BY_OP: ReadonlyMap<EnvironmentOpName, LifecycleTransitionRule> = new Map(LIFECYCLE_TRANSITIONS.map(rule => [rule.op, rule]));

/** Every full state string the machine can persist (phases + composites). */
export const LIFECYCLE_STATES: readonly string[] = [...LIFECYCLE_PHASES, ...ATTACHED_STATES];

/** Validates a full state string (phase or phase/attached composite). */
export function isLifecycleState(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	return LIFECYCLE_STATES.includes(value);
}

/** The rule for an op, or undefined (unknown op — a typed error upstream). */
export function transitionRule(op: EnvironmentOpName): LifecycleTransitionRule | undefined {
	return RULES_BY_OP.get(op);
}

/** Is `op` legal from the full state `state`? */
export function canTransition(state: string, op: EnvironmentOpName): boolean {
	const rule = RULES_BY_OP.get(op);
	return rule !== undefined && rule.from.includes(state);
}

/** Legal ops from a full state (error messages + docs). */
export function legalOpsFrom(state: string): readonly EnvironmentOpName[] {
	return LIFECYCLE_TRANSITIONS.filter(rule => rule.from.includes(state)).map(rule => rule.op);
}

/**
 * Resolves the transition for `op` from the full state `state`. Illegal
 * transitions THROW a typed error naming the state and the legal ops — never
 * silent, never a best-effort fallback.
 */
export function transitionFor(state: string, op: EnvironmentOpName): LifecycleTransitionRule {
	const rule = RULES_BY_OP.get(op);
	const legal = legalOpsFrom(state);
	if (rule === undefined || !rule.from.includes(state)) {
		throw new LifecycleError('ILLEGAL_TRANSITION', `op '${op}' is illegal from state '${state}' (legal ops: ${legal.join(', ') || 'none'})`);
	}
	return rule;
}

/**
 * The full TO-state for a successful `op` from `state`:
 *   - attach   -> `${phase}/attached`
 *   - detach   -> the base phase
 *   - stop     -> `stopped` (any held lease is released by the transition)
 *   - snapshot -> unchanged
 */
export function successState(state: string, op: EnvironmentOpName): string {
	const rule = transitionFor(state, op);
	if (op === 'attach') {
		return `${phaseOf(state)}/attached`;
	}
	if (op === 'detach') {
		return phaseOf(state);
	}
	return rule.toPhase === 'same' ? state : rule.toPhase;
}

/**
 * The full TO-state when `op` FAILS at the executor (post-acceptance):
 * start/stop land in `failed` (with the error record); every other op leaves
 * the state unchanged (the rejection is ledger-recorded, the state is not
 * corrupted by a failed attempt).
 */
export function failureState(state: string, op: EnvironmentOpName): string {
	const rule = transitionFor(state, op);
	if (rule.failsTo === 'failed') {
		return 'failed';
	}
	return state;
}

/** The transient phase persisted before the effect, when one applies. */
export function transientPhase(state: string, op: EnvironmentOpName): LifecyclePhase | undefined {
	const rule = transitionFor(state, op);
	return rule.transientPhase;
}

/** type-only re-export (keeps the error type importable from this module). */
export type { EnvironmentLifecycleError };
