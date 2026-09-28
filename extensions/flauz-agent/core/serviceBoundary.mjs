/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Agent OS service boundary (TL2-S1) - the orchestration-side adapter
 * over the TL1-003 service seam.
 *
 * ROLE (surge charter): the durable Agent OS consumes the versioned service
 * seam as its service boundary - spawn the REAL stdio service
 * (node core/service.mjs <workspaceRoot>), hello + protocol negotiation,
 * subscribe to events, watch health, issue workspace/A2A methods, and
 * start/recover through the native boundary. This module is that consumer;
 * it is NOT a second orchestration architecture and NOT a seam
 * reimplementation.
 *
 * ZERO-DUPLICATION LAW (work order M2, binding):
 *  - TRANSPORT lives in src/seamClient.ts (the landed TL1-003 client). This
 *    adapter composes SeamClient - it never re-implements spawn, framing,
 *    request ids, timeouts or disposal. The import is a Node-runtime import
 *    (type stripping); the shipped extension keeps importing types only.
 *  - VERSION LOGIC lives in core/protocol.mjs (the seam definition). This
 *    adapter imports the registry (SEAM_METHODS, seamMethodVersions), the
 *    version list (SEAM_PROTOCOL_VERSIONS) and derives every gating
 *    decision from them - it never re-encodes a version table of its own.
 *  - core/service.mjs internals are never imported; the service is only
 *    ever reached over the wire (SERVICE-SEAM section 1: adopt namespaces,
 *    not implementations).
 *
 * FAIL-CLOSED FAILURE SEMANTICS (work order M4, machine-readable): every
 * failure surfaces as BoundaryFailure with a closed-set code
 * ('flauz.os.err.*' - the adapter's own namespace, distinct from the seam's
 * 'flauz.err.*' which rides in details.seamCode), a retryHint and a
 * retryable flag. No failure is ever swallowed; no optimistic retry may
 * double-apply a side-effecting seam method: a side-effecting request whose
 * response was lost (service death mid-command, timeout) classifies as
 * OUTCOME-UNKNOWN and is NEVER auto-retried - the caller reconciles logical
 * state (snapshot) and re-issues under a NEW idempotency key.
 *
 * IDEMPOTENCY (the <surface>/<id>/run/<attempt> house pattern, client side):
 * call(method, args, { idempotencyKey }) memoizes the attempt per key:
 * in-flight duplicates share one wire request; completed attempts replay
 * their recorded outcome (never re-sending, even across a recovery);
 * outcome-unknown attempts reject fast on re-call (never re-sending). The
 * memo guards the boundary's lifetime only - the durable anchor for
 * cross-process exactly-once semantics remains the orchestration journal's
 * attempt discipline (core/orchestration.mjs); server-side seam
 * idempotency is an additive extension candidate (core/seamUsageMap.json).
 */

import {
	SEAM_METHODS,
	SEAM_PROTOCOL_V0,
	SEAM_PROTOCOL_VERSIONS,
	seamMethodVersions,
} from './protocol.mjs';
import { SeamClient, SeamProtocolError } from '../src/seamClient.ts';

/** The adapter's machine-readable failure-code namespace (closed set). */
export const BOUNDARY_FAILURE_CODES = {
	PROTOCOL_MISMATCH: 'flauz.os.err.protocol-mismatch',
	METHOD_UNAVAILABLE: 'flauz.os.err.method-unavailable',
	SEAM_REJECTED: 'flauz.os.err.seam-rejected',
	SERVICE_DIED: 'flauz.os.err.service-died',
	OUTCOME_UNKNOWN: 'flauz.os.err.outcome-unknown',
	REQUEST_TIMEOUT: 'flauz.os.err.request-timeout',
	NOT_CONNECTED: 'flauz.os.err.not-connected',
};

/** Retry hints (closed set): how a caller may proceed after a failure. */
export const BOUNDARY_RETRY_HINTS = ['never', 'reconnect-then-retry', 'reconcile-then-new-attempt'];

