/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz lease-conflict contract (TL2-F3, the TL2-004 follow-up).
 *
 * THE CONTRACT (the battery's INV-5 activation): concurrent claimants on one
 * lease get EXACTLY ONE winner; every loser receives an EXPLICIT, TYPED
 * conflict error - never a silent double-execution, never a dropped message.
 * Until this module landed, the flauz.a2a/v0 resource-claim surface was
 * informational-only by design (AGENT-INTEGRATION section 5 recorded
 * enforcement as a follow-up): a second claimant's acquire notice landed
 * next to the first with no conflict anywhere. This module is that
 * follow-up: the ONE law both enforcement surfaces speak.
 *
 * The two surfaces (one contract, two projections of "who holds the lease"):
 *  - the flauz.a2a CLAIM PATH (core/a2a.mjs): A2ABus.post of a
 *    resource-claim acquire is evaluated against the journal-projected
 *    active lease of the resource. A live foreign lease throws the typed
 *    conflict; a same-claimant re-acquire lands (the DL-72 reuse posture);
 *    an expired or released lease does not conflict (the takeover). A
 *    release/expire notice from a non-holder of a LIVE lease is refused the
 *    same way - a foreign release clearing the holder's lease would be a
 *    silent takeover (fail-closed, always).
 *  - the STORE LEASE TRANSITIONS (core/orchStore.mjs): acquireLease /
 *    acquireClaim evaluate the same law against the replay-derived graph
 *    state. A live foreign holder's claim mints the evidence-bearing
 *    conflict-noticed row FIRST (DL-60: the refusal is recorded history,
 *    not a dropped message) and THEN throws the typed error carrying the
 *    current holder, the lease id and the deadline. An expired lease is
 *    taken over through the expiry hygiene (the mechanical lease-expired row
 *    is recorded, then the acquisition lands with the next ordinal lease id
 *    - the takeover is recorded). A same-holder re-acquire REUSES the active
 *    lease (DL-72: a retry of the same durable step never conflicts with
 *    itself).
 *
 * THE TYPED ERROR belongs to the established closed-set failure taxonomy
 * posture (DL-59's fail-closed mapping law): LeaseConflictError SUBCLASSES
 * OrchestrationError and carries the domain code 'illegal-transition' - the
 * conflict IS structurally an illegal transition attempt - so the orch
 * protocol mediator maps it into the closed set exactly like every other
 * domain refusal (flauz.orch.err.illegal-transition, provenance preserved),
 * while direct callers get the CONFLICT-SPECIFIC typed facts on the same
 * error: who holds (holder), which lease (leaseId), until when (deadline -
 * epoch ms, or null when the hold is deadline-less and only an explicit
 * release ends it, the DL-66 posture), who was refused (claimant). The
 * conflict identity itself is 'flauz.a2a.lease-conflict' (conflictCode) -
 * the a2a surface's own namespace, exactly like 'flauz.a2a/v0' itself.
 *
 * Fail-closed, always: the error is an honest refusal - no auto-grant, no
 * silent takeover, no policy weakening, no trust-gate bypass (the conflict
 * is orthogonal to the approval gates; INV-4's posture is untouched).
 *
 * Zero-dependency (nothing but the language); pure law functions + the
 * composed claim op. Imported by core/a2a.mjs and core/orchStore.mjs; the
 * .d.mts sibling carries the hand-written types.
 */

import { leaseIdOf, OrchestrationError } from './orchestration.mjs';

/** The conflict identity of the typed error (the a2a surface's own namespace). */
export const LEASE_CONFLICT_CODE = 'flauz.a2a.lease-conflict';

/** The violation classes (mirrors the journal's CONFLICT_VIOLATIONS closed set). */
export const LEASE_CONFLICT_VIOLATIONS = ['lease', 'claim'];

/**
 * The typed conflict error. Carries the facts a concurrent claimant needs to
 * understand the refusal honestly: WHO holds the resource (holder), WHICH
 * lease (leaseId), until WHEN (deadline - epoch ms, or null when the holder
 * is deadline-less and only a human decision ends the hold, the DL-66
 * posture), and WHO was refused (claimant).
 *
 * A subclass of OrchestrationError (domain code 'illegal-transition' - the
 * closed-set taxonomy posture, DL-59) so the existing protocol mappings keep
 * recognizing it; the conflict-specific typed facts ride the same error.
 */
export class LeaseConflictError extends OrchestrationError {
	constructor(facts) {
		super(leaseConflictMessage(facts), 'illegal-transition');
		this.conflictCode = LEASE_CONFLICT_CODE;
		this.resource = facts.resource;
		this.violation = LEASE_CONFLICT_VIOLATIONS.includes(facts.violation) ? facts.violation : 'lease';
		this.holder = facts.holder;
		this.leaseId = facts.leaseId;
		this.deadline = facts.deadline === undefined ? null : facts.deadline;
		this.claimant = facts.claimant;
		this.attempt = facts.attempt === undefined ? null : facts.attempt;
	}
}

/** True when the thrown value is a typed lease conflict (instance or shape). */
export function isLeaseConflictError(error) {
	if (error instanceof LeaseConflictError) {
		return true;
	}
	return error !== null
		&& typeof error === 'object'
		&& error.conflictCode === LEASE_CONFLICT_CODE
		&& typeof error.holder === 'string'
		&& typeof error.leaseId === 'string'
		&& (typeof error.deadline === 'number' || error.deadline === null)
		&& typeof error.resource === 'string';
}

/** The plain, assertable facts of a typed conflict (the serialization-safe projection). */
export function leaseConflictFacts(error) {
	if (!isLeaseConflictError(error)) {
		return null;
	}
	return {
		code: LEASE_CONFLICT_CODE,
		resource: error.resource,
		violation: error.violation,
		holder: error.holder,
		leaseId: error.leaseId,
		deadline: error.deadline,
		claimant: error.claimant,
	};
}

/** The deterministic message (facts-carrying; keeps the 'is active' phrasing of the landed law). */
function leaseConflictMessage(facts) {
	const deadline = facts.deadline === undefined || facts.deadline === null
		? 'no deadline (a deadline-less hold - only an explicit release ends it; a human decides)'
		: `deadline ${String(facts.deadline)} (epoch ms)`;
	const held = facts.violation === 'claim'
		? `while claim ${facts.leaseId} is active (claims are exclusive; held by ${facts.holder} with ${deadline})`
		: `while lease ${facts.leaseId} is active (held by ${facts.holder} until ${deadline})`;
	const attempt = facts.attempt === undefined || facts.attempt === null ? '' : ` (attempted action: ${String(facts.attempt)})`;
	return `the claim by ${facts.claimant} on resource ${facts.resource} is refused with the typed conflict ${LEASE_CONFLICT_CODE}: ${held}, no other claimant may acquire${attempt}`;
}

// ---------------------------------------------------------------------------
// The law (pure; the single decision table both surfaces apply)
// ---------------------------------------------------------------------------

/**
 * Is the lease live at `now`? A deadline-less lease (null) holds until an
 * explicit release - a human decides (the DL-66 posture); a deadline-bearing
 * lease is live strictly before its deadline (the DL-61 expiry semantics:
 * expiry is an observed deadline passage; this projection only ANSWERS the
 * liveness question for a caller-supplied observation time, it never grants
 * or takes over anything by itself).
 */
export function isLeaseLive(deadline, now) {
	if (deadline === null || deadline === undefined) {
		return true;
	}
	return now < deadline;
}

/**
 * Evaluate one claim attempt against the active lease of a resource.
 *
 * @param {object} input
 *   - active: the active lease record {holder, leaseId, deadline} or undefined
 *     (deadline: epoch ms or null for a deadline-less hold)
 *   - claimant: the claiming agent id
 *   - now: the observation time (epoch ms) the caller evaluates at
 *     (bus posture only - see recordedExpiry)
 *   - resource: the shared-resource id (provenance in the conflict facts)
 *   - recordedExpiry: the STORE posture (true) - the journal's recorded state
 *     is the truth: a lease is EXPIRED only when its expiry is RECORDED
 *     (op / drive loop / recovery pass, DL-61), so a recorded-active lease
 *     conflicts regardless of the wall clock and the takeover goes through
 *     the expiry hygiene (run the recovery pass, then re-claim). The BUS
 *     posture (false, the default) - the notice journal has no expiry
 *     recording, so the acquire notice's leaseUntil deadline IS the expiry
 *     observation: at/past the deadline the lease does not conflict.
 * @returns one of
 *   - { ok: true, outcome: 'acquired' }  no active lease: the claim acquires
 *   - { ok: true, outcome: 'reused' }    the SAME holder re-claims its
 *     recorded lease: DL-72 - a retry of the same durable step reuses the
 *     active lease and never conflicts with itself
 *   - { ok: true, outcome: 'takeover' }  (bus posture) the lease's deadline
 *     has passed: an expired lease does not conflict; the claimant takes
 *     over (the new acquire supersedes the projection)
 *   - { ok: false, conflict }            a lease held by ANOTHER holder
 *     (live at the observation - or recorded-active under the store
 *     posture): the typed refusal (the full facts shape)
 */
export function evaluateLeaseClaim(input) {
	const active = input.active;
	if (active === undefined || active === null) {
		return { ok: true, outcome: 'acquired' };
	}
	if (active.holder === input.claimant) {
		return { ok: true, outcome: 'reused' };
	}
	if (input.recordedExpiry !== true && !isLeaseLive(active.deadline, input.now)) {
		return { ok: true, outcome: 'takeover' };
	}
	return {
		ok: false,
		conflict: {
			code: LEASE_CONFLICT_CODE,
			resource: input.resource,
			violation: 'lease',
			holder: active.holder,
			leaseId: active.leaseId,
			deadline: active.deadline === undefined ? null : active.deadline,
			claimant: input.claimant,
		},
	};
}

// ---------------------------------------------------------------------------
// The composed claim op (the flauz.a2a claim path over a durable step)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The bus resource id of a graph step (the routing-module convention, verbatim). */
export function stepResourceId(graphId, stepId) {
	return `flauz-orch/${graphId}/${stepId}`;
}

/**
 * Claim the step's resource lease through the flauz.a2a claim path: the ONE
 * product surface that composes the store's durable lease state (the DL-60
 * evidence discipline) with the bus notice (the a2a watcher mirror). This is
 * the journey the Agent OS battery's INV-5 drives.
 *
 * Order of guarantees (inside the store's transition lock, the STORE
 * posture - the journal's recorded state is the truth):
 *   - a foreign lease that is RECORDED-ACTIVE (its expiry row has not
 *     landed): the refusal is RECORDED HISTORY FIRST (one evidence-bearing
 *     conflict-noticed row - preview-before-mint, the recomputable sha256
 *     linkage, serialized by this lock), then the caller receives the typed
 *     LeaseConflictError (holder, leaseId, deadline). The conflict is never
 *     a dropped message. The typed error carries the deadline: when the
 *     deadline has passed, the takeover goes through the EXISTING expiry
 *     hygiene - run the recovery pass (or the drive-loop expiry) so the
 *     lease-expired row lands, then re-claim and acquire (DL-61: expiry from
 *     op + drive loop + recovery pass; the takeover is recorded);
 *   - the SAME holder re-claiming: DL-72 lease reuse - the active lease is
 *     returned as-is (no second lease row, no self-conflict, no notice);
 *   - a free resource: the evidence-bearing lease-acquired row lands (the
 *     durable primary fact), then the acquire notice posts on the bus (the
 *     watcher mirror; the bus enforces its own journal too - a raw poster
 *     that raced the notice journal surfaces its typed conflict here, and
 *     the durable lease stands for the winner: a retry by the same claimant
 *     reuses it).
 *
 * @param {import('./orchStore.mjs').OrchestrationStore} store the orchestration store (the lease authority)
 * @param {import('./a2a.mjs').A2ABus} bus the a2a bus (the claim surface)
 * @param {object} input {graphId, stepId, claimant, ttlMs, actor?, origin, toAgent?}
 * @returns {status: 'acquired'|'reused', leaseId, holder, deadline, rowId, noticeId}
 */
export async function claimStepLease(store, bus, input) {
	if (!isPlainObject(input)) {
		throw new OrchestrationError('claimStepLease requires {graphId, stepId, claimant, ttlMs, actor?, origin, toAgent?}', 'invalid-params');
	}
	if (!isNonEmptyString(input.graphId) || !isNonEmptyString(input.stepId)) {
		throw new OrchestrationError('claimStepLease requires a graphId and stepId', 'invalid-params');
	}
	if (typeof input.claimant !== 'string' || !AGENT_ID.test(input.claimant)) {
		throw new OrchestrationError(`claimStepLease claimant must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} (got ${JSON.stringify(input.claimant)})`, 'invalid-params');
	}
	if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
		throw new OrchestrationError('claimStepLease ttlMs must be a positive integer (epoch ms)', 'invalid-params');
	}
	if (!isNonEmptyString(input.origin)) {
		throw new OrchestrationError('claimStepLease origin must be a non-empty provenance string (e.g. a2a:<agentId>)', 'invalid-params');
	}
	if (bus === null || typeof bus.post !== 'function') {
		throw new OrchestrationError('claimStepLease requires an a2a bus port ({ post({message}) })', 'invalid-params');
	}
	return store.withTransitionLock(async () => {
		const graph = store.requireGraph(input.graphId);
		store.requireStep(graph, input.stepId);
		const now = store.clock();
		const resource = stepResourceId(input.graphId, input.stepId);
		const state = store.stateOf(input.graphId);
		const lease = state.leases[input.stepId];
		const active = lease === undefined ? undefined : { holder: lease.holder, leaseId: lease.leaseId, deadline: lease.expiresAt };
		const verdict = evaluateLeaseClaim({ active, claimant: input.claimant, now, resource, recordedExpiry: true });
		if (verdict.ok === false) {
			// the refusal is recorded history FIRST (DL-60: evidence-bearing, one row,
			// preview-before-mint inside this lock), then the typed refusal surfaces.
			await store.appendEvidenceBearingRowLocked('conflict-noticed', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: 'service',
				origin: input.origin,
				payload: {
					violation: 'lease',
					expectedHolder: active.holder,
					actualRunner: input.claimant,
					note: `flauz.a2a lease-conflict on ${resource}: lease ${active.leaseId} is active (held by ${active.holder} until ${String(active.deadline)}); the claim by ${input.claimant} is refused with the typed conflict ${LEASE_CONFLICT_CODE}`,
				},
			});
			throw new LeaseConflictError(verdict.conflict);
		}
		if (verdict.outcome === 'reused') {
			// DL-72: a retry of the same durable step reuses the active lease
			// (the row that LAST set the lease facts: the acquisition, or the
			// latest renewal).
			let lastFactsRow = null;
			for (const row of store.journalRows) {
				if (row.type === 'lease-acquired' && row.graphId === input.graphId && row.stepId === input.stepId && row.payload.leaseId === lease.leaseId) {
					lastFactsRow = row;
				}
			}
			return {
				status: 'reused',
				leaseId: lease.leaseId,
				holder: lease.holder,
				deadline: lease.expiresAt,
				rowId: lastFactsRow === null ? null : lastFactsRow.rowId,
				noticeId: null,
			};
		}
		const ordinal = (state.leasesSeen[input.stepId] ?? 0) + 1;
		const leaseId = leaseIdOf(input.graphId, input.stepId, ordinal);
		const deadline = now + input.ttlMs;
		const row = await store.appendEvidenceBearingRowLocked('lease-acquired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId, holder: input.claimant, expiresAt: deadline },
		});
		// the a2a notice (the watcher mirror of the durable fact; the bus enforces
		// its own journal - a raw claimant that raced the notice journal surfaces
		// its typed conflict here, and the durable lease stands for the winner)
		const posted = bus.post({
			message: {
				kind: 'resource-claim',
				from: input.claimant,
				to: input.toAgent ?? 'flauz.watchers',
				ts: now,
				payload: { action: 'acquire', resource, leaseUntil: deadline },
			},
		});
		return {
			status: 'acquired',
			leaseId,
			holder: input.claimant,
			deadline,
			rowId: row.rowId,
			noticeId: posted.id,
		};
	});
}
