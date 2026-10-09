/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-001 Free Inference Fabric contracts: the typed capacity
 * disclosure contract - per-provider capacity snapshot states, the
 * reset-schedule vocabulary, the mandatory provenance of the
 * selected provider/model, and the pure user-facing disclosure
 * projection (contract module, the labContracts discipline).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'):
 * - THE OBSERVABILITY LAW: free capacity is provider-dependent and
 *   must remain honest and observable. This module DEFINES the
 *   vocabulary a user may be shown: capacity state per provider,
 *   reset expectations, and the provenance of the selected
 *   provider/model.
 * - THE NO-HIDDEN-SUBSTITUTION LAW: every disclosure carries a
 *   MANDATORY InferenceProvenance record naming the requested and
 *   the actual provider/model. A differing actual selection labeled
 *   as 'none' (a hidden substitution) is rejected fail-closed; a
 *   disclosed substitution is honest and permitted.
 * - THE UNVERIFIED-DEFAULT LAW: external provider metadata is
 *   untrusted until verified. 'unverified' is the default
 *   verification state, and 'unknown' is a first-class typed state
 *   - never a silent null, never an undefined, never a guess.
 * - Resets are provider-dependent: the reset-schedule vocabulary is
 *   honest about what is not known ('provider-discretion',
 *   'unknown').
 * - Determinism: no Math.random, no Date.now, no new Date, no
 *   process.env in this module. All timestamps are injected
 *   plain-number epoch milliseconds; all ids are injected strings.
 *   Boundary math is inclusive.
 * - Zero I/O, zero network, zero storage: pure functions only.
 *   This family DEFINES vocabulary - it is not a runtime, not an
 *   engine, not a scheduler, not a router, not a key pool, not a
 *   second authority. No shared public Flauz gateway pooling
 *   third-party free-tier keys is modeled here or anywhere.
 * - Zero-dependency: this module pulls in nothing from other
 *   modules. The contract-set version shared with the sibling
 *   planSemantics module is re-declared here and pinned
 *   structurally by the test suite (the COMMAND_FACADE idiom).
 * - Every persisted record carries contractVersion.
 */

/**
 * Version of the inference-semantics contract set (all modules
 * carry it; the sibling planSemantics module exports the same
 * value and the test suite pins the copies equal).
 */
export const INFERENCE_SEMANTICS_CONTRACTS_VERSION = '1.0.0';

/** Closed health-state vocabulary (per provider). */
export const PROVIDER_HEALTH_STATES = ['healthy', 'degraded', 'cooldown', 'unknown'] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

/**
 * Closed provider-metadata verification vocabulary. External
 * provider metadata is untrusted until verified: 'unverified' is
 * the DEFAULT state; 'verified' is only reached through an explicit
 * verification receipt (a one-way promotion, never a silent flip).
 */
export const PROVIDER_METADATA_VERIFICATIONS = ['unverified', 'verified'] as const;
export type ProviderMetadataVerification = (typeof PROVIDER_METADATA_VERIFICATIONS)[number];

/** Closed cooldown-reason vocabulary. */
export const COOLDOWN_REASONS = ['quota-exhausted', 'rate-limited', 'provider-error', 'manual-hold'] as const;
export type CooldownReason = (typeof COOLDOWN_REASONS)[number];

/**
 * One quota window: fixed or rolling, with injected epoch-ms
 * boundaries. The math treats [start, start + length] as INCLUSIVE
 * on both ends.
 */
export interface QuotaWindowSpec {
	readonly kind: 'fixed' | 'rolling';
	readonly windowStartEpochMs: number;
	readonly windowLengthMs: number;
}

/** A known quota state: non-negative integer counts inside a window. */
export interface KnownQuota {
	readonly state: 'known';
	readonly remaining: number;
	readonly limit: number;
	readonly window: QuotaWindowSpec;
}

/**
 * The unknown quota state: first-class, typed, honest. A silent
 * null or a zero default would lie about capacity.
 */
export interface UnknownQuota {
	readonly state: 'unknown';
}