/**
 * The failure-class semantics table (machine-checkable, fail-closed):
 *  - protocol-mismatch    terminal. The service negotiated or exited with a
 *                         version posture this boundary does not support
 *                         (exit 4 = SEAM_EXIT_PROTOCOL_MISMATCH).
 *  - method-unavailable   terminal per method+version. Registry/capability
 *                         gate refused before any wire traffic.
 *  - seam-rejected        definitive. The service answered ok:false; the
 *                         seam code rides in details.seamCode. Retrying the
 *                         identical request is pointless or dangerous.
 *  - service-died         the process exited (or never delivered). Retryable
 *                         only when delivery provably never happened or the
 *                         response loss is side-effect-free; reconnect first.
 *  - outcome-unknown      a side-effecting request whose response was lost.
 *                         NEVER auto-retried: reconcile via snapshot, then a
 *                         NEW attempt key.
 *  - request-timeout      a read-only/idempotent request timed out. Retryable
 *                         (the retry hook) - a re-send is side-effect-free.
 *  - not-connected        the boundary is down (never started / dead /
 *                         shut down). recover() first; nothing was sent.
 */
export const BOUNDARY_FAILURE_CLASSES = {
	'flauz.os.err.protocol-mismatch': { retryable: false, retryHint: 'never' },
	'flauz.os.err.method-unavailable': { retryable: false, retryHint: 'never' },
	'flauz.os.err.seam-rejected': { retryable: false, retryHint: 'never' },
	'flauz.os.err.service-died': { retryable: true, retryHint: 'reconnect-then-retry' },
	'flauz.os.err.outcome-unknown': { retryable: false, retryHint: 'reconcile-then-new-attempt' },
	'flauz.os.err.request-timeout': { retryable: true, retryHint: 'reconnect-then-retry' },
	'flauz.os.err.not-connected': { retryable: true, retryHint: 'reconnect-then-retry' },
};

/**
 * The seam method classes this adapter distinguishes (adapter POLICY,
 * documented - the protocol registry does not encode effect classes):
 *  - 'read-only'      no state change; lost responses are freely retryable.
 *  - 'idempotent'     state-touching but idempotent BY SEAM CONTRACT
 *                     (flauz.lifecycle.initialize never fails and never
 *                     mutates; a repeat call is an affirmation).
 *  - 'side-effecting' everything that mutates workspace/a2a state (the
 *                     default, fail-closed, including unknown names).
 */
const READ_ONLY_SEAM_METHODS = new Set([
	'flauz.workspace.listTasks',
	'flauz.workspace.getTask',
	'flauz.workspace.verifyLedger',
	'flauz.a2a.collect',
	'flauz.a2a.list',
	'ping',
	'flauz.health.ping',
	'flauz.health.status',
	'flauz.auth.status',
	'flauz.auth.login',
	'flauz.auth.logout',
]);

const IDEMPOTENT_SEAM_METHODS = new Set([
	'flauz.lifecycle.initialize',
]);

/** Classify a seam method for failure semantics ('read-only' | 'idempotent' | 'side-effecting'). */
export function seamMethodClass(method) {
	if (READ_ONLY_SEAM_METHODS.has(method)) {
		return 'read-only';
	}
	if (IDEMPOTENT_SEAM_METHODS.has(method)) {
		return 'idempotent';
	}
	return 'side-effecting';
}

/**
 * A machine-readable boundary failure. `code` is one of
 * BOUNDARY_FAILURE_CODES; `retryHint` one of BOUNDARY_RETRY_HINTS;
 * `retryable` mirrors BOUNDARY_FAILURE_CLASSES; `details` carries the
 * machine-readable facts (seamCode, method, reason, phase, ...).
 */
export class BoundaryFailure extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'BoundaryFailure';
		this.code = code;
		this.details = details;
		const semantics = BOUNDARY_FAILURE_CLASSES[code] ?? { retryable: false, retryHint: 'never' };
		this.retryHint = semantics.retryHint;
		this.retryable = semantics.retryable;
	}
}

