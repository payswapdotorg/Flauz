/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the environment lifecycle manager (the orchestrator).
 *
 * Owns the state machine, the provenance law and the PIN-2 persistence;
 * dispatches the EFFECT to an `EnvironmentExecutor`. Pure TypeScript,
 * vscode-free, ports injected (FileSystemPort/Clock), tested against the
 * in-memory FileSystemPort.
 *
 * Operation protocol (typed results, never raw throws at the boundary):
 *
 *   PRE-FLIGHT (schema rejections — thrown as `EnvironmentLifecycleError`,
 *   nothing recorded, nothing mutated):
 *     - unknown op                       -> OP_UNKNOWN
 *     - missing/invalid actor            -> ACTOR_REQUIRED / ACTOR_INVALID
 *     - environment not in the registry  -> ENVIRONMENT_UNKNOWN
 *     - no executor / no opt-in          -> NO_EXECUTOR / SIMULATED_NOT_OPTED_IN
 *     - op overlaps an in-flight op    -> OP_IN_FLIGHT (the interleaving
 *                                         law: one mutating op per
 *                                         environment at a time — concurrent
 *                                         commits could otherwise interleave
 *                                         and violate the state machine).
 *                                         DL-81 EXCEPTION: a `destroy` issued
 *                                         while a NON-terminal op is in flight
 *                                         is NOT rejected — it supersedes: it
 *                                         mints the cooperative cancellation
 *                                         on the in-flight attempt, awaits its
 *                                         CANCELLED completion (and defensive
 *                                         reap), then proceeds as the terminal
 *                                         op. Every other pair keeps the D1
 *                                         law (reject, never interleave).
 *     - cancel() with nothing in flight -> OP_NOT_IN_FLIGHT (DL-81)
 *
 *   POST-ACCEPTANCE (ledger-recorded error lines, state changes only per the
 *   transition table — returned as `{ ok: false, error }` outcomes):
 *     - illegal transition               -> ILLEGAL_TRANSITION (fromState == toState)
 *     - untrusted start/attach           -> TRUST_POSTURE_REJECTED (fail-closed,
 *                                           the message NAMES the posture)
 *     - disabled start/attach            -> ENVIRONMENT_DISABLED
 *     - executor effect failure          -> start/stop land in `failed`; the
 *                                           other ops keep the current state.
 *
 * Executor resolution (honesty law): real executors serve by default; the
 * simulated remote executors require an EXPLICIT opt-in (`simulated: true`
 * on the request, or the manager's `simulatedDefault` wired from the
 * flauz.environments.simulated setting). Remote kinds without an opt-in
 * resolve their REAL executor (TL3-004 rung 1: ssh-local -> ssh-cli,
 * container -> docker-cli, cloud-sandbox -> cloud-http) — which fails
 * closed with typed `CLI_NOT_AVAILABLE` / `DAEMON_UNREACHABLE` /
 * `VAULT_REF_UNRESOLVED` errors when the binary/daemon/keys are absent
 * (capability detection is first-class: never a silent fallback, never a
 * crash). A kind served ONLY by a simulated executor with no opt-in still
 * fails closed with SIMULATED_NOT_OPTED_IN — no fake claims of real
 * remote control.
 */
import type { Clock, EnvironmentDescriptor, EnvironmentKind, FileSystemPort } from '../api.ts';
import { EnvironmentRegistry } from '../registry.ts';
import { ENVIRONMENT_OPS, EnvironmentLifecycleError, LIFECYCLE_SCHEMA_ID, LIFECYCLE_SCHEMA_VERSION, PROVENANCE_ACTORS, type DescribeReport, type DescribeVerdict, type EnvironmentOpError, type EnvironmentOpName, type EnvironmentOpOutcome, type EnvironmentOpRecord, type ExecutorEffectError, type ExecutorEffectResult, type ExecutorOpDetail, type LifecycleEnvelope, type LifecycleEntry, type ProvenanceActor, phaseOf } from './types.ts';

import { LifecycleStore } from './store.ts';
import { failureState, successState, transientPhase, transitionFor } from './stateMachine.ts';

import { defaultRetryWait, formatProviderRetryAttemptMessage, isRetryableProviderStatus, providerRetryWaitMs, readProviderRetryHint, resolveRetryBound, type ProviderRetryOptions, type RetryWaitPort } from './providerRetry.ts';
import type { EnvironmentExecutor, ExecutorOpContext } from './executor.ts';
import { cancelledEffect, mintCancellationPort, readCancellationFacts, type CancellationPortMint, type ExecutorCancellationPort } from './executor.ts';

