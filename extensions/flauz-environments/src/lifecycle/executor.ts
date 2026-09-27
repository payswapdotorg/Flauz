/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the executor contract (3.1).
 *
 * An `EnvironmentExecutor` performs the REAL side effects of one lifecycle op
 * for the kinds it serves (local process, simulated remote, or a future real
 * provider — TL3-004). The executor NEVER touches the lifecycle state
 * machine or the PIN-2 files: the `EnvironmentLifecycleManager`
 * (manager.ts) owns state, transitions, provenance and the ledger, and calls
 * the executor for the effect only. That separation is what keeps the state
 * machine pure and testable while the executors stay honestly classed:
 *
 *   - `infrastructureClass: 'real'`     — real local effects (LocalProcessExecutor:
 *                                          real node processes, real fs snapshots).
 *   - `infrastructureClass: 'simulated'`— TEST INFRASTRUCTURE, NOT PRODUCTION CODE
 *                                          (deterministic remote-kinds drills; no live
 *                                          connections — the connection PLAN stays the
 *                                          artifact for real providers, TL3-004).
 *
 * Every op returns a typed `ExecutorEffectResult` (never a raw throw). The
 * trust-posture fail-closed gate (start/attach on `untrusted`) lives in the
 * MANAGER so one enforcement point covers every executor (pinned by tests).
 */
import type { EnvironmentDescriptor, EnvironmentKind } from '../api.ts';
import type { DescribeVerdict, ExecutorEffectResult, ExecutorOpDetail, ProvenanceActor } from './types.ts';

/** Context handed to one executor op (provenance + deterministic time). */
export interface ExecutorOpContext {
	readonly actor: ProvenanceActor;
	readonly now: number;
}

/** The executor port: typed lifecycle effects + the describe probe. */
export interface EnvironmentExecutor {
	/** Stable id persisted in lifecycle entries (`executorKind`). */
	readonly executorKind: string;
	/** Honesty label: 'real' local effects vs TEST INFRASTRUCTURE simulation. */
	readonly infrastructureClass: 'real' | 'simulated';
	/** The environment kinds this executor serves. */
	readonly kinds: readonly EnvironmentKind[];
	/** Allocates the environment's backing state (state dir / sim record). */
	create(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Brings the backing truth up (spawn / sim-running). */
	start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Graceful teardown of the backing truth (terminate + reap). */
	stop(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Mints a logical connection lease (REAL state transition, no process effect). */
	attach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Releases the connection lease. */
	detach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Real fs snapshot of the per-environment state dir + manifest. */
	snapshot(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/** Terminal teardown (removes the backing truth; reaps defensively). */
	destroy(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult>;
	/**
	 * Health/state probe (the `describe` backing-truth check): NEVER reports
	 * healthy when the persisted state outruns the truth (crash
	 * reconciliation => `stale`; pid alive but not ours => `orphan`).
         */
	probe(descriptor: EnvironmentDescriptor): Promise<DescribeVerdict>;
}

/** Type-only helper so consumers can name the detail payload of an executor op. */
export type { ExecutorOpDetail };
