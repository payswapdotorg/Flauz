/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/leaseConflict.mjs` (the TL2-F3 lease-conflict
 * contract). Hand-written per the zero-dependency discipline (the
 * contracts.d.mts pattern): the .mjs is never loaded from shipped extension
 * code; tests and the battery import the runtime module directly and get
 * these types via the sibling-declaration resolution.
 */

import type { OrchestrationError } from './orchestration.d.mts';
import type { OrchestrationStore } from './orchStore.d.mts';
import type { A2ABus } from './a2a.d.mts';

/** The conflict identity of the typed error (the a2a surface's own namespace). */
export declare const LEASE_CONFLICT_CODE: 'flauz.a2a.lease-conflict';

/** The violation classes (the journal's CONFLICT_VIOLATIONS closed set). */
export declare const LEASE_CONFLICT_VIOLATIONS: ['lease', 'claim'];

/** The facts of one typed lease conflict (the assertable shape). */
export interface LeaseConflictFacts {
	/** The shared-resource id the conflict is over. */
	resource: string;
	/** The violation class: 'lease' (TTL hold) | 'claim' (deadline-less hold). */
	violation: 'lease' | 'claim';
	/** The CURRENT holder's identity (the agent id that holds the lease). */
	holder: string;
	/** The active lease (or claim) id. */
	leaseId: string;
	/** The lease deadline (epoch ms), or null when the hold is deadline-less (a human decides). */
	deadline: number | null;
	/** The refused claimant's identity. */
	claimant: string;
	/** The attempted action when the refusal is not an acquire (e.g. a foreign release). */
	attempt?: string | null;
}

/**
 * The typed conflict error: a subclass of OrchestrationError (domain code
 * 'illegal-transition' - the closed-set taxonomy posture, DL-59) carrying the
 * conflict-specific typed facts. An honest refusal: no auto-grant, no silent
 * takeover, no policy weakening.
 */
export declare class LeaseConflictError extends OrchestrationError {
	/** Constructs from the conflict facts (the typed fields ride the error). */
	constructor(facts: LeaseConflictFacts);
	/** The conflict identity (flauz.a2a.lease-conflict; distinct from the taxonomy domain code). */
	conflictCode: 'flauz.a2a.lease-conflict';
	resource: string;
	violation: 'lease' | 'claim';
	holder: string;
	leaseId: string;
	deadline: number | null;
	claimant: string;
	attempt: string | null;
}

/** True when the thrown value is a typed lease conflict (instance or shape). */
export declare function isLeaseConflictError(error: unknown): boolean;

/** The plain, assertable facts of a typed conflict (null when not a conflict). */
export declare function leaseConflictFacts(error: unknown): LeaseConflictFacts | null;

/**
 * Is the lease live at `now`? A deadline-less lease (null) holds until an
 * explicit release (a human decides, the DL-66 posture); a deadline-bearing
 * lease is live strictly before its deadline.
 */
export declare function isLeaseLive(deadline: number | null | undefined, now: number): boolean;

/** The evaluation of one claim attempt against the active lease of a resource. */
export type LeaseClaimEvaluation =
	| { ok: true; outcome: 'acquired' }
	| { ok: true; outcome: 'reused' }
	| { ok: true; outcome: 'takeover' }
	| { ok: false; conflict: LeaseConflictFacts & { code: 'flauz.a2a.lease-conflict' } };

/** The single decision table both enforcement surfaces apply (the one law). */
export declare function evaluateLeaseClaim(input: {
	active: { holder: string; leaseId: string; deadline: number | null } | undefined;
	claimant: string;
	now: number;
	resource: string;
	/** The STORE posture (true): a lease is expired only when its expiry is RECORDED (DL-61) - a recorded-active lease conflicts regardless of the wall clock. The BUS posture (default): the notice's leaseUntil deadline IS the expiry observation. */
	recordedExpiry?: boolean;
}): LeaseClaimEvaluation;

/** The bus resource id of a graph step (the routing-module convention, verbatim). */
export declare function stepResourceId(graphId: string, stepId: string): string;

/** The outcome of one claim through the composed flauz.a2a claim path. */
export interface ClaimStepLeaseResult {
	status: 'acquired' | 'takeover' | 'reused';
	leaseId: string;
	holder: string;
	deadline: number;
	rowId: string | null;
	noticeId: string | null;
}

/**
 * Claim the step's resource lease through the flauz.a2a claim path: the ONE
 * product surface composing the store's durable lease state (the DL-60
 * evidence discipline) with the bus notice (the a2a watcher mirror). Throws
 * the typed LeaseConflictError AFTER the refusal is journaled as
 * evidence-bearing history.
 */
export declare function claimStepLease(store: OrchestrationStore, bus: A2ABus, input: {
	graphId: string;
	stepId: string;
	claimant: string;
	ttlMs: number;
	actor?: string;
	origin: string;
	toAgent?: string;
}): Promise<ClaimStepLeaseResult>;