export interface EnvironmentLifecycleManagerOptions {
	/** The booted descriptor registry (trust + kind lookups). */
	readonly registry: EnvironmentRegistry;
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
	/** Executors available to this manager (real + simulated). */
	readonly executors: readonly EnvironmentExecutor[];
	/**
	 * Default simulated opt-in (wired from the flauz.environments.simulated
	 * setting in extension.ts; per-request `simulated` wins). Default false.
		 */
	readonly simulatedDefault?: boolean;
	/**
	 * TL2-F2B (ADDITIVE) — the bounded provider-retry window config: the
	 * manager's provider-facing op path retries a RETRYABLE typed provider
	 * error (the executor's structured providerRetryHint — at this seam the
	 * cloud executor's CLOUD_PROVIDER_ERROR from a transient HTTP class,
	 * 5xx/429) up to `maxAttempts` TOTAL attempts (default 3), recording
	 * every attempt of an engaged window in the ops ledger. Absent -> the
	 * default bound; `{ maxAttempts: 1 }` is the off-switch (byte-identical
	 * single-shot — the additivity law); an INVALID config is a typed
	 * fail-closed constructor throw (RETRY_CONFIG_INVALID), never a silent
	 * default-masking. See src/lifecycle/providerRetry.ts for the contract.
	 */
	readonly providerRetry?: ProviderRetryOptions;
	/**
	 * TL2-F2B (ADDITIVE) — the injectable wait port between retry attempts
	 * (default: the real timer). Tests, the battery and the drills inject a
	 * deterministic port so the test path never really sleeps.
	 */
	readonly providerRetryWait?: RetryWaitPort;
}

/** A mutating lifecycle request (id + MANDATORY provenance). */
export interface LifecycleOpRequest {
	readonly id: string;
	readonly actor?: unknown;
	readonly simulated?: boolean;
}

/** TL2-F2B — the per-request facts an engaged retry window records under. */
interface RetryWindowContext {
	readonly base: { readonly schemaVersion: number; readonly schema: string; readonly actor: ProvenanceActor; readonly environmentId: string };
	readonly inFlightState: string;
	readonly executorKind: string;
}

/**
 * DL-81 / P2-FIX-109 — one accepted in-flight attempt: its outcome promise,
 * its op name (the destroy-supersede rule needs the terminal/non-terminal
 * distinction) and the cooperative cancellation port the manager minted for
 * it (the cancel mint is manager-only; the executor only observes).
 */
interface InFlightAttempt {
	readonly promise: Promise<EnvironmentOpOutcome>;
	readonly op: EnvironmentOpName;
	readonly port: CancellationPortMint;
}

const RECORDED_ERROR_MESSAGE_MAX = 300;

function requireActor(op: string, actor: unknown): ProvenanceActor {
	if (actor === undefined || actor === null || actor === '') {
		throw new EnvironmentLifecycleError('ACTOR_REQUIRED', `op '${op}' requires a provenance actor (agent|human|tool) — every operation is provenance-carrying`);
	}
	if (typeof actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(actor)) {
		throw new EnvironmentLifecycleError('ACTOR_INVALID', `actor must be one of agent|human|tool (got ${JSON.stringify(actor)})`);
	}
	return actor as ProvenanceActor;
}

/** The environment lifecycle orchestrator. */
export class EnvironmentLifecycleManager {
	private readonly registry: EnvironmentRegistry;
	private readonly store: LifecycleStore;
	private readonly clock: Clock;
	private readonly executors: readonly EnvironmentExecutor[];
	private readonly simulatedDefault: boolean;
	/** TL2-F2B — the resolved provider-retry window bound (total attempts). */
	private readonly providerRetryMaxAttempts: number;
	/** TL2-F2B — the injectable wait port between retry attempts. */
	private readonly providerRetryWait: RetryWaitPort;
	private envelope: LifecycleEnvelope | undefined;
	private records: readonly EnvironmentOpRecord[] = [];
	/** One mutating op per environment at a time (the interleaving law) + the DL-81 cancellation port per attempt. */
	private readonly inFlight = new Map<string, InFlightAttempt>();

