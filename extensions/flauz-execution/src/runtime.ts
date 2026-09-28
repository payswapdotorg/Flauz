/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 - the execution-resource EFFECT SINK: the seam the durable
 * orchestration runtime (extensions/flauz-agent/core/runtime.mjs
 * driveGraph) consumes. EFFECT_SINK_SHAPE:
 *   run(idempotencyKey, spec) -> {ok, value|failureClass+message, replayed}
 *
 * The sink parses the step's toolInput as an ExecutionRequest, routes by
 * resource class to the adapter, acquires (unless already held for the
 * idempotency key - the journal is the replay substrate), executes the
 * action THROUGH the TL3 port, settles the effect (the replay record) and
 * returns the effect shape with the orchestration failure class mapped by
 * the taxonomy law.
 *
 * driveExecutionGraph() wraps the REAL driveGraph with the completion and
 * expiry sweeps: after the graph pass, acquisitions of steps that reached
 * a terminal status are released (completion) and expired leases are
 * swept (service). The graph state itself is NEVER mutated here - the
 * sweeps append only execution-journal rows + typed releases.
 */

import {
	type ExecFailure,
	type ExecutionRequest,
	type ExecutionResourceRef,
	type SurfaceSnapshot,
	EXEC_TO_ORCH_FAILURE_CLASS,
	execSha256Hex,
	validateExecutionRequest,
} from './contracts.ts';
import { ExecJournalStore } from './journal.ts';
import { ExecutionResourceManager, type GraphStatePort, type ResourceOpenerPort, type StepBinding } from './acquisition.ts';
import { BrowserExecutionAdapter, EnvironmentExecutionAdapter, LogicalResourceAdapter, type BrowserSessionManagerPort, type EnvironmentLifecyclePort, type ResourceGraphPort } from './adapters.ts';

/** The spec driveGraph passes to the sink (the runtime.mjs construction). */
export interface SinkSpec {
	readonly graphId: string;
	readonly stepId: string;
	readonly attempt: number;
	readonly tool: string | null;
	readonly toolInput: Record<string, unknown> | null;
	readonly instruction: string;
}

/** The effect shape (core/runtime.mjs EFFECT_SINK_SHAPE). */
export type EffectResult =
	| { readonly ok: true; readonly value: string; readonly replayed: boolean }
	| { readonly ok: false; readonly failureClass: string; readonly message: string; readonly replayed: boolean };

export interface ExecutionSinkOptions {
	readonly journal: ExecJournalStore;
	readonly manager: ExecutionResourceManager;
	readonly browser: BrowserExecutionAdapter;
	readonly environment: EnvironmentExecutionAdapter;
	readonly logical: LogicalResourceAdapter;
	/** The runner id the sink reports to the orchestrator (default 'flauz-exec'). */
	readonly runnerId?: string;
}

/** The execution-resource effect sink (the driveGraph seam). */
export class ExecutionResourceSink {
	private readonly journal: ExecJournalStore;
	private readonly manager: ExecutionResourceManager;
	private readonly browser: BrowserExecutionAdapter;
	private readonly environment: EnvironmentExecutionAdapter;
	private readonly logical: LogicalResourceAdapter;
	private readonly runnerId: string;

	constructor(options: ExecutionSinkOptions) {
		this.journal = options.journal;
		this.manager = options.manager;
		this.browser = options.browser;
		this.environment = options.environment;
		this.logical = options.logical;
		this.runnerId = options.runnerId ?? 'flauz-exec';
	}