export type QuotaState = KnownQuota | UnknownQuota;

/** An active cooldown: reason plus injected inclusive epoch-ms bounds. */
export interface ActiveCooldown {
	readonly state: 'active';
	readonly reason: CooldownReason;
	readonly sinceEpochMs: number;
	readonly untilEpochMs: number;
}

/** The no-cooldown state: typed absence, never a silent null. */
export interface NoCooldown {
	readonly state: 'none';
}

export type CooldownState = ActiveCooldown | NoCooldown;

/** Closed reset-schedule kind vocabulary. */
export const RESET_SCHEDULE_KINDS = [
	'fixed-instant',
	'interval-aligned',
	'provider-discretion',
	'unknown',
] as const;
export type ResetScheduleKind = (typeof RESET_SCHEDULE_KINDS)[number];

/** A reset at one fixed injected instant. */
export interface FixedInstantReset {
	readonly kind: 'fixed-instant';
	readonly atEpochMs: number;
}

/**
 * A reset repeating every intervalMs from an injected anchor (e.g.
 * aligned hourly/daily windows). The next reset from a probe time
 * is the smallest anchor + k*interval at or after the probe
 * (INCLUSIVE: a probe exactly on a boundary names that boundary).
 */
export interface IntervalAlignedReset {
	readonly kind: 'interval-aligned';
	readonly anchorEpochMs: number;
	readonly intervalMs: number;
}

/**
 * The provider resets at its own discretion: honest vocabulary for
 * 'the schedule exists but is not published'; never a guess.
 */
export interface ProviderDiscretionReset {
	readonly kind: 'provider-discretion';
}

/** The unknown reset schedule: first-class, typed, honest. */
export interface UnknownReset {
	readonly kind: 'unknown';
}

export type ResetSchedule = FixedInstantReset | IntervalAlignedReset | ProviderDiscretionReset | UnknownReset;

/**
 * The per-provider capacity snapshot: the typed state one provider
 * was observed in. Resets are provider-dependent; every timestamp
 * is an injected epoch-ms number (this module never reads a
 * clock). Carries the contract-set version stamp and the
 * provider-metadata verification state (untrusted until verified).
 */
export interface ProviderCapacitySnapshot {
	readonly contractVersion: string;
	readonly providerId: string;
	readonly verification: ProviderMetadataVerification;
	readonly health: ProviderHealthState;
	readonly quota: QuotaState;
	readonly cooldown: CooldownState;
	readonly resetSchedule: ResetSchedule;
	readonly observedAtEpochMs: number;
}

/** Closed substitution-state vocabulary. */
export const SUBSTITUTION_STATES = ['none', 'disclosed'] as const;
export type SubstitutionState = (typeof SUBSTITUTION_STATES)[number];

/**
 * The MANDATORY provenance of the selected provider/model: what was
 * requested, what actually serves, and the honest substitution
 * label. A hidden substitution (differing actual selection labeled
 * 'none') is rejected fail-closed by admitProvenance. Carries the
 * contract-set version stamp.
 */
export interface InferenceProvenance {
	readonly contractVersion: string;
	readonly requestedProviderId: string;
	readonly requestedModelId: string;
	readonly actualProviderId: string;
	readonly actualModelId: string;
	readonly substitution: SubstitutionState;
	readonly modelVerification: ProviderMetadataVerification;
	readonly recordedAtEpochMs: number;
}

/** Closed user-facing capacity-state vocabulary. */
export const DISCLOSED_CAPACITY_STATES = [
	'available',
	'limited',
	'exhausted',
	'cooldown',
	'unknown',
] as const;
export type DisclosedCapacityState = (typeof DISCLOSED_CAPACITY_STATES)[number];

/** A known reset expectation: the next reset epoch, with its basis. */
export interface KnownResetExpectation {
	readonly kind: 'known';
	readonly nextResetEpochMs: number;
	readonly basis: 'fixed-instant' | 'interval-aligned';
}

/** The unknown reset expectation: first-class, typed, honest. */
export interface UnknownResetExpectation {
	readonly kind: 'unknown';
}