	constructor(options: EnvironmentLifecycleManagerOptions) {
		this.registry = options.registry;
		this.store = new LifecycleStore({ root: options.root, fs: options.fs, clock: options.clock });
		this.clock = options.clock ?? (() => Date.now());
		this.executors = options.executors;
		this.simulatedDefault = options.simulatedDefault ?? false;
		this.providerRetryMaxAttempts = resolveRetryBound(options.providerRetry); // typed fail-closed on invalid config
		this.providerRetryWait = options.providerRetryWait ?? defaultRetryWait;
	}

	/** Loads + validates the PIN-2 pair (idempotent). Fails closed on corruption. */
	async bootstrap(): Promise<void> {
		if (this.envelope !== undefined) {
			return;
		}
		const { envelope, records } = await this.store.load();
		for (const [envId, entry] of Object.entries(envelope.entries)) {
			if (entry.lastOpRef > records.length) {
				throw new EnvironmentLifecycleError('STORE_CORRUPT', `entries['${envId}'].lastOpRef ${entry.lastOpRef} is dangling (the ops ledger holds ${records.length} line(s))`);
			}
			const absorbed = records[entry.lastOpRef - 1];
			if (absorbed === undefined || absorbed.environmentId !== envId) {
				throw new EnvironmentLifecycleError('STORE_CORRUPT', `entries['${envId}'].lastOpRef ${entry.lastOpRef} does not reference this environment's own ledger record (the PIN-2 pair is inconsistent)`);
			}
		}
		const reconciled = EnvironmentLifecycleManager.reconcileWithLedgerTail(envelope, records);
		if (reconciled !== undefined) {
			// torn-write recovery (see reconcileWithLedgerTail): the append-only
			// ledger is the truth — adopt it DURABLY before serving any op
			this.envelope = reconciled;
			this.records = records;
			await this.store.writeEnvelope(reconciled);
			return;
		}
		this.envelope = envelope;
		this.records = records;
	}

	/**
	 * Torn-write recovery: commit() appends the ledger line FIRST and persists
	 * the envelope SECOND — a crash between the two leaves ledger records
	 * beyond an entry's lastOpRef. The append-only ledger (re-validated on
	 * every append) is the truth: recover each entry to the LAST ledger record
	 * for its environment (the record's toState is the settled state), so no
	 * environment stays in a pre-op state the ledger says was superseded — in
	 * particular no environment stays non-terminal when the ledger records a
	 * destroy-ok. A crash mid-transient reconciles honestly too: the tail
	 * record of an unsettled op is its retry-attempt row (fromState == toState
	 * == the transient phase), so the entry keeps the transient phase and the
	 * describe/stop/destroy probes own the reconciliation from there.
	 * Returns undefined when the pair is already consistent.
	 */
	private static reconcileWithLedgerTail(envelope: LifecycleEnvelope, records: readonly EnvironmentOpRecord[]): LifecycleEnvelope | undefined {
		let changed = false;
		const entries: Record<string, LifecycleEntry> = { ...envelope.entries };
		for (const [envId, entry] of Object.entries(envelope.entries)) {
			let tailIndex = -1;
			for (let i = entry.lastOpRef; i < records.length; i++) {
				if (records[i]!.environmentId === envId) {
					tailIndex = i;
				}
			}
			if (tailIndex === -1) {
				continue;
			}
			const tail = records[tailIndex]!;
			entries[envId] = {
				state: tail.toState,
				updatedAt: tail.ts,
				executorKind: entry.executorKind,
				lastOpRef: tailIndex + 1,
			};
			changed = true;
		}
		return changed ? { ...envelope, entries } : undefined;
	}

	private assertBootstrapped(): LifecycleEnvelope {
		if (this.envelope === undefined) {
			throw new EnvironmentLifecycleError('STORE_CORRUPT', 'lifecycle not bootstrapped (call bootstrap() first)');
		}
		return this.envelope;
	}

	/** The full lifecycle state of an environment ('registered' pre-entry). */
	stateOf(id: string): string {
		return this.entryOf(id)?.state ?? 'registered';
	}

	entryOf(id: string): LifecycleEntry | undefined {
		return this.assertBootstrapped().entries[id];
	}

	/** All lifecycle entries (the view reads this). */
	entries(): Readonly<Record<string, LifecycleEntry>> {
		return this.assertBootstrapped().entries;
	}