	/** run(idempotencyKey, spec) - the EFFECT_SINK_SHAPE implementation. */
	async run(idempotencyKey: string, spec: SinkSpec): Promise<EffectResult> {
		// 1. REPLAY: a settled effect for this key returns the recorded outcome.
		const settled = this.journal.settledRowFor(idempotencyKey);
		if (settled !== undefined) {
			const payload = settled.payload as { outcome: 'ok' | 'failed'; valueDigest?: string; failureClass?: string; message?: string };
			if (payload.outcome === 'ok') {
				return { ok: true, value: `replayed:${payload.valueDigest ?? ''}`, replayed: true };
			}
			return { ok: false, failureClass: EXEC_TO_ORCH_FAILURE_CLASS[payload.failureClass as keyof typeof EXEC_TO_ORCH_FAILURE_CLASS] ?? 'unknown-default', message: payload.message ?? 'replayed failure', replayed: true };
		}

		const binding: StepBinding = {
			graphId: spec.graphId,
			stepId: spec.stepId,
			attempt: spec.attempt,
			idempotencyKey,
			runnerId: this.runnerId,
			actor: 'agent',
			origin: `exec:sink:${spec.tool ?? 'none'}`,
		};

		// 2. Parse the toolInput (typed invalid-request failure otherwise).
		const verdict = validateExecutionRequest(spec.toolInput);
		if (!verdict.ok) {
			return this.settleFailed(binding, { failureClass: 'invalid-request', message: verdict.error });
		}
		const request = verdict.request;

		// 3. Acquire (idempotent per key; the graph-state gate + policy denials
		//    are fail-closed inside the manager; the ROUTING opener dispatches
		//    to the class adapter).
		const acquired = await this.manager.acquire(request, binding);
		if (!acquired.ok) {
			return this.settleFailed(binding, acquired.failure);
		}
		const acquisitionId = acquired.acquisition.acquisitionId;
		const resource = acquired.acquisition.resource;

		// 4. Execute the action through the adapter (the TL3 port) - UNLESS
		//    the action IS the acquire action (browser open / environment
		//    attach / logical resolve): the acquire already performed it and
		//    recorded the hand-off; the effect is the acquisition itself.
		if (isAcquireAction(request.action)) {
			const valueDigest = execSha256Hex(`acquired:${resource.id}`);
			this.journal.appendRow('effect-settled', {
				graphId: binding.graphId,
				stepId: binding.stepId,
				attempt: binding.attempt,
				idempotencyKey,
				acquisitionId,
				actor: 'tool',
				origin: 'exec:sink:settle',
				payload: { outcome: 'ok', valueDigest },
			});
			return { ok: true, value: `acquired ${resource.id}`, replayed: false };
		}
		const used = await this.useThrough(resource.resourceClass, { ...request, resource }, binding, acquisitionId);
		if (!used.ok) {
			// The failure path: record the loss when the resource was lost
			// mid-step (the acquisition ends 'lost' - recoverable, M4).
			if (used.failure.failureClass === 'resource-lost' || used.failure.failureClass === 'executor-death') {
				this.journal.appendRow('resource-lost', {
					graphId: binding.graphId,
					stepId: binding.stepId,
					attempt: binding.attempt,
					idempotencyKey: null,
					acquisitionId,
					actor: 'service',
					origin: 'exec:sink:loss',
					payload: { detectedBy: 'effect-failure', failureClass: used.failure.failureClass, message: used.failure.message },
				});
			}
			return this.settleFailed(binding, used.failure);
		}

		// 5. Settle the effect (the replay record for this idempotency key).
		const valueDigest = execSha256Hex(used.value);
		this.journal.appendRow('effect-settled', {
			graphId: binding.graphId,
			stepId: binding.stepId,
			attempt: binding.attempt,
			idempotencyKey,
			acquisitionId,
			actor: 'tool',
			origin: 'exec:sink:settle',
			payload: { outcome: 'ok', valueDigest },
		});
		return { ok: true, value: used.value, replayed: false };
	}

	private async useThrough(resourceClass: string, request: ExecutionRequest, binding: StepBinding, acquisitionId: string): Promise<{ ok: true; value: string } | { ok: false; failure: ExecFailure }> {
		if (resourceClass === 'browser-session') {
			return this.browser.use(request, binding, acquisitionId);
		}
		if (resourceClass === 'environment') {
			return this.environment.use(request, binding, acquisitionId);
		}
		return this.logical.use(request, binding, acquisitionId);
	}

	private settleFailed(binding: StepBinding, failure: ExecFailure): EffectResult {
		// The denial rows are already journaled by the manager; record the
		// effect settlement for the replay path.
		const acquisitionId = this.journal.acquisitionRowsForKey(binding.idempotencyKey).at(-1)?.acquisitionId ?? null;
		this.journal.appendRow('effect-settled', {
			graphId: binding.graphId,
			stepId: binding.stepId,
			attempt: binding.attempt,
			idempotencyKey: binding.idempotencyKey,
			acquisitionId,
			actor: 'tool',
			origin: 'exec:sink:settle',
			payload: { outcome: 'failed', failureClass: failure.failureClass, message: failure.message },
		});
		const orchClass = EXEC_TO_ORCH_FAILURE_CLASS[failure.failureClass] ?? 'unknown-default';
		return { ok: false, failureClass: orchClass, message: failure.message, replayed: false };
	}
}

// ---------------------------------------------------------------------------
// The runtime factory (routing opener + manager + sink + adapters)
// ---------------------------------------------------------------------------

export interface ExecutionRuntimeOptions {
	/** The execution journal store (the replay substrate). */
	readonly journal: ExecJournalStore;
	/** The orchestration-side state port (the real OrchestrationStore behind it). */
	readonly graphState: GraphStatePort;
	/** The REAL BrowserSessionManager (structural port). */
	readonly browser: BrowserSessionManagerPort;
	/** The REAL EnvironmentLifecycleManager (structural port). */
	readonly lifecycle: EnvironmentLifecyclePort;
	/** The REAL ResourceGraph (structural port). */
	readonly resourceGraph: ResourceGraphPort;
	readonly runnerId?: string;
	readonly clock?: () => number;
}

export interface ExecutionRuntime {
	readonly journal: ExecJournalStore;
	readonly manager: ExecutionResourceManager;
	readonly sink: ExecutionResourceSink;
	readonly browser: BrowserExecutionAdapter;
	readonly environment: EnvironmentExecutionAdapter;
	readonly logical: LogicalResourceAdapter;
}

