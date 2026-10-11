/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-005 Free Inference Fabric contracts: the typed
 * health/quota/cooldown/retry/failover ROUTING family - the closed
 * vocabulary for routing among ADMITTED candidates by adapter id and
 * observed capacity state, the deterministic disclosed selection
 * rule, the honest attempt ledger, and the bounded retry/failover
 * policy vocabulary (contract module, the labContracts discipline;
 * binds the landed INF-001 semantics family's capacityDisclosure
 * vocabulary and the INF-003 adapter family's
 * ProviderAdapterHealthReport verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..004 family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. Every timestamp - snapshot observation times, decision
 *   times, attempt times - is a caller-injected epoch-ms number. No
 *   Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - THE NO-FABRICATION LAW (binding): a candidate with no observation
 *   rides the landed unknownSnapshot honest defaults - health
 *   'unknown', quota 'unknown', never a silently fabricated 'healthy'
 *   state. The router never invents state; what is not observed is
 *   disclosed as not observed.
 * - DISCLOSURE THROUGH THE PROJECTION (binding): a routing decision
 *   discloses the chosen candidate's state THROUGH the landed
 *   projectCapacityDisclosure projection (the ProviderCapacityDisclosure
 *   vocabulary) - never around it, never a parallel disclosure shape.
 *   The serializer embeds the landed disclosure bytes verbatim.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every admission/decision rejection is a typed member
 *   of a frozen closed list, in the exact check order; the first
 *   failing check is THE verdict, and every rejection names its
 *   reason.
 * - THE DELEGATED BOUNDARY MATH (binding): cooldown/quota gating
 *   rides the landed cooldownActive / quotaWindowContains helpers
 *   with their INCLUSIVE boundary semantics - never re-implemented,
 *   never re-worded, never widened here.
 * - THE DELEGATED PROMOTION (binding): one-way verification
 *   promotion belongs to the landed markProvenanceVerified /
 *   markReportVerified - never re-implemented, never a router-side
 *   mutator. This family exposes NO promotion surface at all.
 * - THE INF-006 SCOPE BOUNDARY (binding): this family routes among
 *   ADMITTED candidates by adapter id and observed capacity state
 *   ONLY. Capability/context-window MATCHING is INF-006's item; no
 *   matching engine, no model vocabulary, no token arithmetic here.
 * - VOCABULARY ONLY (binding): no network, no fetch, no IO, no
 *   storage, no credential material (the only credential vocabulary
 *   is the landed opaque credentialHandle reference id - and even
 *   that appears nowhere in these shapes), no clock, no randomness.
 *   The retry/failover ENGINE (the kit module) calls only
 *   caller-injected effect thunks.
 * - Canonical bytes: serializeRoutingDecision emits fixed-key-order
 *   deterministic bytes (double-run byte-equal), with the disclosure
 *   sub-record canonicalized THROUGH the landed
 *   serializeCapacityDisclosure bytes - never a re-implemented key
 *   order. Every persisted/audited top-level shape carries
 *   contractVersion; transient rejection verdicts carry reason +
 *   detail (the landed families' rejection idiom).
 * - Zero external dependencies: node: builtins (none needed) and the
 *   landed sibling semantics/adapters families only.
 */
import { COOLDOWN_REASONS } from '../../semantics/common/capacityDisclosure.js';
import {
        isProviderCapacityDisclosure,
        serializeCapacityDisclosure,
} from '../../semantics/common/capacityDisclosure.js';
import type { ProviderCapacityDisclosure } from '../../semantics/common/capacityDisclosure.js';
import { isAdapterHealthReport } from '../../adapters/common/providerAdapter.js';
import type { ProviderAdapterHealthReport } from '../../adapters/common/providerAdapter.js';

/**
 * Version of the inference-routing contract set (this family's own
 * constant, declared ONCE here; every routing-family persisted record
 * carries it and the test suite pins it). The kit module re-declares
 * an independent literal copy (the COMMAND_FACADE zero-dependency
 * idiom) and re-exports this one; the suite pins both copies equal -
 * a drift fails the kit's own outputs closed through this module's
 * guards. The vocabulary INSIDE the records is the landed families':
 * capacity states ride the semantics family's
 * ProviderCapacityDisclosure projection, reports are the adapter
 * family's ProviderAdapterHealthReport. Those sub-records keep their
 * own family version stamps; the routing stamp and the
 * semantics/adapter stamps are distinct roles pinned by the suite.
 */
export const INFERENCE_ROUTING_VERSION = '1.0.0';

/**
 * The typed routing candidate: one ADMITTED adapter plus the health
 * report carrying what was observed about it. The report is a landed
 * ProviderAdapterHealthReport (INF-003) or, when no observation
 * exists, the honest fold the kit's unknownCandidate builds ON the
 * landed unknownSnapshot defaults (health 'unknown', quota 'unknown',
 * no cooldown, unknown reset, unverified provenance) - THE
 * NO-FABRICATION LAW: never a silently fabricated healthy state. The
 * report's own adapterId must name the candidate's adapterId (a
 * candidate carrying another adapter's report is misattributed and
 * never well-formed).
 */
export interface RoutingCandidate {
        readonly adapterId: string;
        readonly report: ProviderAdapterHealthReport;
}

/**
 * Closed frozen list of routing-candidate admission rejection
 * reasons, in the exact check order (the kit walks this list top to
 * bottom and the FIRST failure is the verdict):
 *   not-an-object                - the candidate is not an object;
 *   adapter-id-empty             - adapterId is not a non-empty string;
 *   adapter-report-malformed     - the report fails the landed
 *                                  isAdapterHealthReport, or names a
 *                                  different adapterId than the
 *                                  candidate's (misattributed);
 *   routing-unknown-adapter      - THE NO-DANGLING-REF LAW extended to
 *                                  routing: the adapterId resolves to
 *                                  no admitted adapter in the bound
 *                                  adapter record;
 *   adapter-report-misattributed - the report's snapshot names a
 *                                  provider other than the bound
 *                                  adapter's provider entry (a
 *                                  capacity report attributed to the
 *                                  wrong provider is a lie);
 *   routing-candidate-duplicate  - THE DUPLICATE LAW: the adapterId
 *                                  is already admitted in this
 *                                  routing set - never a silent
 *                                  overwrite (the shape checks run
 *                                  first, mirroring the landed kit
 *                                  idiom).
 */
export const ROUTING_REJECTION_REASONS = [
        'not-an-object',
        'adapter-id-empty',
        'adapter-report-malformed',
        'routing-unknown-adapter',
        'adapter-report-misattributed',
        'routing-candidate-duplicate',
] as const;
export type RoutingRejectionReason = (typeof ROUTING_REJECTION_REASONS)[number];

export interface RoutingAdmitted {
        readonly admitted: true;
        readonly candidate: RoutingCandidate;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface RoutingRejected {
        readonly admitted: false;
        readonly reason: RoutingRejectionReason;
        readonly detail: string;
}

export type RoutingAdmission = RoutingAdmitted | RoutingRejected;

/**
 * The closed frozen selection-rule vocabulary: the DETERMINISTIC,
 * disclosed rule the kit picks by (no randomness, no guessed
 * quality ranking - ranking candidates by fabricated weights would be
 * a verdict the observations never made). ONE member today:
 *   stable-adapter-id-order - among eligible candidates, the first in
 *   ascending adapterId (lexicographic) order is selected. The rule
 * rides every decision (selectionRule) and its canonical bytes.
 * Widening the set is a contract change requiring a version bump.
 */
export const ROUTING_SELECTION_RULES = ['stable-adapter-id-order'] as const;
export type RoutingSelectionRule = (typeof ROUTING_SELECTION_RULES)[number];

/**
 * The typed routing decision: the chosen candidate plus the DISCLOSED
 * capacity state riding the landed ProviderCapacityDisclosure
 * vocabulary verbatim (produced THROUGH the landed
 * projectCapacityDisclosure projection - law: disclosure through the
 * projection, never around it). decidedAtEpochMs is the injected
 * decision instant and MUST equal the disclosure's own
 * generatedAtEpochMs (one decision, one time - mirroring the adapter
 * family's one-observation-one-time law). Carries the routing
 * contract-set version stamp.
 */
export interface RoutingDecision {
        readonly contractVersion: string;
        readonly adapterId: string;
        readonly selectionRule: RoutingSelectionRule;
        readonly disclosure: ProviderCapacityDisclosure;
        readonly decidedAtEpochMs: number;
}

/**
 * Canonical serialization of a routing decision: fixed key order
 * (contractVersion, adapterId, selectionRule, disclosure,
 * decidedAtEpochMs), deterministic bytes regardless of the input
 * record's key insertion order. The disclosure sub-record's canonical
 * form is the landed serializeCapacityDisclosure output, re-parsed to
 * embed its fixed key order VERBATIM - this family never
 * re-implements the disclosure's key order. Refuses non-admitted
 * decisions (fail closed: no dishonest decision ever gets canonical
 * bytes). This canonical form is the persistence/audit shape for the
 * INF-006..009 binders (INF-008's UI renders it).
 */
export function serializeRoutingDecision(decision: unknown): string {
        if (!isRoutingDecision(decision)) {
                throw new TypeError(
                        'serializeRoutingDecision: decision must satisfy isRoutingDecision - no dishonest routing decision ever gets canonical bytes',
                );
        }
        return JSON.stringify({
                contractVersion: decision.contractVersion,
                adapterId: decision.adapterId,
                selectionRule: decision.selectionRule,
                // THROUGH the landed serializer: the disclosure's canonical
                // bytes are produced by the landed
                // serializeCapacityDisclosure and re-parsed to embed its
                // fixed key order verbatim (JSON.parse preserves the
                // emitted key order for these string keys).
                disclosure: JSON.parse(serializeCapacityDisclosure(decision.disclosure)) as Record<
                        string,
                        unknown
                >,
                decidedAtEpochMs: decision.decidedAtEpochMs,
        });
}

/**
 * Pure shape guard: a well-formed routing candidate - an object with
 * a non-empty adapterId and a report that satisfies the landed
 * isAdapterHealthReport AND names the candidate's own adapterId (a
 * candidate carrying another adapter's report is misattributed,
 * never well-formed). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isRoutingCandidate(value: unknown): value is RoutingCandidate {
        if (!isRecord(value)) {
                return false;
        }
        const candidate = value as Record<string, unknown>;
        if (!isNonEmptyString(candidate.adapterId)) {
                return false;
        }
        if (!isAdapterHealthReport(candidate.report)) {
                return false;
        }
        return (candidate.report as ProviderAdapterHealthReport).adapterId === candidate.adapterId;
}

/**
 * Pure shape guard: a well-formed, version-stamped routing decision
 * with a closed-vocabulary selection rule, a disclosure satisfying
 * the landed isProviderCapacityDisclosure, and a finite injected
 * decision time that AGREES with the disclosure's own generation
 * time (one decision, one time). Fails closed on every malformed
 * path; never reads a clock; never mutates its input.
 */
export function isRoutingDecision(value: unknown): value is RoutingDecision {
        if (!isRecord(value)) {
                return false;
        }
        const decision = value as Record<string, unknown>;
        if (decision.contractVersion !== INFERENCE_ROUTING_VERSION) {
                return false;
        }
        if (!isNonEmptyString(decision.adapterId)) {
                return false;
        }
        if (!isRoutingSelectionRule(decision.selectionRule)) {
                return false;
        }
        if (!isProviderCapacityDisclosure(decision.disclosure)) {
                return false;
        }
        if (!isFiniteEpochMs(decision.decidedAtEpochMs)) {
                return false;
        }
        const disclosure = decision.disclosure as ProviderCapacityDisclosure;
        return decision.decidedAtEpochMs === disclosure.generatedAtEpochMs;
}

/**
 * Closed frozen vocabulary of routing attempt outcomes - the honest
 * ledger's outcome column:
 *   eligible            - passed the cooldown/quota gates at the scan
 *                         instant (not selected/attempted yet);
 *   selected            - THE chosen candidate (route());
 *   skipped-cooldown    - the landed cooldownActive tripped (inclusive
 *                         boundaries) - recorded, never silently
 *                         dropped;
 *   skipped-quota       - a known quota at zero remaining inside its
 *                         (inclusive, landed quotaWindowContains)
 *                         window - recorded, never silently dropped;
 *   attempted-succeeded - a failover effect thunk reported success;
 *   attempted-failed    - a failover effect thunk reported failure.
 */
export const ROUTING_ATTEMPT_OUTCOMES = [
        'eligible',
        'selected',
        'skipped-cooldown',
        'skipped-quota',
        'attempted-succeeded',
        'attempted-failed',
] as const;
export type RoutingAttemptOutcome = (typeof ROUTING_ATTEMPT_OUTCOMES)[number];

/**
 * Closed frozen vocabulary of routing attempt reasons: 'none' (no
 * violation - eligible/selected/succeeded entries), the landed
 * COOLDOWN_REASONS verbatim (skipped-cooldown entries carry the
 * active cooldown's own reason; 'quota-exhausted' doubles as the
 * skipped-quota gate's reason), plus 'attempt-failed' - the honest
 * extent of the router's knowledge when a caller thunk reports
 * failure (the thunk's simple verdict discloses no further detail by
 * design). Widening beyond the landed list is a contract change.
 */
export const ROUTING_ATTEMPT_REASONS = [
        'none',
        ...COOLDOWN_REASONS,
        'attempt-failed',
] as const;
export type RoutingAttemptReason = (typeof ROUTING_ATTEMPT_REASONS)[number];

/**
 * One honest attempt-ledger line: the candidate, the injected
 * epoch-ms instant, the closed-vocabulary outcome, and the reason.
 * Ledger lines are nested audit rows - the enclosing outcome shape
 * carries the contractVersion stamp for the batch (mirroring the
 * landed families' nested-record idiom).
 */
export interface RoutingAttempt {
        readonly adapterId: string;
        readonly atEpochMs: number;
        readonly outcome: RoutingAttemptOutcome;
        readonly reason: RoutingAttemptReason;
}

/**
 * The typed route outcome, selected side: the decision plus the FULL
 * honest attempt ledger (every admitted candidate appears exactly
 * once - skipped entries included, never silently dropped). Carries
 * the routing contract-set version stamp.
 */
export interface RoutingSelected {
        readonly kind: 'selected';
        readonly contractVersion: string;
        readonly decision: RoutingDecision;
        readonly attemptLedger: readonly RoutingAttempt[];
}

/**
 * The typed route outcome, exhausted side: zero eligible candidates
 * at the injected probe instant. Carries the FULL honest attempt
 * ledger (every candidate, its outcome and reason) - never a silent
 * empty. Carries the routing contract-set version stamp.
 */
export interface RoutingExhausted {
        readonly kind: 'exhausted';
        readonly contractVersion: string;
        readonly atEpochMs: number;
        readonly attemptLedger: readonly RoutingAttempt[];
}

export type RoutingOutcome = RoutingSelected | RoutingExhausted;

/**
 * The closed frozen vocabulary of the caller-injected effect thunk's
 * outcome kinds: 'succeeded' or 'failed'. The thunk is the ONLY
 * thing that performs the real attempt (the engine never performs
 * IO); its verdict is the router's only knowledge of the attempt.
 */
export const ATTEMPT_OUTCOME_KINDS = ['succeeded', 'failed'] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOME_KINDS)[number];

/**
 * The typed bounded retry policy: maxAttempts is the PER-CANDIDATE
 * attempt bound (the retry budget one candidate consumes before the
 * engine fails over to the next); backoffScheduleMs is the caller's
 * INJECTED backoff schedule - exactly maxAttempts-1 finite
 * non-negative epoch-ms delays, delay i spacing the retry after
 * failure i (the engine performs no hidden exponential arithmetic;
 * deterministic by construction). A malformed policy is the typed
 * failover rejection, never a silent default.
 */
export interface RetryPolicy {
        readonly maxAttempts: number;
        readonly backoffScheduleMs: readonly number[];
}

/**
 * Closed frozen list of failover-run rejection reasons, in the exact
 * validation order (the first failure is the verdict):
 *   invalid-attempt-thunk    - the effect thunk is not a function;
 *   invalid-max-attempts     - maxAttempts is not an integer >= 1;
 *   invalid-backoff-schedule - the schedule is not an array of
 *                              exactly maxAttempts-1 finite
 *                              non-negative numbers;
 *   invalid-at               - the injected start instant is not a
 *                              finite number.
 */
export const FAILOVER_REJECTION_REASONS = [
        'invalid-attempt-thunk',
        'invalid-max-attempts',
        'invalid-backoff-schedule',
        'invalid-at',
] as const;
export type FailoverRejectionReason = (typeof FAILOVER_REJECTION_REASONS)[number];

/**
 * The typed failover outcome, succeeded side: the candidate whose
 * thunk succeeded, the injected run-start instant, the total thunk
 * calls made, and the FULL honest attempt ledger (the eligibility
 * scan lines plus every attempt line). Carries the routing
 * contract-set version stamp.
 */
export interface FailoverSucceeded {
        readonly kind: 'succeeded';
        readonly contractVersion: string;
        readonly adapterId: string;
        readonly atEpochMs: number;
        readonly attemptCount: number;
        readonly attemptLedger: readonly RoutingAttempt[];
}

/**
 * The typed failover outcome, exhausted side: every eligible
 * candidate's retry budget was consumed (or none were eligible at
 * the start instant). Carries the FULL honest attempt ledger with
 * the per-candidate reasons - every skip and every failed attempt.
 * Carries the routing contract-set version stamp.
 */
export interface FailoverExhausted {
        readonly kind: 'exhausted';
        readonly contractVersion: string;
        readonly atEpochMs: number;
        readonly attemptLedger: readonly RoutingAttempt[];
}

/** Typed failover rejection: closed reason, detail names the violation. */
export interface FailoverRejected {
        readonly kind: 'rejected';
        readonly reason: FailoverRejectionReason;
        readonly detail: string;
}

export type FailoverOutcome = FailoverSucceeded | FailoverExhausted | FailoverRejected;

function isRoutingSelectionRule(value: unknown): value is RoutingSelectionRule {
        return (ROUTING_SELECTION_RULES as readonly string[]).includes(value as string);
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