export type ResetExpectation = KnownResetExpectation | UnknownResetExpectation;

/**
 * The disclosure projection: what a user may be shown for one
 * provider. Carries the capacity state, the reset expectation, and
 * the MANDATORY provenance verbatim - no hidden substitution can
 * survive this projection. generatedAtEpochMs is the injected
 * generation time. Carries the contract-set version stamp.
 */
export interface ProviderCapacityDisclosure {
	readonly contractVersion: string;
	readonly providerId: string;
	readonly health: ProviderHealthState;
	readonly verification: ProviderMetadataVerification;
	readonly capacityState: DisclosedCapacityState;
	readonly quotaRemaining: number | 'unknown';
	readonly resetExpectation: ResetExpectation;
	readonly provenance: InferenceProvenance;
	readonly generatedAtEpochMs: number;
}

/**
 * The honest default snapshot: everything unknown, provider
 * metadata unverified. Deterministic; stamps the contract-set
 * version; never reads a clock (observedAtEpochMs is injected).
 * Throws TypeError on an empty providerId or a non-finite
 * timestamp (fail-closed factory).
 */
export function unknownSnapshot(providerId: string, observedAtEpochMs: number): ProviderCapacitySnapshot {
	if (!isNonEmptyString(providerId)) {
		throw new TypeError('unknownSnapshot: providerId must be a non-empty string');
	}
	if (!isFiniteEpochMs(observedAtEpochMs)) {
		throw new TypeError('unknownSnapshot: observedAtEpochMs must be a finite number');
	}
	return {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		providerId,
		verification: 'unverified',
		health: 'unknown',
		quota: { state: 'unknown' },
		cooldown: { state: 'none' },
		resetSchedule: { kind: 'unknown' },
		observedAtEpochMs,
	};
}

/** Injected inputs for the unverifiedProvenance constructor. */
export interface UnverifiedProvenanceInput {
	readonly requestedProviderId: string;
	readonly requestedModelId: string;
	readonly actualProviderId: string;
	readonly actualModelId: string;
	readonly recordedAtEpochMs: number;
}

/**
 * The honest default provenance: model verification defaults to
 * 'unverified' (the unverified-default law) and the substitution
 * label is derived honestly by construction - a differing actual
 * selection is labeled 'disclosed' at construction, so this
 * constructor can never produce a hidden substitution. Throws
 * TypeError on empty ids or a non-finite timestamp (fail-closed
 * factory).
 */
export function unverifiedProvenance(input: UnverifiedProvenanceInput): InferenceProvenance {
	if (
		!isNonEmptyString(input.requestedProviderId)
		|| !isNonEmptyString(input.requestedModelId)
		|| !isNonEmptyString(input.actualProviderId)
		|| !isNonEmptyString(input.actualModelId)
	) {
		throw new TypeError(
			'unverifiedProvenance: requested/actual provider and model ids must be non-empty strings',
		);
	}
	if (!isFiniteEpochMs(input.recordedAtEpochMs)) {
		throw new TypeError('unverifiedProvenance: recordedAtEpochMs must be a finite number');
	}
	return {
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		requestedProviderId: input.requestedProviderId,
		requestedModelId: input.requestedModelId,
		actualProviderId: input.actualProviderId,
		actualModelId: input.actualModelId,
		substitution: sameSelection(input) ? 'none' : 'disclosed',
		modelVerification: 'unverified',
		recordedAtEpochMs: input.recordedAtEpochMs,
	};
}

/**
 * The one-way verification promotion: unverified -> verified. Pure
 * copy transition - every other field is preserved verbatim,
 * including the substitution label (verification never rewrites
 * provenance). Idempotent: a verified record stays verified. There
 * is deliberately NO demotion transition: a stale verification must
 * be re-derived from a fresh record, never silently downgraded.
 */
export function markProvenanceVerified(provenance: InferenceProvenance): InferenceProvenance {
	return { ...provenance, modelVerification: 'verified' };
}