/**
 * Wires the runtime: the ROUTING opener dispatches acquire by resource
 * class to the adapter; the manager journals; the sink is the driveGraph
 * seam. Everything additive - the TL3 managers are consumed as-is.
 */
export function createExecutionRuntime(options: ExecutionRuntimeOptions): ExecutionRuntime {
	const browser = new BrowserExecutionAdapter({ browser: options.browser, graph: options.resourceGraph, journal: options.journal });
	const environment = new EnvironmentExecutionAdapter({ lifecycle: options.lifecycle, graph: options.resourceGraph, journal: options.journal });
	const logical = new LogicalResourceAdapter({ graph: options.resourceGraph, journal: options.journal });
	const routingOpener: ResourceOpenerPort = {
		async open(request, binding) {
			if (request.resource === undefined || request.resource.resourceClass === 'browser-session') {
				return browser.open(request, binding);
			}
			if (request.resource.resourceClass === 'environment') {
				return environment.open(request, binding);
			}
			return logical.open(request, binding);
		},
	};
	const manager = new ExecutionResourceManager({ journal: options.journal, graph: options.graphState, opener: routingOpener, clock: options.clock });
	const sink = new ExecutionResourceSink({ journal: options.journal, manager, browser, environment, logical, runnerId: options.runnerId });
	return { journal: options.journal, manager, sink, browser, environment, logical };
}

// ---------------------------------------------------------------------------
// The completion + expiry sweeps (the driveGraph wrapper)
// ---------------------------------------------------------------------------

/** Step status probe for the completion sweep (the real store satisfies this). */
export interface StepStatusPort {
	stepStatus(graphId: string, stepId: string): string;
}

export interface SweepOutcome {
	readonly completedReleases: readonly string[];
	readonly expired: readonly string[];
}

/**
 * Releases acquisitions of steps that reached a TERMINAL step status
 * (succeeded | cancelled | failed) - the completion release path - and
 * sweeps expired leases. Graph state is never mutated here.
 */
export async function settleExecution(manager: ExecutionResourceManager, journal: ExecJournalStore, steps: StepStatusPort, now?: number): Promise<SweepOutcome> {
	const completedReleases: string[] = [];
	for (const acquisition of journal.heldAcquisitions()) {
		if (acquisition.graphId === null || acquisition.stepId === null) {
			continue;
		}
		const status = steps.stepStatus(acquisition.graphId, acquisition.stepId);
		if (status === 'succeeded' || status === 'cancelled' || status === 'failed') {
			const released = await manager.release({ acquisitionId: acquisition.acquisitionId, releaseKind: 'completion', actor: 'service', origin: 'exec:sweep:completion', note: `step ${status}` });
			if (released.ok) {
				completedReleases.push(released.acquisitionId);
			}
		}
	}
	const sweep = manager.sweepExpirations(now);
	return { completedReleases, expired: sweep.expired };
}

/** Actions whose acquire IS the effect (the opener performed them: the browser session open, the environment attach lease, the logical resolve). */
function isAcquireAction(action: string): boolean {
	return action === 'open' || action === 'attach' || action === 'resolve';
}

// ---------------------------------------------------------------------------
// The execution recovery scan (mirrors core/recovery.mjs over acquisitions)
// ---------------------------------------------------------------------------

export interface ExecutionRecoveryReport {
	readonly scannedAt: number;
	readonly clean: boolean;
	readonly journalRows: number;
	readonly tornTail: { line: string; reason: string } | null;
	readonly actions: readonly string[];
}

/**
 * The recovery pass over the execution journal (after a restart): expiry
 * sweep + the torn-tail surfacing + a recovery-scan row recording what
 * was done. NEVER fabricates: it does not rebind (reattach/restore are
 * explicit continuity decisions), does not settle effects, does not
 * release (rollback is a graph-level decision) - it only expires leases
 * whose time passed while the process was down and records the scan.
 */
export async function executionRecoveryScan(manager: ExecutionResourceManager, journal: ExecJournalStore, options: { now?: number; origin?: string } = {}): Promise<ExecutionRecoveryReport> {
	const now = options.now ?? Date.now();
	const origin = options.origin ?? 'exec:recovery';
	const sweep = manager.sweepExpirations(now);
	const actions = sweep.expired.map((acquisitionId) => `lease-expired:${acquisitionId}`);
	if (journal.tornTail !== null) {
		actions.push(`torn-tail-dropped:${journal.tornTail.reason}`);
	}
	journal.appendRow('recovery-scan', {
		graphId: null,
		actor: 'service',
		origin,
		payload: { actions, clean: actions.length === 0 },
	});
	return {
		scannedAt: now,
		clean: actions.length === 0,
		journalRows: journal.rowsAll().length,
		tornTail: journal.tornTail,
		actions,
	};
}