	/** The ledger record at a 1-based line number (lastOpRef lookup). */
	opAt(ref: number): EnvironmentOpRecord | undefined {
		return this.records[ref - 1];
	}

	/** All ledger records (drills + reports). */
	ops(): readonly EnvironmentOpRecord[] {
		return this.records;
	}

	/** The record store paths (diagnostics). */
	get storePaths(): { readonly envelope: string; readonly ops: string } {
		return { envelope: this.store.envelopePath, ops: this.store.opsLedgerPath };
	}

	// -- executor resolution ---------------------------------------------------

	private resolveExecutor(kind: EnvironmentKind, simulated: boolean | undefined): EnvironmentExecutor {
		const serving = this.executors.filter(executor => executor.kinds.includes(kind));
		if (serving.length === 0) {
			throw new EnvironmentLifecycleError('NO_EXECUTOR', `no executor serves kind '${kind}' in this manager (TL3-004 rung 1 ships real executors — ssh-cli, docker-cli, cloud-http — plus local-process and the simulated drills; check the wiring in extension.ts bootManagers)`);
		}
		const wantSimulated = simulated ?? this.simulatedDefault;
		const pick = wantSimulated
			? serving.find(executor => executor.infrastructureClass === 'simulated')
			: serving.find(executor => executor.infrastructureClass === 'real');
		if (pick !== undefined) {
			return pick;
		}
		if (wantSimulated) {
			throw new EnvironmentLifecycleError('NO_EXECUTOR', `no simulated executor serves kind '${kind}'`);
		}
		throw new EnvironmentLifecycleError('SIMULATED_NOT_OPTED_IN', `kind '${kind}' is served in this manager only by TEST-INFRASTRUCTURE simulated executors (no real executor instance was provided — the real remote providers landed in TL3-004 rung 1 as ssh-cli/docker-cli/cloud-http, which fail closed with CLI_NOT_AVAILABLE/VAULT_REF_UNRESOLVED when the binary/keys are absent) — pass { simulated: true } (or enable flauz.environments.simulated) to drive the drill executor`);
	}

	private descriptorFor(id: string): EnvironmentDescriptor {
		const descriptor = this.registry.get(id);
		if (descriptor === undefined) {
			throw new EnvironmentLifecycleError('ENVIRONMENT_UNKNOWN', `environment '${id}' is not registered`);
		}
		return descriptor;
	}

	// -- the mutating ops -------------------------------------------------------

	/**
	 * Performs one mutating lifecycle op. Pre-flight schema failures throw
	 * typed errors; every accepted attempt (success, failure OR CANCELLED —
	 * DL-81) is recorded in the ops ledger with MANDATORY provenance and
	 * returned as a typed outcome.
	 */
	async perform(op: unknown, request: LifecycleOpRequest): Promise<EnvironmentOpOutcome> {
		if (typeof op !== 'string' || !(ENVIRONMENT_OPS as readonly string[]).includes(op)) {
			throw new EnvironmentLifecycleError('OP_UNKNOWN', `unknown lifecycle op ${JSON.stringify(op)} (expected one of ${ENVIRONMENT_OPS.join('|')})`);
		}
		const opName = op as EnvironmentOpName;
		const actor = requireActor(opName, request.actor);
		if (typeof request.id !== 'string' || request.id.length === 0) {
			throw new EnvironmentLifecycleError('OP_INVALID', `op '${opName}' requires the environment id`);
		}
		const descriptor = this.descriptorFor(request.id);
		const executor = this.resolveExecutor(descriptor.kind, request.simulated);
		let envelope = this.assertBootstrapped();
		let fromState = envelope.entries[request.id]?.state ?? 'registered';
		let now = this.clock();

		// -- accepted attempt: everything from here is ledger-recorded --
		// ONE mutating op per environment at a time (the interleaving law): a
		// second op issued while one is in flight is a typed PRE-FLIGHT
		// rejection. Without the guard, two overlapping performs interleave
		// their commits — a start landing after a destroy-ok would resurrect a
		// destroyed envelope and record an impossible ledger sequence (the
		// machine's terminal states must hold).
		//
		// DL-81 / P2-FIX-109 — the destroy-supersede rule: a `destroy` issued
		// while a NON-terminal op is in flight on the same environment is NOT
		// OP_IN_FLIGHT-rejected (terminal decisiveness — a destroy must never
		// wait out a wedged start): it mints the cooperative cancellation on
		// the in-flight attempt, awaits its CANCELLED completion (the attempt
		// records its own cancelled ledger line; its executor defensively
		// reaps at the observation checkpoint), and then proceeds as the
		// terminal op over the settled envelope. Every other op pair keeps
		// the D1 interleaving law unchanged (reject, never interleave).
		if (opName === 'destroy') {
			const superseded = this.inFlight.get(request.id);
			if (superseded !== undefined && superseded.op !== 'destroy') {
				await this.cancelAttempt(superseded, actor, 'destroy-supersede');
				// the cancelled attempt's record moved the envelope (a cancelled
				// start/stop settles through the existing failure-state law) —
				// recompute the destroy's facts from the settled truth
				envelope = this.assertBootstrapped();
				fromState = envelope.entries[request.id]?.state ?? 'registered';
				now = this.clock();
			}
		}
		if (this.inFlight.has(request.id)) {
			throw new EnvironmentLifecycleError('OP_IN_FLIGHT', `op '${opName}' on '${request.id}' overlaps an op already in flight on this environment — concurrent lifecycle ops on one environment are rejected fail-closed (await the in-flight op, then retry)`);
		}
		// The check-then-set below is synchronous (no await between), so
		// exactly one op per environment is ever inside the accepted
		// section; the caller awaits the in-flight op, then retries.
		const port = mintCancellationPort();
		const attempt = this.performAccepted(opName, request.id, descriptor, executor, fromState, now, actor, port);
		this.inFlight.set(request.id, { promise: attempt, op: opName, port });
		try {
			return await attempt;
		} finally {
			this.inFlight.delete(request.id);
		}
	}

