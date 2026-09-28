/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M2 - the resource acquisition/release contract at TASK level.
 *
 * The ExecutionResourceManager binds acquisitions to DURABLE TASK STEPS:
 *
 *   acquire  - a step (running, per the orchestration journal) acquires a
 *              resource through an injected ResourceOpenerPort (M3 wires
 *              the real TL3 adapters behind it); the acquisition is
 *              journaled with the step binding (graphId/stepId/attempt/
 *              idempotencyKey) and, when requested, a TASK-STEP LEASE taken
 *              through the orchestration store's acquireLease (the L-NNN-
 *              NN-N reference is recorded on the resource-acquired row).
 *   release  - on completion, rollback, expiry or revocation; every path
 *              journals a resource-released row with the releaseKind.
 *   sweep    - the expiry pass: acquisitions whose lease has expired are
 *              expired by the SERVICE actor (mirrors the orchestration
 *              recovery's lease-expired pass).
 *   rollback - the graph-level sweep: every held acquisition of a graph is
 *              released (rollback kind) and a rollback-recorded aggregate
 *              row certifies the coherent end state (no held acquisitions
 *              remain).
 *
 * Failure taxonomy (typed task-level failures): acquire denials are
 * fail-closed records (acquire-denied rows) mapped to the TERMINAL
 * orchestration class policy-violation - the manager NEVER retries a
 * denial and never hides one behind an optimistic re-open; retry decisions
 * belong to the graph's retry policy over the retryable classes
 * (resource-lost/executor-death/acquire-timeout).
 *
 * Pure orchestration logic; the only effects are journal appends (through
 * the ExecJournalStore) and the injected ports.
 */

import {
	ExecError,
	type ExecFailure,
	type ExecutionRequest,
	type ExecutionResourceRef,
	type SurfaceSnapshot,
	canonicalJson,
	execSha256Hex,
	validateExecutionRequest,
} from './contracts.ts';
import { ExecJournalStore, type AcquisitionProjection } from './journal.ts';

// ---------------------------------------------------------------------------
// Ports (structurally satisfied by the real orchestration store + the M3
// adapters; mock drivers in the M2 suite)
// ---------------------------------------------------------------------------

/** The orchestration-side state the acquisition contract needs. */
export interface GraphStatePort {
	/** The effective status of a step ('unknown-graph'/'unknown-step' when absent). */
	stepStatus(graphId: string, stepId: string): string;
	/** Takes a task-step lease through the orchestration journal (L-NNN-NN-N). */
	acquireStepLease(input: { graphId: string; stepId: string; holder: string; ttlMs: number }): Promise<{ leaseId: string; expiresAt: number }> | { leaseId: string; expiresAt: number };
	/** The ACTIVE step lease, when one exists (the orch law: one active lease per step - retries REUSE it). */
	activeStepLease(graphId: string, stepId: string): { leaseId: string; expiresAt: number; holder: string } | null;
}

/** The resource-specific opener (M3 adapters; mock drivers in tests). */
export interface ResourceOpenerPort {
	/**
	 * Opens the resource: resolves/creates the access surface. On success it
	 * returns the FINAL ExecutionResourceRef (the given one, or the one minted
	 * for a fresh open) plus the surface snapshot recorded at hand-off.
	 */
	open(request: ExecutionRequest, binding: StepBinding): Promise<{ ok: true; resource: ExecutionResourceRef; surface: SurfaceSnapshot } | { ok: false; failure: ExecFailure }>;
}

/** The step binding every acquisition carries (the durable-task linkage). */
export interface StepBinding {
	readonly graphId: string;
	readonly stepId: string;
	readonly attempt: number;
	readonly idempotencyKey: string;
	/** The agent id holding the lease (the orchestration runner). */
	readonly runnerId: string;
	readonly actor?: 'agent' | 'tool' | 'service';
	readonly origin: string;
}

// ---------------------------------------------------------------------------
// Typed outcomes (never raw throws on the denial paths)
// ---------------------------------------------------------------------------

export type AcquireOutcome =
	| { readonly ok: true; readonly acquisition: AcquisitionProjection; readonly replayed: boolean }
	| { readonly ok: false; readonly failure: ExecFailure; readonly deniedRowId: string };

export type ReleaseOutcome =
	| { readonly ok: true; readonly acquisitionId: string; readonly state: string }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface SweepReport {
	readonly expired: readonly string[];
	readonly sweptAt: number;
}

export interface RollbackReport {
	readonly cause: string;
	readonly released: readonly string[];
	readonly coherent: boolean;
	readonly rollbackRowId: string;
}

export interface ExecutionResourceManagerOptions {
	readonly journal: ExecJournalStore;
	readonly graph: GraphStatePort;
	readonly opener: ResourceOpenerPort;
	readonly clock?: () => number;
}

/** Lease reference as journaled (the orchestration lease id + expiry). */
export interface LeaseRef {
	readonly leaseId: string;
	readonly holder: string;
	readonly expiresAt: number;
}

// ---------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------

export class ExecutionResourceManager {
	private readonly journal: ExecJournalStore;
	private readonly graph: GraphStatePort;
	private readonly opener: ResourceOpenerPort;
	private readonly clock: () => number;

	constructor(options: ExecutionResourceManagerOptions) {
		this.journal = options.journal;
		this.graph = options.graph;
		this.opener = options.opener;
		this.clock = options.clock ?? (() => Date.now());
	}

	// ---------------------------------------------------------------------------
	// Acquire (the denial paths are typed, journaled, fail-closed)
	// ---------------------------------------------------------------------------

	async acquire(request: unknown, binding: StepBinding): Promise<AcquireOutcome> {
		const acquisitionId = this.acquisitionIdFor(binding);
		const deny = (failure: ExecFailure): AcquireOutcome => {
			const row = this.journal.appendRow('acquire-denied', {
				graphId: binding.graphId,
				stepId: binding.stepId,
				attempt: binding.attempt,
				idempotencyKey: binding.idempotencyKey,
				acquisitionId,
				actor: binding.actor ?? 'agent',
				origin: binding.origin,
				payload: {
					gate: failure.gate ?? 'invalid-request',
					failureClass: 'acquire-denied',
					message: failure.message,
					...((request as { resource?: unknown } | null)?.resource !== undefined ? { resource: (request as { resource: unknown }).resource } : {}),
					...(failure.verdictDigest !== undefined ? { verdictDigest: failure.verdictDigest } : {}),
				},
			});
			return { ok: false, failure, deniedRowId: row.rowId };
		};

		// 1. the request parse (fail-closed, typed)
		const verdict = validateExecutionRequest(request);
		if (!verdict.ok) {
			return deny({ failureClass: 'invalid-request', gate: 'invalid-request', message: verdict.error });
		}

		// 2. the graph-state gate: only a RUNNING step may hold resources.
		const status = this.graph.stepStatus(binding.graphId, binding.stepId);
		if (status !== 'running') {
			return deny({ failureClass: 'acquire-denied', gate: 'graph-state', message: `step ${binding.graphId}/${binding.stepId} is '${status}' (only a running step may acquire execution resources)` });
		}

		// 3. idempotent acquire: the journal is the substrate (a completed
		//    acquire for this key + resource replays as the same acquisition).
		const existing = this.journal.acquisitionRowsForKey(binding.idempotencyKey).find((row) => row.type === 'resource-acquired' && (verdict.request.resource === undefined || (row.payload as Record<string, unknown>)['resource'] !== undefined));
		if (existing !== undefined && existing.acquisitionId !== null) {
			const projection = this.journal.acquisitionOf(existing.acquisitionId);
			if (projection.state === 'acquired') {
				return { ok: true, acquisition: projection, replayed: true };
			}
		}

		// 4. the task-step lease (through the orchestration journal). The
		//    orch law allows ONE ACTIVE LEASE PER STEP: a retry attempt of the
		//    same step REUSES the active lease (no double-leasing).
		let lease: LeaseRef | undefined;
		if (verdict.request.leaseTtlMs !== undefined) {
			const active = this.graph.activeStepLease(binding.graphId, binding.stepId);
			if (active !== null && active.holder === binding.runnerId) {
				lease = { leaseId: active.leaseId, holder: active.holder, expiresAt: active.expiresAt };
			} else {
				const acquired = await this.graph.acquireStepLease({ graphId: binding.graphId, stepId: binding.stepId, holder: binding.runnerId, ttlMs: verdict.request.leaseTtlMs });
				lease = { leaseId: acquired.leaseId, holder: binding.runnerId, expiresAt: acquired.expiresAt };
			}
		}

		// 5. the opener (the real TL3 adapter or the mock driver).
		const opened = await this.opener.open(verdict.request, binding);
		if (!opened.ok) {
			return deny(opened.failure);
		}

		// 6. journal the acquisition + the hand-off (the surface at
		//    execution time; IDENTITY IS NOT ACCESS - the snapshot is the
		//    recorded access truth).
		this.journal.appendRow('resource-acquired', {
			graphId: binding.graphId,
			stepId: binding.stepId,
			attempt: binding.attempt,
			idempotencyKey: binding.idempotencyKey,
			acquisitionId,
			actor: binding.actor ?? 'agent',
			origin: binding.origin,
			payload: {
				purpose: verdict.request.purpose ?? binding.idempotencyKey,
				resource: opened.resource,
				...(lease !== undefined ? { lease } : {}),
			},
		});
		const surfaceDigest = execSha256Hex(canonicalJson(opened.surface));
		this.journal.appendRow('handoff-recorded', {
			graphId: binding.graphId,
			stepId: binding.stepId,
			attempt: binding.attempt,
			idempotencyKey: binding.idempotencyKey,
			acquisitionId,
			actor: 'tool',
			origin: `${binding.origin}:handoff`,
			payload: { surface: opened.surface, surfaceDigest },
		});
		return { ok: true, acquisition: this.journal.acquisitionOf(acquisitionId), replayed: false };
	}

	// ---------------------------------------------------------------------------
	// Release (completion | rollback | revocation; expiry is the sweep)
	// ---------------------------------------------------------------------------

	async release(input: { acquisitionId: string; releaseKind: 'completion' | 'rollback' | 'revocation'; actor: 'human' | 'agent' | 'tool' | 'service'; origin: string; note?: string }): Promise<ReleaseOutcome> {
		const projection = this.journal.acquisitions().get(input.acquisitionId);
		if (projection === undefined) {
			return { ok: false, error: { code: 'EXEC_ACQUISITION_UNKNOWN', message: `unknown acquisition ${input.acquisitionId}` } };
		}
		if (projection.state !== 'acquired' && projection.state !== 'lost') {
			return { ok: false, error: { code: 'EXEC_ACQUISITION_STATE', message: `acquisition ${input.acquisitionId} is '${projection.state}' (releasable states: acquired | lost)` } };
		}
		this.journal.appendRow('resource-released', {
			graphId: projection.graphId,
			stepId: projection.stepId,
			attempt: projection.attempt,
			idempotencyKey: null,
			acquisitionId: input.acquisitionId,
			actor: input.actor,
			origin: input.origin,
			payload: { releaseKind: input.releaseKind, ...(input.note !== undefined ? { note: input.note } : {}) },
		});
		return { ok: true, acquisitionId: input.acquisitionId, state: 'released' };
	}

	/** Releases every held acquisition of one graph (rollback path) + the coherence record. */
	async rollbackGraph(input: { graphId: string; cause: string; origin: string; actor?: 'human' | 'agent' | 'tool' | 'service' }): Promise<RollbackReport> {
		const actor = input.actor ?? 'service';
		const held = this.journal.heldAcquisitions({ graphId: input.graphId });
		const released: string[] = [];
		for (const acquisition of held) {
			const outcome = await this.release({ acquisitionId: acquisition.acquisitionId, releaseKind: 'rollback', actor, origin: `${input.origin}:rollback` });
			if (outcome.ok) {
				released.push(outcome.acquisitionId);
			}
		}
		const coherent = this.journal.heldAcquisitions({ graphId: input.graphId }).length === 0;
		const row = this.journal.appendRow('rollback-recorded', {
			graphId: input.graphId,
			actor,
			origin: input.origin,
			payload: { cause: input.cause, releasedAcquisitionIds: released, coherent },
		});
		if (!coherent) {
			throw new ExecError('EXEC_ACQUISITION_STATE', `rollback of graph ${input.graphId} left held acquisitions behind (incoherent)`);
		}
		return { cause: input.cause, released, coherent, rollbackRowId: row.rowId };
	}

	// ---------------------------------------------------------------------------
	// Expiry sweep (the SERVICE actor; mirrors recovery's lease-expired)
	// ---------------------------------------------------------------------------

	sweepExpirations(now?: number): SweepReport {
		const at = now ?? this.clock();
		const expired: string[] = [];
		for (const acquisition of this.journal.heldAcquisitions()) {
			if (acquisition.lease !== null && acquisition.lease.expiresAt <= at) {
				this.journal.appendRow('resource-expired', {
					graphId: acquisition.graphId,
					stepId: acquisition.stepId,
					attempt: acquisition.attempt,
					idempotencyKey: null,
					acquisitionId: acquisition.acquisitionId,
					actor: 'service',
					origin: 'exec:sweep:expiry',
					payload: { expiresAt: acquisition.lease.expiresAt, expiredAt: at },
				});
				expired.push(acquisition.acquisitionId);
			}
		}
		return { expired, sweptAt: at };
	}

	// ---------------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------------

	/** The acquisition id for a binding: reuses a prior DENIAL's id (the next attempt); mints otherwise. */
	private acquisitionIdFor(binding: StepBinding): string {
		const denied = this.journal.acquisitionRowsForKey(binding.idempotencyKey).find((row) => row.type === 'acquire-denied' && row.acquisitionId !== null);
		if (denied !== undefined && denied.acquisitionId !== null) {
			return denied.acquisitionId;
		}
		return this.journal.mintAcquisitionId();
	}
}
