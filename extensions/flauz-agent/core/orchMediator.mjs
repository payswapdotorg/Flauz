/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration mediator (TL2-001 M4 / TL2-004) - the in-process
 * service-side fixture of the orchestration protocol contract.
 *
 * This is the object the future stateful orchestration service dispatches
 * THROUGH: `dispatch(method, args)` applies the contract gates (registry,
 * lifecycle, request-envelope validation), routes to the durable store
 * (core/orchStore.mjs - every state change stays one hash-chained journal
 * row through the replay-validated append path), self-checks the result
 * against the contract (validateOrchResult) and emits the event stream.
 * The transport adapter that carries it (the stdio loopback today, the real
 * core service's flauz.orch.* wiring in the TL2-S1 secondment) is a THIN
 * seam: framing, negotiation and error envelopes belong to the TL1-003
 * service seam, never re-implemented here.
 *
 * Event discipline (no fabricated events): events are emitted ONLY from
 * journal rows that are already on disk. After every successful dispatch
 * the mediator syncs forward over the store's journal (single writer per
 * workspace, the documented v0 assumption) and emits, per NEW row:
 *   1. 'orch-journal-row' - the universal step-state stream
 *      {graphId, rowId, seq, type, stepId, actor};
 *   2. the row's domain event when it has one (orchEventOfRow: the
 *      approval/takeover/lease/claim/conflict/recovery surfaces).
 * A crash between a journal append and its event emission loses at most the
 * event, never the durable fact - and the next dispatch's sync re-emits
 * from the last synced seq (re-delivery is the at-least-once posture).
 *
 * Lifecycle (the shutdown-ordering contract): 'active' -> 'draining' ->
 * 'drained'. shutdown() refuses nothing to the CALLER (idempotent) but new
 * dispatches during draining fail fast with flauz.orch.err.shutting-down;
 * in-flight dispatches complete first (the drain waits for them). The
 * transport adapter answers its shutdown command AFTER the drain so no
 * request answer is lost.
 *
 * The human authorization boundary: the mediator carries actor/origin as
 * REQUEST PROVENANCE (v0 unauthenticated - the flauz.auth skeleton posture;
 * a future auth version re-anchors it) and the durable graph's transition
 * tables remain the enforcement point. A non-human decideApproval is
 * rejected by the graph and surfaces as a typed
 * flauz.orch.err.illegal-transition failure; nothing here can auto-grant.
 */

import { OrchestrationStore } from './orchStore.mjs';
import { recoveryScan } from './recovery.mjs';
import {
	ORCH_FAILURE_CODES,
	ORCH_METHODS,
	OrchProtocolFailure,
	orchFailure,
	orchFailureOf,
	journalRowEventOf,
	orchEventOfRow,
	validateOrchRequest,
	validateOrchResult,
} from './orchProtocol.mjs';

/**
 * The in-process orchestration mediator.
 *
 * @param {string} root the workspace root (the .flauz/orchestration/ artifacts)
 * @param {{ taskPort?: object | null, clock?: () => number }} options the
 *        store wiring (taskPort: the WorkspaceSeam in service wiring, fakes
 *        in tests; clock: injectable for determinism).
 */
export class OrchestrationMediator {
	constructor(root, options = {}) {
		this.root = root;
		this.store = new OrchestrationStore(root, { taskPort: options.taskPort ?? null, clock: options.clock });
		this.listeners = [];
		this.state = 'active';
		this.inFlight = 0;
		this.drainWaiters = [];
		this.lastSyncedSeq = this.store.journalRows.length;
	}

	// ---------------------------------------------------------------------------
	// Events
	// ---------------------------------------------------------------------------