/**
 * Gate one seam method against the negotiated version and the advertised
 * capabilities (work order M2: method gating DERIVED from the
 * core/protocol.mjs registry, never a copied table).
 *
 *  - unregistered name                          -> method-unavailable (unregistered)
 *  - registered outside the negotiated version  -> method-unavailable (version-gated)
 *  - v1+: a non-legacy method whose namespace is NOT advertised
 *    -> method-unavailable (not-advertised). The fail-closed auth skeleton
 *    intentionally advertises nothing, so flauz.auth.* is refused LOCALLY
 *    under v1 (more fail-closed than the wire's not-implemented answer,
 *    which the conformance suite keeps pinning on the wire itself). Legacy
 *    ping/shutdown are exempt (no namespace advertisement by design).
 *  - under v0 there is no capability advertisement; the version gate is
 *    the only gate (registry truth).
 *
 * @returns {{ ok: true } | { ok: false, failure: BoundaryFailure }}
 */
export function gateSeamMethod(method, negotiatedVersion, capabilities) {
	const versions = seamMethodVersions(method);
	if (versions === null) {
		return { ok: false, failure: new BoundaryFailure(BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `seam method is not registered: ${method}`, { method, reason: 'unregistered' }) };
	}
	if (!versions.includes(negotiatedVersion)) {
		return { ok: false, failure: new BoundaryFailure(BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `seam method ${method} is not dispatchable at ${negotiatedVersion} (dispatchable at: ${versions.join(' | ')})`, { method, reason: 'version-gated', dispatchableAt: versions }) };
	}
	if (negotiatedVersion !== SEAM_PROTOCOL_V0) {
		const info = SEAM_METHODS[method];
		if (info.namespace !== '(legacy)' && !(capabilities ?? []).includes(info.namespace)) {
			return { ok: false, failure: new BoundaryFailure(BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `seam method ${method} belongs to namespace ${info.namespace}, which the service does not advertise at ${negotiatedVersion}`, { method, reason: 'not-advertised', namespace: info.namespace, advertised: [...(capabilities ?? [])] }) };
		}
	}
	return { ok: true };
}

// seamClient rejection texts this classifier recognizes (they are the landed
// client's own messages; the adapter suites pin them so a client text drift
// fails loudly instead of misclassifying):
const EXITED_EARLY_RE = /flauz core service exited early \(code (-?\d+|null)\)/;
const CANNOT_SEND_RE = /^(?:cannot .*: )?flauz core service has exited$/;
const NOT_READY_RE = /flauz core service did not become ready within /;
const TIMED_OUT_RE = /timed out after /;
const V0_CODE_PREFIX_RE = /^(flauz\.err\.[a-z-]+): /;

/**
 * Classify a failed seam send into the boundary failure taxonomy (pure; the
 * classifier never mutates anything and never retries by itself).
 *
 * Order matters: structured seam errors first (the definitive service
 * answer), then the transport failure texts, then - fail-closed - anything
 * unclassified: side-effecting methods degrade to outcome-unknown (never
 * auto-retry), everything else to a NON-retryable seam-rejected.
 */
export function classifySendFailure(method, error) {
	const methodClass = seamMethodClass(method);
	if (error instanceof SeamProtocolError) {
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.SEAM_REJECTED, error.message, { method, seamCode: error.code, seamDetails: error.details ?? null });
	}
	const message = error instanceof Error ? error.message : String(error);
	const exitEarly = EXITED_EARLY_RE.exec(message);
	if (exitEarly !== null) {
		const code = exitEarly[1];
		if (code === '4') {
			// Exit 4 is the seam's own protocol-mismatch exit (the service
			// refuses to guess a version - SERVICE-SEAM section 2).
			return new BoundaryFailure(BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH, message, { method, phase: 'handshake', exitCode: 4, seamCode: 'flauz.err.unsupported-version' });
		}
		// The request WAS written; the response can never arrive. For a
		// side-effecting method the effect may have landed: outcome-unknown.
		if (methodClass === 'side-effecting') {
			return new BoundaryFailure(BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN, message, { method, phase: 'response-lost', exitCode: code === 'null' ? null : Number(code) });
		}
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.SERVICE_DIED, message, { method, phase: 'response-lost', exitCode: code === 'null' ? null : Number(code) }, true);
	}
	if (CANNOT_SEND_RE.test(message)) {
		// The write never happened (the client was already exited): nothing
		// was delivered, so even a side-effecting method may be re-sent
		// after recovery.
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.SERVICE_DIED, message, { method, phase: 'never-delivered' });
	}
	if (NOT_READY_RE.test(message)) {
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.SERVICE_DIED, message, { method, phase: 'handshake' }, true);
	}
	if (TIMED_OUT_RE.test(message)) {
		if (methodClass === 'side-effecting') {
			return new BoundaryFailure(BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN, message, { method, phase: 'response-lost' });
		}
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.REQUEST_TIMEOUT, message, { method, phase: 'response-lost' });
	}
	// A plain Error here is a v0 string rejection (the service answered
	// definitively) - or an unclassified transport anomaly. Fail closed:
	if (methodClass === 'side-effecting') {
		return new BoundaryFailure(BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN, message, { method, phase: 'unclassified' });
	}
	const v0Code = V0_CODE_PREFIX_RE.exec(message);
	return new BoundaryFailure(BOUNDARY_FAILURE_CODES.SEAM_REJECTED, message, { method, seamCode: v0Code === null ? null : v0Code[1], phase: v0Code === null ? 'unclassified' : 'v0-string-rejection' }, false);
}