/**
 * Pure inclusive-boundary verdict: does the quota window contain
 * atEpochMs? Boundaries are INCLUSIVE on both ends:
 *   windowStartEpochMs <= atEpochMs <= windowStartEpochMs + windowLengthMs
 * Fail-closed: a non-finite probe, a malformed window (non-finite
 * numbers, negative length) contains nothing (false).
 */
export function quotaWindowContains(window: QuotaWindowSpec, atEpochMs: number): boolean {
	if (!isFiniteEpochMs(atEpochMs) || !isRecord(window)) {
		return false;
	}
	const spec = window as Record<string, unknown>;
	if (
		!isFiniteEpochMs(spec.windowStartEpochMs)
		|| !isFiniteEpochMs(spec.windowLengthMs)
		|| (spec.windowLengthMs as number) < 0
	) {
		return false;
	}
	return (
		(spec.windowStartEpochMs as number) <= atEpochMs
		&& atEpochMs <= (spec.windowStartEpochMs as number) + (spec.windowLengthMs as number)
	);
}

/**
 * Pure reset projection: the next reset epoch from a probe time, or
 * 'unknown' (first-class, never a guess). Boundary semantics are
 * INCLUSIVE: a probe exactly at a reset instant names that instant.
 *   fixed-instant:     at or before the instant -> the instant;
 *                      past it -> 'unknown' (stale: that reset
 *                      already happened, the next is
 *                      provider-dependent)
 *   interval-aligned:  the smallest anchor + k*interval at or
 *                      after the probe (k >= 0)
 *   provider-discretion / unknown / malformed / non-finite probe:
 *                      'unknown'
 */
export function nextResetAt(schedule: ResetSchedule, atEpochMs: number): number | 'unknown' {
	if (!isRecord(schedule) || !isFiniteEpochMs(atEpochMs)) {
		return 'unknown';
	}
	const spec = schedule as Record<string, unknown>;
	if (spec.kind === 'fixed-instant') {
		if (!isFiniteEpochMs(spec.atEpochMs)) {
			return 'unknown';
		}
		return atEpochMs <= (spec.atEpochMs as number) ? (spec.atEpochMs as number) : 'unknown';
	}
	if (spec.kind === 'interval-aligned') {
		const anchorEpochMs = spec.anchorEpochMs;
		const intervalMs = spec.intervalMs;
		if (
			!isFiniteEpochMs(anchorEpochMs)
			|| !isFiniteEpochMs(intervalMs)
			|| (intervalMs as number) <= 0
		) {
			return 'unknown';
		}
		if (atEpochMs <= (anchorEpochMs as number)) {
			return anchorEpochMs as number;
		}
		const deltaMs = atEpochMs - (anchorEpochMs as number);
		const steps = Math.ceil(deltaMs / (intervalMs as number));
		return (anchorEpochMs as number) + steps * (intervalMs as number);
	}
	return 'unknown';
}

/**
 * Pure inclusive-boundary verdict: is the cooldown active at
 * atEpochMs? Boundaries are INCLUSIVE on both ends:
 *   sinceEpochMs <= atEpochMs <= untilEpochMs
 * Fail-closed: a non-finite probe, a malformed cooldown, or an
 * inverted cooldown (until before since) is inactive (false).
 */
export function cooldownActive(cooldown: CooldownState, atEpochMs: number): boolean {
	if (!isFiniteEpochMs(atEpochMs) || !isRecord(cooldown)) {
		return false;
	}
	const spec = cooldown as Record<string, unknown>;
	if (spec.state !== 'active') {
		return false;
	}
	if (
		!isFiniteEpochMs(spec.sinceEpochMs)
		|| !isFiniteEpochMs(spec.untilEpochMs)
		|| (spec.untilEpochMs as number) < (spec.sinceEpochMs as number)
	) {
		return false;
	}
	return (
		(spec.sinceEpochMs as number) <= atEpochMs && atEpochMs <= (spec.untilEpochMs as number)
	);
}

/**
 * Pure shape guard: a well-formed, version-stamped provider
 * capacity snapshot with closed-vocabulary states and finite
 * injected timestamps. Fails closed on every malformed path.
 */
