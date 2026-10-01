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
 *
 * DL-81 / P2-FIX-109 — the cooperative cancellation port (this module):
 *
 *   `ExecutorOpContext` carries a cancellation port MINTED BY THE MANAGER
 *   per accepted attempt. The port is COOPERATIVE and CHECKPOINT-OBSERVED —
 *   never a preemptive kill: the executor consults it at its effect
 *   checkpoints (pre-spawn, post-spawn/pre-confirm, and — manager-side —
 *   between provider-retry rounds) and returns the typed CANCELLED effect
 *   result (`{ ok: false, error: { code: 'OP_CANCELLED', ... } }` carrying
 *   the structured, ephemeral `cancelledFacts`) instead of continuing the
 *   effect. At a POST-SPAWN checkpoint the executor performs its defensive
 *   reap BEFORE returning CANCELLED (no orphan child); a child spawned
 *   inside a checkpoint miss-window is covered by the superseding destroy's
 *   defensive reap. Simulated executors model the port deterministically.
 */
import type { EnvironmentDescriptor, EnvironmentKind } from '../api.ts';
import type { DescribeVerdict, ExecutorCancelledFacts, ExecutorEffectError, ExecutorEffectResult, ExecutorOpDetail, ProvenanceActor } from './types.ts';

/**
 * DL-81 — the cooperative cancellation port handed to one executor op
 * (minted by the manager per accepted attempt; `mintCancellationPort`).
 * `cancelled` flips to `true` when the manager mints a cancel (the
 * `cancel(id, actor)` API, or the destroy-supersede rule); the executor
 * observes it at its effect checkpoints — never a preemptive kill.
 */
export interface ExecutorCancellationPort {
	/** Checkpoint observation: `true` once a cancel was minted on this attempt. */
	readonly cancelled: boolean;
	/** The provenance of the cancel request, once one was minted (mandatory — the manager validates it at mint time). */
	readonly cancelledBy?: ProvenanceActor;
	/** Why the cancel was minted: 'cancel' (the explicit API) or 'destroy-supersede' (the DL-81 destroy-supersede rule). */
	readonly reason?: string;
}

/** The manager-side handle of one minted port (the cancel mint is manager-only). */
export interface CancellationPortMint {
	/** The read-only side the executor observes (`ctx.cancellation`). */
	readonly port: ExecutorCancellationPort;
	/** Mints the cooperative cancellation (idempotent; the executor observes it at its next effect checkpoint). */
	cancel(actor: ProvenanceActor, reason: string): void;
}

/** Mints one cooperative cancellation port (the manager calls this per accepted attempt; drills reuse it for direct executor calls). */
export function mintCancellationPort(): CancellationPortMint {
	let cancelled = false;
	let cancelledBy: ProvenanceActor | undefined;
	let reason: string | undefined;
	const port: ExecutorCancellationPort = {
		get cancelled() {
			return cancelled;
		},
		get cancelledBy() {
			return cancelledBy;
		},
		get reason() {
			return reason;
		},
	};
	return {
		port,
		cancel: (actor, why) => {
			if (cancelled) {
				return; // idempotent — the first mint's provenance holds
			}
			cancelled = true;
			cancelledBy = actor;
			reason = why;
		},
	};
}

/** The cooperative-port observation tick: fast enough for drills, cheap enough for production. */
export const CANCELLATION_POLL_MS = 10;

/**
 * DL-81 — watches the cooperative cancellation port until a cancel is
 * observed (polling at `CANCELLATION_POLL_MS`). `dispose()` MUST be called
 * when the raced work settles first — a disposed watcher clears its
 * interval, so no event-loop handle leaks.
 */
export function watchCancellation(port: ExecutorCancellationPort): { readonly promise: Promise<void>; dispose(): void } {
	let timer: ReturnType<typeof setInterval> | undefined;
	let done = false;
	const stop = () => {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
	};
	const promise = new Promise<void>(resolve => {
		const poll = () => {
			if (done || !port.cancelled) {
				return;
			}
			done = true;
			stop();
			resolve();
		};
		poll(); // immediate first observation — a pre-armed cancel wins instantly
		if (!done) {
			timer = setInterval(poll, CANCELLATION_POLL_MS);
		}
	});
	return {
		promise,
		dispose: () => {
			done = true;
			stop();
		},
	};
}