/** Boundary-level (non-seam) lifecycle observation record for supervision. */
export function boundaryEvent(boundaryEvent, payload) {
	return { boundaryEvent, payload, ts: Date.now() };
}

/** Default capability namespaces the Agent OS requires of a v1 service. */
export const DEFAULT_REQUIRED_CAPABILITIES = ['flauz.a2a', 'flauz.workspace'];

const LEGACY_PING = 'ping';
const LEGACY_SHUTDOWN = 'shutdown';

/**
 * The Agent OS service boundary. Construct via start(); every operation
 * goes through the memo + gate + classify pipeline; recovery is an EXPLICIT
 * Agent OS act (recover(): re-spawn, re-hello, re-negotiate, state re-read).
 */
export class AgentOsServiceBoundary {
	/** @private - use AgentOsServiceBoundary.start(). */
	constructor(client, options) {
		this.client = client;
		this.options = options;
		this.logger = options.logger ?? (() => undefined);
		this.onBoundaryEventCallback = options.onBoundaryEvent;
		this.requiredCapabilities = options.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES;
		this.generation = 1;
		this.dead = false;
		this.closed = false;
		this.recovering = null;
		this.healthTimer = null;
		this.eventsReceived = 0;
		this.lastEventTs = null;
		this.idempotency = new Map();
		this.startReport = null;
		this.exitWaiters = [];
		this.lastExitFacts = null;
	}

	/**
	 * Spawn + handshake one service generation through SeamClient (the
	 * transport owner). The event/exit sinks are rebound to this boundary
	 * immediately after the handshake resolves (before any later stdout or
	 * exit event can fire - microtask ordering), so bookkeeping and death
	 * detection are live for the whole generation.
	 * @private
	 */
	static async spawnClient(boundary, options) {
		let eventSink = () => undefined;
		let exitSink = () => undefined;
		const client = await SeamClient.start({
			workspaceRoot: options.workspaceRoot,
			globalStoragePath: options.globalStoragePath,
			nodePath: options.nodePath,
			servicePath: options.servicePath,
			spawnFn: options.spawnFn,
			connectTimeoutMs: options.connectTimeoutMs,
			requestTimeoutMs: options.requestTimeoutMs,
			logger: options.logger,
			onEvent: (event) => eventSink(event),
			onExit: (code, error) => exitSink(code, error),
		});
		eventSink = (event) => boundary.handleSeamEvent(event);
		exitSink = (code, error) => boundary.handleClientExit(client, code, error);
		return client;
	}