export function isProviderCapacitySnapshot(value: unknown): value is ProviderCapacitySnapshot {
	if (!isRecord(value)) {
		return false;
	}
	const snapshot = value as Record<string, unknown>;
	if (snapshot.contractVersion !== INFERENCE_SEMANTICS_CONTRACTS_VERSION) {
		return false;
	}
	if (!isNonEmptyString(snapshot.providerId)) {
		return false;
	}
	if (!isProviderMetadataVerification(snapshot.verification)) {
		return false;
	}
	if (!isProviderHealthState(snapshot.health)) {
		return false;
	}
	if (!isQuotaState(snapshot.quota)) {
		return false;
	}
	if (!isCooldownState(snapshot.cooldown)) {
		return false;
	}
	if (!isResetSchedule(snapshot.resetSchedule)) {
		return false;
	}
	return isFiniteEpochMs(snapshot.observedAtEpochMs);
}

/**
 * Pure shape guard: a well-formed, version-stamped disclosure
 * projection with closed-vocabulary states and an admitted
 * provenance record. Fails closed on every malformed path.
 */
export function isProviderCapacityDisclosure(value: unknown): value is ProviderCapacityDisclosure {
	if (!isRecord(value)) {
		return false;
	}
	const disclosure = value as Record<string, unknown>;
	if (disclosure.contractVersion !== INFERENCE_SEMANTICS_CONTRACTS_VERSION) {
		return false;
	}
	if (!isNonEmptyString(disclosure.providerId)) {
		return false;
	}
	if (!isProviderMetadataVerification(disclosure.verification)) {
		return false;
	}
	if (!isProviderHealthState(disclosure.health)) {
		return false;
	}
	if (!isDisclosedCapacityState(disclosure.capacityState)) {
		return false;
	}
	const quotaRemaining = disclosure.quotaRemaining;
	if (
		quotaRemaining !== 'unknown'
		&& !(typeof quotaRemaining === 'number' && Number.isInteger(quotaRemaining) && quotaRemaining >= 0)
	) {
		return false;
	}
	if (!isResetExpectation(disclosure.resetExpectation)) {
		return false;
	}
	if (!isFiniteEpochMs(disclosure.generatedAtEpochMs)) {
		return false;
	}
	return admitProvenance(disclosure.provenance).admitted;
}

/** Closed list of provenance rejection reasons. */
export const PROVENANCE_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-ids',
	'invalid-substitution',
	'invalid-verification',
	'invalid-recorded-at',
	'hidden-substitution',
	'substitution-label-mismatch',
] as const;
export type ProvenanceRejectionReason = (typeof PROVENANCE_REJECTION_REASONS)[number];

export interface ProvenanceAdmitted {
	readonly admitted: true;
	readonly provenance: InferenceProvenance;
}

export interface ProvenanceRejected {
	readonly admitted: false;
	readonly reason: ProvenanceRejectionReason;
	readonly detail: string;
}

export type ProvenanceAdmission = ProvenanceAdmitted | ProvenanceRejected;

/**
 * Pure fail-closed provenance guard: admits only records whose
 * substitution label is honest - a differing actual provider/model
 * must be labeled 'disclosed' (THE NO-HIDDEN-SUBSTITUTION LAW) and
 * an equal actual selection must be labeled 'none'. Deterministic:
 * same candidate, same verdict, same reason and detail. Never
 * mutates its input.
 */