	/**
	 * DL-81 / P2-FIX-109 — cancels the in-flight lifecycle op on an
	 * environment. COOPERATIVE, NEVER A PREEMPTIVE KILL: the cancellation
	 * is minted on the attempt's port and the executor observes it at its
	 * next effect checkpoint (pre-spawn, post-spawn/pre-confirm, between
	 * provider-retry rounds), returning the typed OP_CANCELLED effect —
	 * the manager then records the attempt with `result: 'cancelled'`
	 * settling through the existing failure-state law. Provenance is
	 * mandatory exactly as on every accepted attempt; typed
	 * `OP_NOT_IN_FLIGHT` when nothing is in flight. Resolves to the
	 * attempt's own outcome once it settles — an effect that completed
	 * before observing the mint resolves to its own honest outcome (the
	 * checkpoint miss-window law).
	 */
	async cancel(request: { readonly id: string; readonly actor?: unknown }): Promise<EnvironmentOpOutcome> {
		const actor = requireActor('cancel', request.actor);
		if (typeof request.id !== 'string' || request.id.length === 0) {
			throw new EnvironmentLifecycleError('OP_INVALID', `op 'cancel' requires the environment id`);
		}
		this.descriptorFor(request.id);
		this.assertBootstrapped();
		const attempt = this.inFlight.get(request.id);
		if (attempt === undefined) {
			throw new EnvironmentLifecycleError('OP_NOT_IN_FLIGHT', `no lifecycle op is in flight on '${request.id}' — cancel targets the in-flight op (its executor observes the cooperative cancellation at its next effect checkpoint; never a preemptive kill)`);
		}
		return await this.cancelAttempt(attempt, actor, 'cancel');
	}

	/** Mints the cooperative cancellation on an in-flight attempt and awaits its settled outcome (the attempt records its own ledger line). */
	private async cancelAttempt(attempt: InFlightAttempt, actor: ProvenanceActor, reason: string): Promise<EnvironmentOpOutcome> {
		attempt.port.cancel(actor, reason);
		return await attempt.promise;
	}