	/**
	 * Start the boundary: spawn the REAL service (hello + negotiation are
	 * the client's), then fail-closed verifications:
	 *  1. the negotiated version must be one of SEAM_PROTOCOL_VERSIONS;
	 *  2. (v1) every required capability namespace must be advertised;
	 *  3. (v1, default) lifecycle initialize affirms the bring-up
	 *     (idempotent by contract).
	 */
	static async start(options) {
		const bootstrap = new AgentOsServiceBoundary(null, options);
		const client = await AgentOsServiceBoundary.spawnClient(bootstrap, options);
		bootstrap.client = client;
		const boundary = bootstrap;
		try {
			const negotiated = client.protocolVersion;
			if (!SEAM_PROTOCOL_VERSIONS.includes(negotiated)) {
				throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH, `the service negotiated seam protocol ${negotiated}, which this boundary does not support (known: ${SEAM_PROTOCOL_VERSIONS.join(' | ')})`, { negotiated, known: [...SEAM_PROTOCOL_VERSIONS] });
			}
			if (negotiated !== SEAM_PROTOCOL_V0) {
				const missing = boundary.requiredCapabilities.filter((namespace) => !client.capabilities.includes(namespace));
				if (missing.length > 0) {
					throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `the service does not advertise required Agent OS capabilities: ${missing.join(', ')} (advertised: ${client.capabilities.join(' | ') || 'none'})`, { reason: 'required-capability-missing', missing, advertised: [...client.capabilities] });
				}
			}
			let lifecycle = null;
			if (negotiated !== SEAM_PROTOCOL_V0 && options.affirmLifecycle !== false) {
				lifecycle = await boundary.lifecycleInitialize();
			}
			boundary.startReport = { protocolVersion: negotiated, capabilities: [...client.capabilities], lifecycle, servicePid: client.pid };
			boundary.emit('connected', { generation: boundary.generation, protocolVersion: negotiated, capabilities: [...client.capabilities], servicePid: client.pid });
			return boundary;
		} catch (error) {
			await boundary.dispose().catch(() => undefined);
			throw error;
		}
	}

	/** @private bookkeeping + passthrough for one seam event envelope. */
	handleSeamEvent(event) {
		this.eventsReceived += 1;
		this.lastEventTs = event.ts;
		if (this.options.onEvent) {
			this.options.onEvent(event);
		}
	}

	/** @private proactive death detection for the LIVE generation only. */
	handleClientExit(client, code, error) {
		if (client !== this.client) {
			return;
		}
		this.lastExitFacts = { code, error: error instanceof Error ? error.message : null };
		const wasDead = this.dead;
		this.dead = true;
		for (const waiter of this.exitWaiters) {
			clearTimeout(waiter.timer);
			waiter.resolve(this.lastExitFacts);
		}
		this.exitWaiters = [];
		if (!wasDead && !this.closed) {
			this.emit('disconnected', { generation: this.generation, exitCode: code, spawnError: this.lastExitFacts.error });
		}
		this.options.onExit?.(code, error);
	}

	/**
	 * Bounded wait for the live generation's process exit (the supervision
	 * graceful-shutdown path): resolves the exit facts ({code, error}) when
	 * observed, or null on timeout. Never sends anything on the wire.
	 */
	waitExit(timeoutMs = 5000) {
		if (this.dead && this.lastExitFacts !== null) {
			return Promise.resolve(this.lastExitFacts);
		}
		return new Promise((resolve) => {
			const waiter = { timer: null, resolve };
			waiter.timer = setTimeout(() => {
				const index = this.exitWaiters.indexOf(waiter);
				if (index !== -1) {
					this.exitWaiters.splice(index, 1);
				}
				resolve(null);
			}, timeoutMs);
			if (typeof waiter.timer.unref === 'function') {
				waiter.timer.unref();
			}
			this.exitWaiters.push(waiter);
		});
	}

	emit(name, payload) {
		this.logger(`[agent-os-boundary] ${name}`);
		if (this.onBoundaryEventCallback) {
			this.onBoundaryEventCallback(boundaryEvent(name, payload));
		}
	}

	/** Negotiated seam protocol version of the live generation. */
	get protocolVersion() {
		return this.client === null ? null : this.client.protocolVersion;
	}

	/** Advertised capability namespaces (empty under v0 - no advertisement). */
	get capabilities() {
		return this.client === null ? [] : this.client.capabilities;
	}

	/** False once the supervised service process has exited (hook-driven). */
	get connected() {
		return this.client !== null && !this.dead && !this.closed;
	}

	/** OS pid of the live service process (supervision surface). */
	get servicePid() {
		return this.client === null ? undefined : this.client.pid;
	}

	/** Machine-readable diagnostic row for connectivity/degradation surfaces. */
	describe() {
		return {
			generation: this.generation,
			protocolVersion: this.protocolVersion,
			capabilities: [...this.capabilities],
			connected: this.connected,
			closed: this.closed,
			eventsReceived: this.eventsReceived,
			lastEventTs: this.lastEventTs,
			servicePid: this.servicePid,
		};
	}

	/**
	 * Issue one gated seam request. Throws BoundaryFailure on every failure
	 * path (never a raw transport error). `options.idempotencyKey` engages
	 * the attempt memo: terminal outcomes replay for the key's lifetime
	 * (even across recoveries - same key, same attempt, same outcome);
	 * outcome-unknown attempts reject fast on re-call.
	 */
	async call(method, args = {}, options = {}) {
		if (this.closed) {
			throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.NOT_CONNECTED, `the boundary is shut down; ${method} was not sent`, { method, phase: 'closed' });
		}
		const key = options.idempotencyKey;
		if (key !== undefined) {
			const memo = this.idempotency.get(key);
			if (memo !== undefined) {
				if (memo.state === 'in-flight') {
					return memo.promise;
				}
				if (memo.state === 'completed') {
					return memo.value;
				}
				// 'rejected' (definitive service answer) and 'unknown'
				// (lost side-effecting response) both stand for this key.
				throw memo.failure;
			}
		}
		if (this.dead) {
			throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.NOT_CONNECTED, `the service process has exited; recover() before ${method}`, { method, phase: 'dead', generation: this.generation });
		}
		const gate = gateSeamMethod(method, this.protocolVersion, this.capabilities);
		if (!gate.ok) {
			throw gate.failure;
		}
		const attempt = this.sendGated(method, args);
		if (key === undefined) {
			return attempt;
		}
		const record = { state: 'in-flight', promise: null, value: undefined, failure: undefined };
		this.idempotency.set(key, record);
		record.promise = attempt.then(
			(value) => {
				record.state = 'completed';
				record.value = value;
				record.promise = null;
				return value;
			},
			(error) => {
				const failure = error instanceof BoundaryFailure ? error : classifySendFailure(method, error);
				if (failure.code === BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN) {
					// Response lost on a side-effecting method: the attempt's
					// outcome is unknown FOREVER for this key - re-calls with
					// the same key reject fast instead of re-sending.
					record.state = 'unknown';
					record.failure = failure;
					record.promise = null;
				} else if (failure.code === BOUNDARY_FAILURE_CODES.SERVICE_DIED || failure.code === BOUNDARY_FAILURE_CODES.REQUEST_TIMEOUT) {
					// Nothing was written (never-delivered) or the loss is
					// side-effect-free (read-only/idempotent): the key may be
					// re-tried - the memo forgets the failed attempt.
					this.idempotency.delete(key);
				} else {
					// Definitive answer (seam-rejected / gate-class / other
					// terminal classes): the verdict stands for this key.
					record.state = 'rejected';
					record.failure = failure;
					record.promise = null;
				}
				throw failure;
			},
		);
		return record.promise;
	}

	/** @private raw send + failure classification (no memo, no gating). */
	async sendGated(method, args) {
		try {
			return await this.client.request(method, args);
		} catch (error) {
			if (error instanceof BoundaryFailure) {
				throw error;
			}
			const failure = classifySendFailure(method, error);
			if (failure.code === BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN) {
				// A written-but-unanswered side-effecting request: the process
				// is gone or wedged. Mark dead (fail-closed) so later calls
				// short-circuit; the caller reconciles via recover().
				this.markDead(failure);
			}
			throw failure;
		}
	}

	/** @private transition to dead exactly once, with the boundary event. */
	markDead(failure) {
		if (this.dead) {
			return;
		}
		this.dead = true;
		this.emit('disconnected', { generation: this.generation, code: failure.code, phase: failure.details?.phase ?? null });
	}

	// --- flauz.workspace.* (the durable work-item surface) ---

	async createTask(title, options = {}) {
		return this.call('flauz.workspace.createTask', { title }, options);
	}

	async appendEvent(taskId, event, options = {}) {
		return this.call('flauz.workspace.appendEvent', { taskId, event }, options);
	}

	async listTasks(options = {}) {
		return this.call('flauz.workspace.listTasks', {}, options);
	}

	async getTask(taskId, options = {}) {
		return this.call('flauz.workspace.getTask', { taskId }, options);
	}

	async appendEvidence(taskId, row, options = {}) {
		return this.call('flauz.workspace.appendEvidence', { taskId, row }, options);
	}

	async createCheckpoint(taskId, requestId, stopId = undefined, options = {}) {
		return this.call('flauz.workspace.createCheckpoint', { taskId, requestId, stopId }, options);
	}

	async verifyLedger(options = {}) {
		return this.call('flauz.workspace.verifyLedger', {}, options);
	}

	// --- flauz.a2a.* (typed wrappers; additive over the seam client) ---

	async a2aPost(message, options = {}) {
		return this.call('flauz.a2a.post', { message }, options);
	}

	async a2aCollect(agentId, consume = false, options = {}) {
		return this.call('flauz.a2a.collect', { agentId, consume }, options);
	}

	async a2aList(options = {}) {
		return this.call('flauz.a2a.list', {}, options);
	}

	// --- flauz.health.* / flauz.lifecycle.* (v1; the gate refuses them locally under v0) ---

	async healthPing(options = {}) {
		return this.call('flauz.health.ping', {}, options);
	}

	async healthStatus(options = {}) {
		return this.call('flauz.health.status', {}, options);
	}

	async lifecycleInitialize(options = {}) {
		return this.call('flauz.lifecycle.initialize', {}, options);
	}

	async lifecycleShutdown(options = {}) {
		return this.call('flauz.lifecycle.shutdown', {}, options);
	}

	/**
	 * Re-read the Agent OS's logical state over the seam (read-only,
	 * retryable): the task list, the ledger verdict, and (by default) the
	 * A2A mailbox view. A snapshot that cannot be read is a FAILURE - never
	 * a partially fabricated view.
	 */
	async snapshot(options = {}) {
		const includeA2a = options.includeA2a !== false;
		const tasks = await this.listTasks();
		const ledger = await this.verifyLedger();
		const a2a = includeA2a ? await this.a2aList() : null;
		return {
			tasks: tasks.tasks,
			ledger: ledger.ok ? { ok: true, rows: ledger.rows } : { ok: false, rows: ledger.rows, firstBadSeq: ledger.firstBadSeq },
			a2a: a2a === null ? null : { agents: a2a.agents },
		};
	}

	/**
	 * Recover the boundary (work order M3): dispose the suspect generation,
	 * re-spawn the REAL service, re-hello, re-negotiate, re-affirm
	 * capabilities, then RE-READ the logical state. Recovery is explicit
	 * and total - it never fabricates: whatever the re-read shows IS the
	 * state. Idempotent while in flight (concurrent calls share one pass).
	 *
	 * The event stream of the dead generation is unobservable from here on:
	 * an 'event-gap' boundary event is emitted (consumers re-read state; a
	 * replay surface is a documented extension candidate).
	 */
	async recover() {
		if (this.closed) {
			throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.NOT_CONNECTED, 'the boundary is shut down; recovery requires a new start()', { phase: 'closed' });
		}
		if (this.recovering !== null) {
			return this.recovering;
		}
		this.recovering = this.doRecover().finally(() => {
			this.recovering = null;
		});
		return this.recovering;
	}

	/** @private the actual recovery pass. */
	async doRecover() {
		this.stopHealthPoll();
		const previousGeneration = this.generation;
		const previousVersion = this.protocolVersion;
		const eventsReceivedBefore = this.eventsReceived;
		const lastEventTsBefore = this.lastEventTs;
		await this.client.dispose().catch(() => undefined);
		this.dead = true;
		this.emit('event-gap', { generation: previousGeneration, eventsReceived: eventsReceivedBefore, lastEventTs: lastEventTsBefore });
		const client = await AgentOsServiceBoundary.spawnClient(this, this.options);
		this.client = client;
		this.generation += 1;
		this.dead = false;
		this.emit('reconnected', { generation: this.generation, protocolVersion: client.protocolVersion });
		const negotiated = client.protocolVersion;
		if (!SEAM_PROTOCOL_VERSIONS.includes(negotiated)) {
			this.dead = true;
			throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH, `recovery negotiated seam protocol ${negotiated}, which this boundary does not support`, { negotiated, known: [...SEAM_PROTOCOL_VERSIONS] });
		}
		if (negotiated !== SEAM_PROTOCOL_V0) {
			const missing = this.requiredCapabilities.filter((namespace) => !client.capabilities.includes(namespace));
			if (missing.length > 0) {
				this.dead = true;
				throw new BoundaryFailure(BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `recovered service does not advertise required Agent OS capabilities: ${missing.join(', ')}`, { reason: 'required-capability-missing', missing, advertised: [...client.capabilities] });
			}
		}
		let lifecycle = null;
		if (negotiated !== SEAM_PROTOCOL_V0 && this.options.affirmLifecycle !== false) {
			lifecycle = await this.lifecycleInitialize();
		}
		const snapshot = await this.snapshot();
		this.emit('recovered', { generation: this.generation, protocolVersion: negotiated, protocolVersionChanged: negotiated !== previousVersion });
		return {
			generation: this.generation,
			protocolVersion: negotiated,
			capabilities: [...client.capabilities],
			protocolVersionChanged: negotiated !== previousVersion,
			lifecycle,
			snapshot,
			eventGap: true,
		};
	}

	/**
	 * Start a liveness watch: ping (health at v1, the legacy twin at v0)
	 * every intervalMs; the FIRST failure stops the poll and reports
	 * 'health-degraded' (fail-closed: the watch reports, it never retries).
	 */
	startHealthPoll(watch) {
		const intervalMs = watch?.intervalMs ?? 5000;
		this.stopHealthPoll();
		this.healthTimer = setInterval(() => {
			void this.healthTick(watch);
		}, intervalMs);
		if (typeof this.healthTimer.unref === 'function') {
			this.healthTimer.unref();
		}
		return this.healthTimer;
	}

	/** @private one poll tick. */
	async healthTick(watch) {
		if (this.closed || this.recovering !== null) {
			return;
		}
		if (this.dead) {
			// The supervised process is already known dead (exit hook):
			// that IS the degradation - report it, never skip it.
			this.stopHealthPoll();
			const failure = new BoundaryFailure(BOUNDARY_FAILURE_CODES.NOT_CONNECTED, 'the service process has exited (observed by the health watch)', { phase: 'dead', generation: this.generation });
			this.emit('health-degraded', { generation: this.generation, code: failure.code, phase: 'dead' });
			watch?.onUnhealthy?.(failure);
			return;
		}
		try {
			if (this.protocolVersion === SEAM_PROTOCOL_V0) {
				await this.call(LEGACY_PING);
			} else {
				await this.healthPing();
			}
		} catch (error) {
			this.stopHealthPoll();
			const failure = error instanceof BoundaryFailure ? error : classifySendFailure('flauz.health.ping', error);
			this.emit('health-degraded', { generation: this.generation, code: failure.code, phase: failure.details?.phase ?? null });
			if (failure.code === BOUNDARY_FAILURE_CODES.SERVICE_DIED || failure.code === BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN || failure.code === BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH) {
				this.markDead(failure);
			}
			watch?.onUnhealthy?.(failure);
		}
	}

	stopHealthPoll() {
		if (this.healthTimer !== null) {
			clearInterval(this.healthTimer);
			this.healthTimer = null;
		}
	}

	/**
	 * Graceful teardown: v1 lifecycle shutdown / v0 bare shutdown, then the
	 * bounded dispose wait. Idempotent.
	 */
	async shutdown() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.stopHealthPoll();
		if (!this.dead) {
			try {
				if (this.protocolVersion === SEAM_PROTOCOL_V0) {
					await this.client.request(LEGACY_SHUTDOWN, {});
				} else {
					await this.client.request('flauz.lifecycle.shutdown', {});
				}
				// The graceful command was answered; await the deferred exit
				// (bounded) instead of issuing a SECOND shutdown that could
				// race the exit and stall on a response that never comes.
				const exited = await this.waitExit(5000);
				if (exited === null) {
					// Wedged: the bounded dispose path (stdin end + kill).
					await this.client.dispose().catch(() => undefined);
				}
			} catch {
				// Best effort: dispose() below still ends stdin and reaps.
				await this.client.dispose().catch(() => undefined);
			}
		}
		this.dead = true;
		this.emit('shutdown', { generation: this.generation });
	}

	/** Best-effort teardown without the graceful command (supervision kill path). */
	async dispose() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.stopHealthPoll();
		await this.client.dispose().catch(() => undefined);
		this.dead = true;
	}
}