export function admitProvenance(candidate: unknown): ProvenanceAdmission {
	if (!isRecord(candidate)) {
		return rejectProvenance('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_SEMANTICS_CONTRACTS_VERSION) {
		return rejectProvenance(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_SEMANTICS_CONTRACTS_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const requestedProviderId = record.requestedProviderId;
	const requestedModelId = record.requestedModelId;
	const actualProviderId = record.actualProviderId;
	const actualModelId = record.actualModelId;
	if (
		!isNonEmptyString(requestedProviderId)
		|| !isNonEmptyString(requestedModelId)
		|| !isNonEmptyString(actualProviderId)
		|| !isNonEmptyString(actualModelId)
	) {
		return rejectProvenance(
			'invalid-ids',
			'requested/actual provider and model ids must be non-empty strings',
		);
	}
	const substitution = record.substitution;
	if (!isSubstitutionState(substitution)) {
		return rejectProvenance(
			'invalid-substitution',
			`substitution must be none or disclosed, got '${String(substitution)}'`,
		);
	}
	const sameSelection = actualProviderId === requestedProviderId && actualModelId === requestedModelId;
	if (substitution === 'none' && !sameSelection) {
		return rejectProvenance(
			'hidden-substitution',
			'the actual provider/model differs from the requested selection but substitution is labeled none - hidden substitution is a lie by law',
		);
	}
	if (substitution === 'disclosed' && sameSelection) {
		return rejectProvenance(
			'substitution-label-mismatch',
			'substitution is labeled disclosed but the actual selection equals the requested selection',
		);
	}
	const modelVerification = record.modelVerification;
	if (!isProviderMetadataVerification(modelVerification)) {
		return rejectProvenance(
			'invalid-verification',
			`modelVerification must be unverified or verified, got '${String(modelVerification)}'`,
		);
	}
	const recordedAtEpochMs = record.recordedAtEpochMs;
	if (!isFiniteEpochMs(recordedAtEpochMs)) {
		return rejectProvenance('invalid-recorded-at', 'recordedAtEpochMs must be a finite number');
	}
	return {
		admitted: true,
		provenance: {
			contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
			requestedProviderId,
			requestedModelId,
			actualProviderId,
			actualModelId,
			substitution,
			modelVerification,
			recordedAtEpochMs,
		},
	};
}

/** Closed list of capacity-disclosure projection rejection reasons. */
export const CAPACITY_DISCLOSURE_REJECTION_REASONS = [
	'invalid-snapshot',
	'invalid-provenance',
	'provider-mismatch',
	'invalid-now',
] as const;
export type CapacityDisclosureRejectionReason = (typeof CAPACITY_DISCLOSURE_REJECTION_REASONS)[number];

export interface CapacityDisclosureProjected {
	readonly disclosed: true;
	readonly disclosure: ProviderCapacityDisclosure;
}

export interface CapacityDisclosureRejected {
	readonly disclosed: false;
	readonly reason: CapacityDisclosureRejectionReason;
	readonly detail: string;
}

export type CapacityDisclosureOutcome = CapacityDisclosureProjected | CapacityDisclosureRejected;

/**
 * Pure disclosure projection: the user-visible capacity state for
 * one provider snapshot plus the MANDATORY provenance of the
 * selected provider/model. All timestamps are injected (nowEpochMs
 * is the probe/generation time); the projection never reads a
 * clock, never does I/O, and never mutates its inputs. The
 * provenance is admitted first (fail closed) and then carried
 * verbatim - no hidden substitution can survive this projection.
 * Rejections are typed and name the violation:
 *   invalid-snapshot   - the snapshot fails isProviderCapacitySnapshot
 *   invalid-provenance - the provenance fails admitProvenance
 *   provider-mismatch  - the provenance names a different actual
 *                        provider than the snapshot (misattribution)
 *   invalid-now        - non-finite nowEpochMs
 * Capacity-state precedence (deterministic, total):
 *   1. active cooldown or cooldown health          -> 'cooldown'
 *   2. unknown health                              -> 'unknown'
 *   3. unknown quota                               -> 'unknown'
 *   4. remaining <= 0                              -> 'exhausted'
 *   5. degraded health or remaining < limit        -> 'limited'
 *   6. otherwise                                   -> 'available'
 */
export function projectCapacityDisclosure(
	snapshot: ProviderCapacitySnapshot,
	provenance: InferenceProvenance,
	nowEpochMs: number,
): CapacityDisclosureOutcome {
	if (!isProviderCapacitySnapshot(snapshot)) {
		return rejectDisclosure(
			'invalid-snapshot',
			'snapshot must satisfy isProviderCapacitySnapshot before it can be disclosed',
		);
	}
	const admission = admitProvenance(provenance);
	if (!admission.admitted) {
		return rejectDisclosure(
			'invalid-provenance',
			`provenance must satisfy admitProvenance: '${admission.reason}': ${admission.detail}`,
		);
	}
	if (admission.provenance.actualProviderId !== snapshot.providerId) {
		return rejectDisclosure(
			'provider-mismatch',
			`the provenance actual provider '${admission.provenance.actualProviderId}' must match the snapshot provider '${snapshot.providerId}' - a capacity disclosure may never be misattributed`,
		);
	}
	if (!isFiniteEpochMs(nowEpochMs)) {
		return rejectDisclosure('invalid-now', 'nowEpochMs must be a finite number');
	}
	const nextReset = nextResetAt(snapshot.resetSchedule, nowEpochMs);
	const resetExpectation: ResetExpectation =
		typeof nextReset === 'number'
			? {
				kind: 'known',
				nextResetEpochMs: nextReset,
				// A known next reset can only originate from these two
				// schedule kinds; every other kind projects 'unknown'.
				basis: snapshot.resetSchedule.kind as 'fixed-instant' | 'interval-aligned',
			}
			: { kind: 'unknown' };
	return {
		disclosed: true,
		disclosure: {
			contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
			providerId: snapshot.providerId,
			health: snapshot.health,
			verification: snapshot.verification,
			capacityState: deriveCapacityState(snapshot, nowEpochMs),
			quotaRemaining: snapshot.quota.state === 'known' ? snapshot.quota.remaining : 'unknown',
			resetExpectation,
			provenance: admission.provenance,
			generatedAtEpochMs: nowEpochMs,
		},
	};
}

/**
 * Canonical serialization of a capacity disclosure: fixed key
 * order, deterministic bytes regardless of the input record's key
 * insertion order (the provenance sub-record is canonicalized
 * too). The canonical form is the persistence/audit and INF-008 UI
 * binder shape. Malformed input fails closed by property access
 * (TypeError), never by silently reordering or guessing.
 */
export function serializeCapacityDisclosure(disclosure: ProviderCapacityDisclosure): string {
	return JSON.stringify({
		contractVersion: disclosure.contractVersion,
		providerId: disclosure.providerId,
		health: disclosure.health,
		verification: disclosure.verification,
		capacityState: disclosure.capacityState,
		quotaRemaining: disclosure.quotaRemaining,
		resetExpectation:
			disclosure.resetExpectation.kind === 'known'
				? {
					kind: 'known',
					nextResetEpochMs: disclosure.resetExpectation.nextResetEpochMs,
					basis: disclosure.resetExpectation.basis,
				}
				: { kind: 'unknown' },
		provenance: {
			contractVersion: disclosure.provenance.contractVersion,
			requestedProviderId: disclosure.provenance.requestedProviderId,
			requestedModelId: disclosure.provenance.requestedModelId,
			actualProviderId: disclosure.provenance.actualProviderId,
			actualModelId: disclosure.provenance.actualModelId,
			substitution: disclosure.provenance.substitution,
			modelVerification: disclosure.provenance.modelVerification,
			recordedAtEpochMs: disclosure.provenance.recordedAtEpochMs,
		},
		generatedAtEpochMs: disclosure.generatedAtEpochMs,
	});
}

function deriveCapacityState(
	snapshot: ProviderCapacitySnapshot,
	nowEpochMs: number,
): DisclosedCapacityState {
	if (cooldownActive(snapshot.cooldown, nowEpochMs) || snapshot.health === 'cooldown') {
		return 'cooldown';
	}
	if (snapshot.health === 'unknown') {
		return 'unknown';
	}
	if (snapshot.quota.state === 'unknown') {
		return 'unknown';
	}
	if (snapshot.quota.remaining <= 0) {
		return 'exhausted';
	}
	if (snapshot.health === 'degraded' || snapshot.quota.remaining < snapshot.quota.limit) {
		return 'limited';
	}
	return 'available';
}

function sameSelection(input: UnverifiedProvenanceInput): boolean {
	return (
		input.actualProviderId === input.requestedProviderId
		&& input.actualModelId === input.requestedModelId
	);
}

function isSubstitutionState(value: unknown): value is SubstitutionState {
	return (SUBSTITUTION_STATES as readonly string[]).includes(value as string);
}

function isProviderHealthState(value: unknown): value is ProviderHealthState {
	return (PROVIDER_HEALTH_STATES as readonly string[]).includes(value as string);
}

function isProviderMetadataVerification(value: unknown): value is ProviderMetadataVerification {
	return (PROVIDER_METADATA_VERIFICATIONS as readonly string[]).includes(value as string);
}

function isDisclosedCapacityState(value: unknown): value is DisclosedCapacityState {
	return (DISCLOSED_CAPACITY_STATES as readonly string[]).includes(value as string);
}

function isQuotaState(value: unknown): value is QuotaState {
	if (!isRecord(value)) {
		return false;
	}
	const quota = value as Record<string, unknown>;
	if (quota.state === 'unknown') {
		return true;
	}
	if (quota.state !== 'known') {
		return false;
	}
	if (!Number.isInteger(quota.remaining) || (quota.remaining as number) < 0) {
		return false;
	}
	if (!Number.isInteger(quota.limit) || (quota.limit as number) < 0) {
		return false;
	}
	return isQuotaWindowSpec(quota.window);
}

function isQuotaWindowSpec(value: unknown): value is QuotaWindowSpec {
	if (!isRecord(value)) {
		return false;
	}
	const spec = value as Record<string, unknown>;
	if (spec.kind !== 'fixed' && spec.kind !== 'rolling') {
		return false;
	}
	if (!isFiniteEpochMs(spec.windowStartEpochMs)) {
		return false;
	}
	return isFiniteEpochMs(spec.windowLengthMs) && (spec.windowLengthMs as number) >= 0;
}

function isCooldownState(value: unknown): value is CooldownState {
	if (!isRecord(value)) {
		return false;
	}
	const cooldown = value as Record<string, unknown>;
	if (cooldown.state === 'none') {
		return true;
	}
	if (cooldown.state !== 'active') {
		return false;
	}
	if (!(COOLDOWN_REASONS as readonly string[]).includes(cooldown.reason as string)) {
		return false;
	}
	if (!isFiniteEpochMs(cooldown.sinceEpochMs) || !isFiniteEpochMs(cooldown.untilEpochMs)) {
		return false;
	}
	return (cooldown.untilEpochMs as number) >= (cooldown.sinceEpochMs as number);
}

function isResetSchedule(value: unknown): value is ResetSchedule {
	if (!isRecord(value)) {
		return false;
	}
	const schedule = value as Record<string, unknown>;
	switch (schedule.kind) {
		case 'fixed-instant':
			return isFiniteEpochMs(schedule.atEpochMs);
		case 'interval-aligned':
			return (
				isFiniteEpochMs(schedule.anchorEpochMs)
				&& isFiniteEpochMs(schedule.intervalMs)
				&& (schedule.intervalMs as number) > 0
			);
		case 'provider-discretion':
		case 'unknown':
			return true;
		default:
			return false;
	}
}

function isResetExpectation(value: unknown): value is ResetExpectation {
	if (!isRecord(value)) {
		return false;
	}
	const expectation = value as Record<string, unknown>;
	if (expectation.kind === 'unknown') {
		return true;
	}
	if (expectation.kind !== 'known') {
		return false;
	}
	if (
		expectation.basis !== 'fixed-instant'
		&& expectation.basis !== 'interval-aligned'
	) {
		return false;
	}
	return isFiniteEpochMs(expectation.nextResetEpochMs);
}

function rejectProvenance(reason: ProvenanceRejectionReason, detail: string): ProvenanceRejected {
	return { admitted: false, reason, detail };
}

function rejectDisclosure(
	reason: CapacityDisclosureRejectionReason,
	detail: string,
): CapacityDisclosureRejected {
	return { disclosed: false, reason, detail };
}

function isFiniteEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