	/** The accepted-attempt body (one-per-environment, gated by perform). */
	private async performAccepted(opName: EnvironmentOpName, id: string, descriptor: EnvironmentDescriptor, executor: EnvironmentExecutor, fromState: string, now: number, actor: ProvenanceActor, port: CancellationPortMint): Promise<EnvironmentOpOutcome> {
		const ctx: ExecutorOpContext = { actor, now, cancellation: port.port };
		const base = {
			schemaVersion: LIFECYCLE_SCHEMA_VERSION,
			schema: 'flauz.environments-ops/v0',
			ts: now,
			actor,
			op: opName,
			environmentId: id,
			fromState,
		};

		const recordError = async (error: EnvironmentOpError): Promise<EnvironmentOpOutcome> => {
			const record: EnvironmentOpRecord = { ...base, result: 'error', toState: fromState, error };
			await this.commit(record, fromState, executor.executorKind);
			return { ok: false, record, error };
		};

		try {
			transitionFor(fromState, opName); // throws ILLEGAL_TRANSITION
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			const message = raw.startsWith(`${LIFECYCLE_SCHEMA_ID}: `) ? raw.slice(`${LIFECYCLE_SCHEMA_ID}: `.length) : raw;
			return await recordError({ code: 'ILLEGAL_TRANSITION', message });
		}

		if ((opName === 'start' || opName === 'attach') && descriptor.trust.posture === 'untrusted') {
			return await recordError({
				code: 'TRUST_POSTURE_REJECTED',
				message: `environment '${id}' has trust posture 'untrusted' — ${opName} is rejected fail-closed (re-register with a trusted posture or review the descriptor; SECURITY-MODEL 3.4)`,
			});
		}
		if ((opName === 'start' || opName === 'attach') && !descriptor.enabled) {
			return await recordError({ code: 'ENVIRONMENT_DISABLED', message: `environment '${id}' is disabled — ${opName} is rejected (enable the descriptor first)` });
		}

		// transient phase persistence (crash mid-start/stop reconciles as stale)
		const transient = transientPhase(fromState, opName);
		if (transient !== undefined) {
			await this.patchEntry(id, transient, now, executor.executorKind);
		}

		// TL2-F2B — the bounded, recorded provider-retry window over the
		// executor effect: engages ONLY when the executor surfaces a
		// RETRYABLE typed provider error (a well-formed providerRetryHint
		// whose status is a transient HTTP class — 5xx/429). Absent,
		// malformed and non-retryable hints, a thrown executor
		// (outcome-unknown — never retried blindly) and a bound of 1 keep
		// the pre-F2B single-shot honest path BYTE-IDENTICALLY (the
		// additivity law). Every attempt of an engaged window is recorded
		// in the ops ledger; exhaustion resolves through the unchanged
		// typed terminal failure path below. DL-81: the window observes
		// the cancellation port between rounds — a cancelled op is never
		// retried (the typed CANCELLED effect resolves the window).
		const effect = await this.runExecutorOpBounded(executor, opName, descriptor, ctx, {
			base,
			inFlightState: transient ?? fromState,
			executorKind: executor.executorKind,
		}, port.port);

		if (!effect.ok) {
			if (readCancellationFacts(effect.error) !== null) {
				// DL-81 / P2-FIX-109 — the cancelled attempt records
				// `result: 'cancelled'` (distinct from 'error'): the typed
				// OP_CANCELLED error carries the partial-effect facts and the
				// cancelling actor's provenance; the envelope settles through
				// the EXISTING failure-state law (a cancelled start lands
				// `failed` — cancellation never fabricates completion, never a
				// silent healthy state).
				const toState = failureState(fromState, opName);
				const message = effect.error.message.length > RECORDED_ERROR_MESSAGE_MAX
					? `${effect.error.message.slice(0, RECORDED_ERROR_MESSAGE_MAX - 1)}…`
					: effect.error.message;
				const record: EnvironmentOpRecord = {
					...base,
					result: 'cancelled',
					toState,
					error: { code: effect.error.code, message },
				};
				await this.commit(record, toState, executor.executorKind);
				return { ok: false, record, error: record.error! };
			}
			const toState = failureState(fromState, opName);
			const message = effect.error.message.length > RECORDED_ERROR_MESSAGE_MAX
				? `${effect.error.message.slice(0, RECORDED_ERROR_MESSAGE_MAX - 1)}…`
				: effect.error.message;
			const record: EnvironmentOpRecord = {
				...base,
				result: 'error',
				toState,
				error: { code: effect.error.code, message },
			};
			await this.commit(record, toState, executor.executorKind);
			return { ok: false, record, error: record.error! };
		}

		const toState = successState(fromState, opName);
		const record: EnvironmentOpRecord = { ...base, result: 'ok', toState };
		await this.commit(record, toState, executor.executorKind);
		return { ok: true, record, detail: effect.detail };
	}