/**
 * DL-81 — the typed CANCELLED effect error (the message grammar the ledger
 * records): `cancelled at checkpoint '<checkpoint>' by actor '<cancelledBy>'
 * (<reason>): partial effects — <partialEffects>`. The structured,
 * ephemeral `cancelledFacts` ride alongside (never persisted).
 */
export function cancelledEffectError(port: ExecutorCancellationPort, checkpoint: string, partialEffects: string): ExecutorEffectError {
	// a minted cancel always carries validated provenance (the manager's
	// requireActor law — the only writers are cancel()/the destroy-supersede)
	const cancelledBy = port.cancelledBy ?? 'unknown';
	const reason = port.reason ?? 'cancel';
	return {
		code: 'OP_CANCELLED',
		message: `cancelled at checkpoint '${checkpoint}' by actor '${cancelledBy}' (${reason}): partial effects — ${partialEffects}`,
		cancelledFacts: { checkpoint, cancelledBy: port.cancelledBy as ProvenanceActor, partialEffects },
	};
}

/** DL-81 — the typed CANCELLED effect result (the two-armed envelope, unchanged shape). */
export function cancelledEffect(port: ExecutorCancellationPort, checkpoint: string, partialEffects: string): ExecutorEffectResult {
	return { ok: false, error: cancelledEffectError(port, checkpoint, partialEffects) };
}

/**
 * DL-81 — the effect-checkpoint observation: consults the cooperative
 * cancellation port and returns the typed CANCELLED effect result when a
 * cancel was minted (else `undefined` — continue the effect). NEVER a
 * preemptive kill: at a POST-SPAWN checkpoint the CALLER performs its own
 * defensive reap BEFORE surfacing the returned result (no orphan child).
 */
export function observeCancellation(ctx: ExecutorOpContext, checkpoint: string, partialEffects: string): ExecutorEffectResult | undefined {
	if (!ctx.cancellation.cancelled) {
		return undefined;
	}
	return cancelledEffect(ctx.cancellation, checkpoint, partialEffects);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * DL-81 — structural read of the cancellation facts a failed effect carries:
 * `error.code === 'OP_CANCELLED'` plus a well-formed structured
 * `cancelledFacts` payload. Returns null for anything else — a malformed or
 * absent payload is NEVER treated as a cancellation (fail-closed, the
 * readProviderRetryHint posture: the manager records a plain error row).
 */
export function readCancellationFacts(error: ExecutorEffectError | undefined): ExecutorCancelledFacts | null {
	if (error === undefined || error.code !== 'OP_CANCELLED' || !isPlainObject(error.cancelledFacts)) {
		return null;
	}
	const facts = error.cancelledFacts;
	if (typeof facts.checkpoint !== 'string' || facts.checkpoint.length === 0) {
		return null;
	}
	if (facts.cancelledBy !== 'agent' && facts.cancelledBy !== 'human' && facts.cancelledBy !== 'tool') {
		return null;
	}
	if (typeof facts.partialEffects !== 'string' || facts.partialEffects.length === 0) {
		return null;
	}
	return { checkpoint: facts.checkpoint, cancelledBy: facts.cancelledBy, partialEffects: facts.partialEffects };
}

/** Context handed to one executor op (provenance + deterministic time + the DL-81 cancellation port). */
export interface ExecutorOpContext {
	readonly actor: ProvenanceActor;
	readonly now: number;
	/**
	 * DL-81 / P2-FIX-109 — the cooperative cancellation port minted by
	 * the manager for THIS accepted attempt. The executor consults it at
	 * its effect checkpoints (pre-spawn, post-spawn/pre-confirm) and
	 * returns the typed CANCELLED effect result instead of continuing.
	 */
	readonly cancellation: ExecutorCancellationPort;
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