	/**
	 * Subscribe to the orchestration event stream. The listener receives
	 * `{event, payload, ts}` domain events (the transport adapter wraps them
	 * in the TL1-003 wire event envelope). Returns the unsubscribe function.
	 */
	subscribe(listener) {
		if (typeof listener !== 'function') {
			throw new Error('OrchestrationMediator.subscribe requires a listener function');
		}
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) {
				this.listeners.splice(index, 1);
			}
		};
	}

	emit(event, payload, ts) {
		for (const listener of [...this.listeners]) {
			try {
				listener({ event, payload, ts });
			} catch {
				// A listener failure never breaks the mediator (the seam
				// posture: events are never fatal).
			}
		}
	}

	/** Emit the events of every journal row appended since the last sync (persisted rows only). */
	syncEvents() {
		for (let seq = this.lastSyncedSeq + 1; seq <= this.store.journalRows.length; seq += 1) {
			const row = this.store.journalRows[seq - 1];
			const stream = journalRowEventOf(row);
			this.emit(stream.event, stream.payload, row.ts);
			const domain = orchEventOfRow(row);
			if (domain !== null) {
				this.emit(domain.event, domain.payload, row.ts);
			}
		}
		this.lastSyncedSeq = this.store.journalRows.length;
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Graceful shutdown: 'active' -> 'draining' (new dispatches fail fast
	 * with flauz.orch.err.shutting-down) -> 'drained' once every in-flight
	 * dispatch completed. Idempotent: a repeated call affirms and reports.
	 */
	async shutdown() {
		if (this.state === 'drained') {
			return { ok: true, state: this.state, replay: true };
		}
		if (this.state === 'draining') {
			await new Promise((resolve) => {
				this.drainWaiters.push(resolve);
			});
			return { ok: true, state: this.state, replay: true };
		}
		this.state = 'draining';
		if (this.inFlight > 0) {
			await new Promise((resolve) => {
				this.drainWaiters.push(resolve);
			});
		}
		this.state = 'drained';
		this.resolveDrain();
		return { ok: true, state: this.state, replay: false };
	}

	resolveDrain() {
		const waiters = this.drainWaiters;
		this.drainWaiters = [];
		for (const waiter of waiters) {
			waiter();
		}
	}

	releaseInFlight() {
		this.inFlight -= 1;
		if (this.inFlight === 0 && this.state === 'draining') {
			this.resolveDrain();
		}
	}

	// ---------------------------------------------------------------------------
	// Dispatch (the contract gates + the store routing)
	// ---------------------------------------------------------------------------

	/**
	 * Dispatch one orchestration request. Gates in order: the registry
	 * (unknown name -> flauz.orch.err.unknown-method), the lifecycle
	 * (draining -> flauz.orch.err.shutting-down), the request envelope
	 * (validateOrchRequest -> flauz.orch.err.invalid-params). The store's
	 * domain validation (transition legality, gates, attempts) throws
	 * OrchestrationError, mapped to the typed taxonomy.
	 *
	 * @returns {Promise<object>} the validated result envelope.
	 * @throws {OrchProtocolFailure} carrying the typed failure.
	 */
	async dispatch(method, args) {
		if (!Object.prototype.hasOwnProperty.call(ORCH_METHODS, method)) {
			throw new OrchProtocolFailure(orchFailure(
				ORCH_FAILURE_CODES.UNKNOWN_METHOD,
				`unknown orchestration method: ${String(method)}`,
				{ method: String(method) },
			));
		}
		if (this.state !== 'active') {
			throw new OrchProtocolFailure(orchFailure(
				ORCH_FAILURE_CODES.SHUTTING_DOWN,
				`the orchestration mediator is ${this.state} (new requests are refused while draining)`,
				{ method, state: this.state },
			));
		}
		const requestError = validateOrchRequest(method, args);
		if (requestError !== undefined) {
			throw new OrchProtocolFailure(orchFailure(ORCH_FAILURE_CODES.INVALID_PARAMS, requestError, { method }));
		}
		this.inFlight += 1;
		try {
			let result;
			try {
				result = await this.route(method, args);
			} catch (error) {
				if (error instanceof OrchProtocolFailure) {
					throw error;
				}
				// A domain failure (OrchestrationError and friends) maps into
				// the typed taxonomy - the transport adapter serializes
				// .orchFailure, never a raw stack.
				throw new OrchProtocolFailure(orchFailureOf(error));
			}
			const resultError = validateOrchResult(method, result);
			if (resultError !== undefined) {
				// The self-check: a store that ever returns an unexpected shape
				// fails loudly instead of shipping a malformed response.
				throw new OrchProtocolFailure(orchFailure(ORCH_FAILURE_CODES.INTERNAL, `mediator self-check failed: ${resultError}`, { method }));
			}
			this.syncEvents();
			return result;
		} finally {
			this.releaseInFlight();
		}
	}

	/** Route one validated request to the store (the per-method table). */
	async route(method, args) {
		const store = this.store;
		const rowResult = (row) => ({
			rowId: row.rowId,
			...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}),
		});
		switch (method) {
			case 'flauz.orch.submitGraph': {
				const submitted = await store.submitGraph({
					title: args.title,
					steps: args.steps,
					policy: args.policy,
					taskId: args.taskId ?? null,
					actor: args.actor,
					origin: args.origin,
				});
				return { graphId: submitted.graphId, taskId: submitted.taskId, stepIds: submitted.stepIds, rowId: submitted.rowId };
			}
			case 'flauz.orch.approveGraph':
				return rowResult(await store.approveGraph({ graphId: args.graphId, actor: args.actor, origin: args.origin, ...(args.note !== undefined ? { note: args.note } : {}) }));
			case 'flauz.orch.rejectGraph':
				return rowResult(await store.rejectGraph({ graphId: args.graphId, actor: args.actor, origin: args.origin, ...(args.note !== undefined ? { note: args.note } : {}) }));
			case 'flauz.orch.cancelGraph': {
				const cancelled = await store.cancelGraph({ graphId: args.graphId, reason: args.reason, actor: args.actor, origin: args.origin });
				return { cancelledSteps: cancelled.cancelledSteps };
			}
			case 'flauz.orch.getGraph':
				return store.getGraphState(args.graphId);
			case 'flauz.orch.listGraphs':
				return { graphs: store.listGraphs() };
			case 'flauz.orch.verifyJournal':
				return store.verifyJournal();
			case 'flauz.orch.startStep': {
				const started = await store.startStep({ graphId: args.graphId, stepId: args.stepId, runnerId: args.runnerId, actor: args.actor, origin: args.origin });
				return { attempt: started.attempt, idempotencyKey: started.idempotencyKey, rowId: started.rowId };
			}
			case 'flauz.orch.finishStep': {
				const row = await store.finishStep({
					graphId: args.graphId,
					stepId: args.stepId,
					attempt: args.attempt,
					outcome: args.outcome,
					output: args.output,
					message: args.message,
					failureClass: args.failureClass,
					retryPlanned: args.retryPlanned,
					evidence: args.evidence,
					actor: args.actor,
					origin: args.origin,
				});
				return rowResult(row);
			}
			case 'flauz.orch.retryStep':
				return rowResult(await store.retryStep({ graphId: args.graphId, stepId: args.stepId, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.requestApproval': {
				const row = await store.approvalRequest({
					graphId: args.graphId,
					stepId: args.stepId,
					reason: args.reason,
					...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
					actor: args.actor,
					origin: args.origin,
				});
				return rowResult(row);
			}
			case 'flauz.orch.decideApproval': {
				const row = await store.approvalDecide({
					graphId: args.graphId,
					stepId: args.stepId,
					decision: args.decision,
					note: args.note,
					actor: args.actor,
					origin: args.origin,
				});
				return rowResult(row);
			}
			case 'flauz.orch.expireApproval': {
				const row = await store.expireApproval({
					graphId: args.graphId,
					stepId: args.stepId,
					expiredAt: args.expiredAt,
					note: args.note,
					actor: args.actor,
					origin: args.origin,
				});
				return rowResult(row);
			}
			case 'flauz.orch.requestTakeover':
				return rowResult(await store.takeoverRequest({ graphId: args.graphId, stepId: args.stepId, reason: args.reason, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.acceptTakeover':
				return rowResult(await store.takeoverAccept({ graphId: args.graphId, stepId: args.stepId, note: args.note, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.completeTakeover': {
				const row = await store.takeoverComplete({
					graphId: args.graphId,
					stepId: args.stepId,
					summary: args.summary,
					evidence: args.evidence,
					actor: args.actor,
					origin: args.origin,
				});
				return rowResult(row);
			}
			case 'flauz.orch.acquireClaim': {
				const row = await store.acquireClaim({ graphId: args.graphId, stepId: args.stepId, holder: args.holder, actor: args.actor, origin: args.origin });
				return { claimId: row.payload.claimId, rowId: row.rowId, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
			}
			case 'flauz.orch.releaseClaim':
				return rowResult(await store.releaseClaim({ graphId: args.graphId, stepId: args.stepId, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.acquireLease': {
				const row = await store.acquireLease({ graphId: args.graphId, stepId: args.stepId, holder: args.holder, ttlMs: args.ttlMs, actor: args.actor, origin: args.origin });
				return { leaseId: row.payload.leaseId, rowId: row.rowId, ...(row.payload.evidenceId !== undefined ? { evidenceId: row.payload.evidenceId } : {}) };
			}
			case 'flauz.orch.renewLease':
				return rowResult(await store.renewLease({ graphId: args.graphId, stepId: args.stepId, ttlMs: args.ttlMs, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.releaseLease':
				return rowResult(await store.releaseLease({ graphId: args.graphId, stepId: args.stepId, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.noticeConflict':
				return rowResult(await store.noticeConflict({
					graphId: args.graphId,
					stepId: args.stepId,
					violation: args.violation,
					expectedHolder: args.expectedHolder,
					actualRunner: args.actualRunner,
					note: args.note,
					actor: args.actor,
					origin: args.origin,
				}));
			case 'flauz.orch.routeStep':
				return rowResult(await store.routeDecide({ graphId: args.graphId, stepId: args.stepId ?? null, targetAgent: args.targetAgent, reason: args.reason, details: args.details, actor: args.actor, origin: args.origin }));
			case 'flauz.orch.recoveryScan':
				return recoveryScan(store, {
					record: args.record !== false,
					...(args.now !== undefined ? { now: args.now } : {}),
					actor: args.actor,
					origin: args.origin,
				});
			default:
				// Unreachable (the registry gate ran first); kept fail-closed.
				throw new OrchProtocolFailure(orchFailure(ORCH_FAILURE_CODES.UNKNOWN_METHOD, `unrouted orchestration method: ${method}`, { method }));
		}
	}
}