	private async runExecutorOp(executor: EnvironmentExecutor, op: EnvironmentOpName, descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext) {
		switch (op) {
			case 'create': return await executor.create(descriptor, ctx);
			case 'start': return await executor.start(descriptor, ctx);
			case 'stop': return await executor.stop(descriptor, ctx);
			case 'attach': return await executor.attach(descriptor, ctx);
			case 'detach': return await executor.detach(descriptor, ctx);
			case 'snapshot': return await executor.snapshot(descriptor, ctx);
			case 'destroy': return await executor.destroy(descriptor, ctx);
		}
	}

	// -- the bounded provider-retry window (TL2-F2B) ---------------------------------

	private async runExecutorOpBounded(executor: EnvironmentExecutor, op: EnvironmentOpName, descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext, window: RetryWindowContext, cancellation: ExecutorCancellationPort): Promise<ExecutorEffectResult> {
		const maxAttempts = this.providerRetryMaxAttempts;
		let ordinal = 1;
		let waitAppliedMs = 0;
		for (; ;) {
			let effect: ExecutorEffectResult;
			try {
				effect = await this.runExecutorOp(executor, op, descriptor, ctx);
			} catch (err) {
				// a thrown executor (lost response) is NEVER retried blindly: the
				// outcome is unknown, so re-issuing could double-apply the effect
				// (the precedent's DL-53 posture) — the typed EXECUTOR_THREW
				// failure rides the existing single-shot honest path.
				return { ok: false, error: { code: 'EXECUTOR_THREW', message: `executor '${executor.executorKind}' threw during ${op}: ${err instanceof Error ? err.message : String(err)}` } };
			}
			if (effect.ok) {
				// first-attempt success, or a within-window recovery: the
				// request-level ok row closes the window (the successful
				// attempt's ordinal is reconstructable from the preceding
				// attempt row's next-attempt marker — the pinned key set
				// carries no ordinal field; stated in the lane REPORT).
				return effect;
			}
			const hint = readProviderRetryHint(effect.error);
			if (hint === null || !isRetryableProviderStatus(hint.status) || maxAttempts <= 1) {
				// no trigger: absent/malformed/non-retryable hint, or the
				// off-switch (bound 1) — the single-shot honest path,
				// byte-identical to the pre-F2B manager (no attempt rows).
				return effect;
			}
			const exhausted = ordinal >= maxAttempts;
			await this.recordRetryAttempt(window, op, ordinal, maxAttempts, effect.error, waitAppliedMs, exhausted);
			if (exhausted) {
				// exhaustion IS the existing typed terminal failure: the effect
				// flows into the unchanged failure path (the request-level
				// error row + failureState + the typed outcome) — never a
				// silent success, never an auto-pass.
				return effect;
			}
			const waitMs = providerRetryWaitMs(hint);
			await this.providerRetryWait(waitMs);
			// DL-81 / P2-FIX-109 — the between-provider-retry-rounds
			// checkpoint: a cancellation minted during the inter-attempt
			// wait is observed BEFORE the next round re-issues the effect
			// — the provider-retry window NEVER retries a cancelled op.
			if (cancellation.cancelled) {
				return cancelledEffect(cancellation, 'provider-retry-window', `op '${op}' cancelled between retry attempts — no further provider calls issued`);
			}
			ordinal += 1;
			waitAppliedMs = waitMs;
		}
	}

	/**
	 * Appends one ops-ledger attempt row of an ENGAGED retry window (the
	 * pinned key set exactly — the ordinal/bound/wait/next facts ride the
	 * error.message in the providerRetry grammar, the typed outcome is the
	 * row's error.code; state-preserving on the in-flight phase).
	 */
	private async recordRetryAttempt(window: RetryWindowContext, op: EnvironmentOpName, ordinal: number, maxAttempts: number, error: ExecutorEffectError, waitAppliedMs: number, exhausted: boolean): Promise<void> {
		const message = formatProviderRetryAttemptMessage(
			{ ordinal, maxAttempts, op, code: error.code, waitAppliedMs, ...(exhausted ? {} : { nextAttemptOrdinal: ordinal + 1 }) },
			error.message,
		);
		const capped = message.length > RECORDED_ERROR_MESSAGE_MAX
			? `${message.slice(0, RECORDED_ERROR_MESSAGE_MAX - 1)}…`
			: message;
		const record: EnvironmentOpRecord = {
			schemaVersion: window.base.schemaVersion,
			schema: window.base.schema,
			ts: this.clock(),
			actor: window.base.actor,
			op,
			environmentId: window.base.environmentId,
			result: 'error',
			fromState: window.inFlightState,
			toState: window.inFlightState,
			error: { code: error.code, message: capped },
		};
		await this.commit(record, window.inFlightState, window.executorKind);
	}

