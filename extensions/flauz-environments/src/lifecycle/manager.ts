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
		}
		this.envelope = envelope;
		this.records = records;
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
	 * typed errors; every accepted attempt (success OR failure) is recorded
	 * in the ops ledger with MANDATORY provenance and returned as a typed
	 * outcome.
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
		const envelope = this.assertBootstrapped();
		const fromState = envelope.entries[request.id]?.state ?? 'registered';
		const now = this.clock();
		const ctx: ExecutorOpContext = { actor, now };
		const base = {
			schemaVersion: LIFECYCLE_SCHEMA_VERSION,
			schema: 'flauz.environments-ops/v0',
			ts: now,
			actor,
			op: opName,
			environmentId: request.id,
			fromState,
		};

		// -- accepted attempt: everything from here is ledger-recorded --
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
				message: `environment '${request.id}' has trust posture 'untrusted' — ${opName} is rejected fail-closed (re-register with a trusted posture or review the descriptor; SECURITY-MODEL 3.4)`,
			});
		}
		if ((opName === 'start' || opName === 'attach') && !descriptor.enabled) {
			return await recordError({ code: 'ENVIRONMENT_DISABLED', message: `environment '${request.id}' is disabled — ${opName} is rejected (enable the descriptor first)` });
		}

		// transient phase persistence (crash mid-start/stop reconciles as stale)
		const transient = transientPhase(fromState, opName);
		if (transient !== undefined) {
			await this.patchEntry(request.id, transient, now, executor.executorKind);
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
		// typed terminal failure path below.
		const effect = await this.runExecutorOpBounded(executor, opName, descriptor, ctx, {
			base,
			inFlightState: transient ?? fromState,
			executorKind: executor.executorKind,
		});

		if (!effect.ok) {
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

	private async runExecutorOpBounded(executor: EnvironmentExecutor, op: EnvironmentOpName, descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext, window: RetryWindowContext): Promise<ExecutorEffectResult> {
		const maxAttempts = this.providerRetryMaxAttempts;
		let ordinal = 1;
		let waitAppliedMs = 0;
		for (;;) {
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
