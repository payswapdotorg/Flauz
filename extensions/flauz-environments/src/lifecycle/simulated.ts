/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * SimulatedRemoteExecutor — deterministic remote-environment simulator.
 *
 * *** TEST INFRASTRUCTURE — NOT PRODUCTION CODE. *** (Styled after
 * flauz-browser's FakeCdpTransport.) It models the remote kinds
 * (ssh-local / container / cloud-sandbox) for lifecycle drills with NO live
 * connections: deterministic, file-backed state (shareable across executor
 * instances — recovery drills construct a fresh executor over the same state
 * file), injectable latency and failure cues. It makes NO claim about real
 * remote behavior beyond the shapes asserted here — the connection PLAN
 * (src/providers/) remains the artifact for real providers, which land in
 * TL3-004 behind the `resolvers` grant (DL-33: the grant stays absent until
 * real resolver code exists).
 *
 * Simulation model:
 *   - Backing truth = `<root>/.flauz/env-sim/<envId>.json`
 *     (`flauz.env-sim/v0`): `{running, startedAt, beat, lease?, snapshots}`.
 *     The file is the SHARED truth: a second executor instance (or a fresh
 *     process after a "crash") sees the same environment state — exactly
 *     what recovery drills need.
 *   - `latencyMs`: injected per-op latency (default 0 — tests stay fast and
 *     deterministic; drills bump it to simulate remote round-trips).
 *   - `cues`: failure cues keyed by op — a queued `{op, code, message}`
 *     consumes on the next matching call and FAILS that op (deterministic
 *     failure-path drills). `simulateCrash()` marks the sim file gone while
 *     the lifecycle state still claims running (crash-reconciliation drills).
 *   - Ops move the sim file the way a real provider would move its remote
 *     truth; attach/detach mint logical leases recorded in the sim state
 *     (id + held-since — the lease a real provider would hand back).
 *
 * DL-81 / P2-FIX-109 — the port is modeled DETERMINISTICALLY: every op
 * consults the cooperative cancellation port at its pre-spawn effect
 * checkpoint (after the injected latency, BEFORE the effect commits its
 * sim-state save). A cancel minted while the op is inside its latency window
 * is therefore always observed — the cancelled op leaves the sim truth
 * untouched (no fabricated running state) and returns the typed OP_CANCELLED
 * effect with the structured partial-effect facts.
 */
import { type EnvironmentDescriptor, type EnvironmentKind, type FileSystemPort, joinPath, type Clock } from '../api.ts';

import type { ExecutorOpContext, EnvironmentExecutor } from './executor.ts';
import { observeCancellation } from './executor.ts';
import type { DescribeVerdict, ExecutorEffectError, ExecutorEffectResult, ProvenanceActor } from './types.ts';

const SIM_STATE_SCHEMA_ID = 'flauz.env-sim/v0';

/** The file-backed simulated backing truth (one per environment). */
export interface SimEnvState {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly environmentId: string;
	readonly running: boolean;
	readonly startedAt: number | null;
	readonly beat: number;
	readonly lease: { readonly leaseId: string; readonly heldSince: number } | null;
	readonly snapshots: readonly string[];
}

/** A queued failure cue (deterministic failure-path drills). */
export interface SimFailureCue {
	readonly op: 'create' | 'start' | 'stop' | 'attach' | 'detach' | 'snapshot' | 'destroy';
	readonly code: string;
	readonly message: string;
}

/** The fs surface the simulated executors need (envelope port + rm for crash drills). */
export interface SimFsPort extends FileSystemPort {
	rm(path: string): Promise<void>;
}

export interface SimulatedRemoteExecutorOptions {
	/** The remote kind this instance simulates. */
	readonly kind: EnvironmentKind;
	readonly root: string;
	readonly fs: SimFsPort;
	readonly clock?: Clock;
	/** Deterministic per-op latency (default 0). */
	readonly latencyMs?: number;
	/** Pre-seeded failure cues (more can be queued at runtime). */
	readonly cues?: readonly SimFailureCue[];
}

/** *** TEST INFRASTRUCTURE — NOT PRODUCTION CODE. *** */
export class SimulatedRemoteExecutor implements EnvironmentExecutor {
	readonly infrastructureClass = 'simulated' as const;
	readonly kinds: readonly EnvironmentKind[];
	readonly executorKind: string;
	private readonly root: string;
	private readonly fs: SimFsPort;
	private readonly clock: Clock;
	private readonly latencyMs: number;
	private readonly cues: SimFailureCue[] = [];
	private leaseCounter = 0;

	constructor(options: SimulatedRemoteExecutorOptions) {
		this.kinds = [options.kind];
		this.executorKind = `simulated-${options.kind}`;
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.latencyMs = options.latencyMs ?? 0;
		this.cues.push(...(options.cues ?? []));
	}

	/** Queues a failure cue (drill control surface). */
	queueFailureCue(cue: SimFailureCue): void {
		this.cues.push(cue);
	}

	/**
	 * Simulates a hard crash: the backing sim file disappears while the
	 * lifecycle state still claims whatever it claims (drives the
	 * describe-crash-reconciliation drills).
		 */
	async simulateCrash(envId: string): Promise<void> {
		await this.fs.rm(this.simPath(envId));
	}

	private simPath(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-sim', `${envId}.json`);
	}

	private async delay(): Promise<void> {
		if (this.latencyMs <= 0) {
			return;
		}
		await new Promise<void>(resolve => setTimeout(resolve, this.latencyMs));
	}

	private async load(envId: string): Promise<SimEnvState | undefined> {
		const raw = await this.fs.readFileUtf8(this.simPath(envId));
		if (raw === undefined) {
			return undefined;
		}
		const value = JSON.parse(raw) as SimEnvState;
		if (value.schema !== SIM_STATE_SCHEMA_ID) {
			return undefined;
		}
		return value;
	}

	private async save(state: SimEnvState): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, '.flauz', 'env-sim'));
		await this.fs.writeFile(this.simPath(state.environmentId), `${JSON.stringify(state, null, 2)}\n`);
	}

	private async blank(descriptor: EnvironmentDescriptor): Promise<SimEnvState> {
		return {
			schemaVersion: 0,
			schema: SIM_STATE_SCHEMA_ID,
			environmentId: descriptor.id,
			running: false,
			startedAt: null,
			beat: 0,
			lease: null,
			snapshots: [],
		};
	}

	/** Consumes a matching failure cue (deterministic failure injection). */
	private consumeCue(op: SimFailureCue['op']): { code: string; message: string } | undefined {
		const index = this.cues.findIndex(cue => cue.op === op);
		if (index === -1) {
			return undefined;
		}
		const [cue] = this.cues.splice(index, 1);
		return { code: cue.code, message: cue.message };
	}

	private async guard(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext, op: SimFailureCue['op'], requiresState: boolean): Promise<{ ok: false; error: ExecutorEffectError } | { ok: true; state: SimEnvState }> {
		const cue = this.consumeCue(op);
		if (cue !== undefined) {
			return { ok: false, error: cue };
		}
		await this.delay();
		// DL-81 / P2-FIX-109 — the pre-spawn effect checkpoint (the deterministic
		// port model): observed AFTER the injected latency and BEFORE the op's
		// effect commits (every mutating save happens after guard) — a cancel
		// minted mid-latency is always observed, and the sim truth stays
		// untouched (no fabricated running state).
		const cancelled = observeCancellation(ctx, 'pre-spawn', `sim backing state untouched (the '${op}' effect never committed)`);
		if (cancelled !== undefined && !cancelled.ok) {
			return { ok: false, error: cancelled.error };
		}
		const state = await this.load(descriptor.id);
		if (requiresState && state === undefined) {
			return { ok: false, error: { code: 'SIM_STATE_GONE', message: `simulated backing state for '${descriptor.id}' is gone (crash or destroy) — the lifecycle state outruns the truth` } };
		}
		return { ok: true, state: state ?? await this.blank(descriptor) };
	}

	// -- the executor surface ------------------------------------------------------

	async create(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'create', false);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		await this.save(guard.state);
		return { ok: true, detail: { type: 'create', stateDir: joinPath(this.root, '.flauz', 'env-sim') } };
	}

	async start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'start', false);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		if (guard.state.running) {
			return { ok: false, error: { code: 'SIM_ALREADY_RUNNING', message: `simulated environment '${descriptor.id}' is already running` } };
		}
		// simulated pid: deterministic, clearly fake (negative), never a real signal target
		const pid = -Number(`${ctx.now % 100000}${Math.abs(hashCode(descriptor.id)) % 1000}`);
		await this.save({ ...guard.state, running: true, startedAt: ctx.now, beat: guard.state.beat + 1, lease: null });
		return { ok: true, detail: { type: 'start', pid } };
	}

	async stop(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'stop', false);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		const pid = guard.state.running ? -Number(`${guard.state.startedAt ?? 0}`) : null;
		await this.save({ ...guard.state, running: false, lease: null });
		return { ok: true, detail: { type: 'stop', pid, forcedSignal: null } };
	}

	async attach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'attach', true);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		if (!guard.state.running) {
			return { ok: false, error: { code: 'SIM_NOT_RUNNING', message: `simulated environment '${descriptor.id}' is not running (attach models a live connection lease)` } };
		}
		if (guard.state.lease !== null) {
			return { ok: false, error: { code: 'SIM_LEASE_HELD', message: `simulated environment '${descriptor.id}' already holds lease '${guard.state.lease.leaseId}'` } };
		}
		this.leaseCounter += 1;
		const lease = { leaseId: `sim-lease-${descriptor.id}-${this.leaseCounter}`, heldSince: ctx.now };
		await this.save({ ...guard.state, lease });
		return { ok: true, detail: { type: 'attach', leaseId: lease.leaseId, heldSince: lease.heldSince } };
	}

	async detach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'detach', true);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		if (guard.state.lease === null) {
			return { ok: false, error: { code: 'SIM_NO_LEASE', message: `simulated environment '${descriptor.id}' holds no lease` } };
		}
		const leaseId = guard.state.lease.leaseId;
		await this.save({ ...guard.state, lease: null });
		return { ok: true, detail: { type: 'detach', leaseId } };
	}

	async snapshot(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'snapshot', true);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		const snapshotDir = joinPath(this.root, '.flauz', 'env-sim-snapshots', descriptor.id, String(ctx.now));
		await this.fs.mkdir(snapshotDir);
		await this.fs.writeFile(joinPath(snapshotDir, 'sim-state.json'), `${JSON.stringify(guard.state, null, 2)}\n`);
		await this.save({ ...guard.state, snapshots: [...guard.state.snapshots, snapshotDir] });
		return { ok: true, detail: { type: 'snapshot', snapshotDir, fileCount: 1, manifestPath: joinPath(snapshotDir, 'sim-state.json') } };
	}

	async destroy(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const guard = await this.guard(descriptor, ctx, 'destroy', false);
		if (!guard.ok) {
			return { ok: false, error: guard.error };
		}
		const pid = guard.state.running ? -Number(`${guard.state.startedAt ?? 0}`) : null;
		try {
			await this.fs.rm(this.simPath(descriptor.id));
		} catch {
			// already gone — destroy is idempotent
		}
		return { ok: true, detail: { type: 'destroy', pid } };
	}

	async probe(descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> {
		const state = await this.load(descriptor.id);
		if (state === undefined) {
			return {
				health: 'stale',
				state: 'stopped',
				pid: null,
				message: `simulated backing state for '${descriptor.id}' is gone (crash reconciliation — never silently healthy)`,
			};
		}
		if (!state.running) {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: null,
				message: `simulated environment '${descriptor.id}' is provisioned and stopped`,
				...(state.lease === null ? {} : { lease: { leaseId: state.lease.leaseId, heldSince: state.lease.heldSince } }),
			};
		}
		return {
			health: 'healthy',
			state: 'running',
			pid: null,
			message: `simulated environment '${descriptor.id}' is running (beat ${state.beat})`,
			...(state.lease === null ? {} : { lease: { leaseId: state.lease.leaseId, heldSince: state.lease.heldSince } }),
		};
	}
}

/** Tiny deterministic string hash (stable fake pid derivation). */
function hashCode(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0;
	}
	return hash;
}

/** The actor type re-export keeps drill imports single-sited. */
export type { ProvenanceActor };