	/** Appends the record + persists the entry + caches (the commit path). */
	private async commit(record: EnvironmentOpRecord, toState: string, executorKind: string): Promise<void> {
		const envelope = this.assertBootstrapped();
		const lineNo = await this.store.appendOp(record);
		const entries = { ...envelope.entries };
		if (toState === 'registered') {
			// a failed create leaves no entry minted (pre-entry state)
			delete entries[record.environmentId];
		} else {
			entries[record.environmentId] = {
				state: toState,
				updatedAt: record.ts,
				executorKind,
				lastOpRef: lineNo,
			};
		}
		this.envelope = { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt: record.ts, entries };
		this.records = [...this.records, record];
		await this.store.writeEnvelope(this.envelope);
	}

	/** Persists an in-flight (transient) phase without a ledger line. */
	private async patchEntry(id: string, state: string, updatedAt: number, executorKind: string): Promise<void> {
		const envelope = this.assertBootstrapped();
		const previous = envelope.entries[id];
		if (previous === undefined) {
			throw new EnvironmentLifecycleError('OP_INVALID', `transient state '${state}' requires an existing entry for '${id}'`);
		}
		const entries = { ...envelope.entries };
		entries[id] = { state, updatedAt, executorKind, lastOpRef: previous.lastOpRef };
		this.envelope = { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt, entries };
		await this.store.writeEnvelope(this.envelope);
	}

	// -- describe (the health/state probe) ---------------------------------------

	/**
	 * Describes an environment: lifecycle state + backing-truth health +
	 * last op. Never silently healthy: when the persisted state claims
	 * liveness but the executor's probe says the truth is gone, the
	 * `stale` (or `orphan`) verdict is surfaced, and no state is mutated —
	 * reconciliation is an explicit stop/destroy.
		 */
	async describe(request: { readonly id: string }): Promise<DescribeReport> {
		const descriptor = this.descriptorFor(request.id);
		const envelope = this.assertBootstrapped();
		const entry = envelope.entries[request.id];
		const state = entry?.state ?? 'registered';
		const lastOp = entry === undefined ? undefined : this.opAt(entry.lastOpRef);
		let verdict: DescribeVerdict;
		if (entry === undefined) {
			verdict = { health: 'not-created', state, pid: null, message: `environment '${request.id}' is registered but not created (no lifecycle entry)` };
		} else if (state === 'destroyed') {
			verdict = { health: 'destroyed', state, pid: null, message: 'environment destroyed (terminal tombstone)' };
		} else {
			// describe resolves the executor that OWNS the persisted entry
			// (a read-only probe over already-persisted truth — no simulated
			// opt-in is required to look, only to drive).
			const executor = this.executors.find(candidate => candidate.executorKind === entry.executorKind);
			if (executor === undefined) {
				verdict = {
					health: 'stale',
					state,
					pid: null,
					message: `lifecycle entry names executor '${entry.executorKind}' which is not available — backing truth not verifiable (fail-closed, never silently healthy)`,
				};
			} else {
				verdict = await executor.probe(descriptor);
				// never silently healthy: a persisted live-ish state with a
				// dead/absent backing truth downgrades to `stale`.
				const lifecyclePhase = phaseOf(state);
				const disagrees = (verdict.health === 'healthy' && lifecyclePhase !== 'running')
					|| (verdict.health === 'not-running' && (lifecyclePhase === 'running' || lifecyclePhase === 'starting' || lifecyclePhase === 'stopping'));
				if (disagrees) {
					verdict = {
						...verdict,
						health: 'stale',
						message: `lifecycle state '${state}' disagrees with backing truth '${verdict.state}' (${verdict.message})`,
					};
				}
			}
		}
		return {
			environmentId: descriptor.id,
			kind: descriptor.kind,
			trust: descriptor.trust.posture,
			state,
			executorKind: entry?.executorKind ?? 'none',
			verdict,
			...(lastOp === undefined ? {} : { lastOp }),
		};
	}
}

/** Re-exported single import site for the executor port (consumers + tests). */
export type { EnvironmentExecutor, ExecutorOpContext };
