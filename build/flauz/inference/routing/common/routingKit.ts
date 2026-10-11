/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-005 Free Inference Fabric contracts: the typed deterministic
 * health/quota/cooldown/retry/failover ROUTING kit - the
 * fail-closed factory over the bound adapter record, candidate
 * admission through the frozen rejection walk, the deterministic
 * disclosed selection, the honest attempt ledger, the kit's own
 * state fold, the canonical audit-record serializer, and the bounded
 * retry/failover engine over caller-injected effect thunks (kit
 * module, the labContracts discipline; binds the landed INF-001
 * semantics family's capacityDisclosure vocabulary, the INF-002
 * catalog family's binding through the landed adapter-record guard,
 * the INF-003 adapter family's report folds, and the INF-004 sidecar
 * family's OPTIONAL reportSnapshot fold - type-only, never a
 * required input).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..004 family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a clock.
 *   Every timestamp comes from the single injected now() function
 *   (unknown-candidate folds, kit state folds) or from the
 *   caller-injected probe instants (route at, failover at). No
 *   Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - THE NO-FABRICATION LAW (binding): a candidate with no observation
 *   rides the landed unknownSnapshot honest defaults through
 *   unknownCandidate - the landed reportAdapterSnapshot fold over an
 *   all-unknown observation with an unverified provenance. UNKNOWN is
 *   first-class and eligible (an unknown candidate routes; its
 *   decision DISCLOSES the honest-unknown states). The router never
 *   invents a healthy state and never invents a bad verdict from
 *   stale data.
 * - DISCLOSURE THROUGH THE PROJECTION (binding): every routing
 *   decision's disclosed state is produced by the landed
 *   projectCapacityDisclosure - the ONLY disclosure path. A
 *   projection failure is a fail-closed TypeError, never a
 *   hand-built disclosure.
 * - THE DELEGATED BOUNDARY MATH (binding): the cooldown gate rides
 *   the landed cooldownActive and the quota gate rides the landed
 *   quotaWindowContains, INCLUSIVE boundaries verbatim. The cooldown
 *   gate is the authority on ACTIVE (a stale 'cooldown' health label
 *   with no active interval does NOT gate); the quota gate trips only
 *   on a KNOWN quota at zero remaining INSIDE its inclusive window (a
 *   zero outside its window is stale - disclosed as-is, never
 *   fabricated into a verdict).
 * - THE DELEGATED PROMOTION (binding): the kit exposes NO
 *   verification promotion surface. The one-way promotion belongs to
 *   the landed markProvenanceVerified / markReportVerified, exercised
 *   by the caller on the candidate's report - never re-implemented,
 *   never a router-side mutator.
 * - THE OPTIONAL-SIDECAR LAW (binding): the router MAY read an
 *   OPTIONAL sidecar's reportSnapshot fold. A sidecar is never a
 *   required input (a kit without one routes on the reports alone);
 *   when a bound sidecar SERVES a candidate's provider, its fold IS
 *   the effective observed state (its no-state default is the landed
 *   unknownSnapshot - the router sees unknown, never the report's own
 *   states for that provider); when no sidecar record serves the
 *   provider, the candidate's own report is the effective state. The
 *   sidecar's own fail-closed folds (malformed or misattributed
 *   attached state) propagate as TypeError - never swallowed. The
 *   sidecar is read ONCE per routing call (one observation per call;
 *   the engine re-reads no external state mid-run).
 * - THE NO-DANGLING-REF LAW (extended): candidates resolve against
 *   the adapter record bound at creation through the landed
 *   admitProviderAdapterRecord (which validates the bound catalog and
 *   every adapter's provider entry resolution); a candidate id that
 *   resolves to no admitted adapter is the typed
 *   'routing-unknown-adapter' rejection, and a report attributing
 *   another provider is the typed 'adapter-report-misattributed'
 *   rejection.
 * - THE DUPLICATE LAW: a repeated adapterId is the typed
 *   'routing-candidate-duplicate' rejection - the shape checks run
 *   first (the landed kit idiom); never a silent overwrite.
 * - THE DISCLOSED SELECTION RULE: among eligible candidates the kit
 *   selects the FIRST in ascending adapterId order
 *   ('stable-adapter-id-order', the frozen one-member vocabulary) -
 *   deterministic, disclosed on every decision, no randomness, no
 *   fabricated quality ranking.
 * - THE HONEST LEDGER: every candidate appears exactly once in the
 *   scan ledger (eligible/selected/skipped-cooldown/skipped-quota);
 *   a routing set with zero eligible candidates is the typed
 *   RoutingExhausted outcome carrying the FULL ledger - never a
 *   silent empty. The failover engine adds one line per thunk call
 *   and one line per re-gate trip; every retry and failover instant
 *   is deterministic arithmetic over the injected policy.
 * - THE RETRY/FAILOVER ENGINE NEVER PERFORMS IO: the attempt thunk
 *   is the caller's; the engine orders candidates (the same
 *   disclosed rule), calls the thunk, records the ledger, retries per
 *   the per-candidate bound and the injected backoff schedule, and
 *   fails over when a candidate's budget ends. Every attempt is
 *   re-gated at its own computed time; a gate trip ends the
 *   candidate's budget honestly and fails over immediately (the
 *   schedule spaces RETRIES, not failovers; the engine never defers a
 *   candidate for later reconsideration).
 * - Canonical bytes: serializeRoutingRecord emits fixed-key-order
 *   deterministic bytes (the capacity snapshot sub-records mirror the
 *   landed adapter family's canonical snapshot key order - cited,
 *   never re-derived semantics); every audit shape carries
 *   contractVersion. The kit's own literal stamp is checked through
 *   the CONTRACT module's guards - a version drift fails closed
 *   inside the kit, never at the caller's boundary.
 * - Zero external dependencies: the landed sibling families only
 *   (semantics, adapters, sidecar - the sidecar type-only).
 */
import { INFERENCE_ROUTING_VERSION, isRoutingDecision } from './routingContract.js';
import type {
        AttemptOutcome,
        FailoverOutcome,
        FailoverRejected,
        FailoverRejectionReason,
        RoutingAdmission,
        RoutingAttempt,
        RoutingAttemptReason,
        RoutingCandidate,
        RoutingDecision,
        RoutingOutcome,
        RoutingRejectionReason,
        RetryPolicy,
} from './routingContract.js';
export { INFERENCE_ROUTING_VERSION } from './routingContract.js';
import {
        admitProviderAdapterRecord,
        isAdapterHealthReport,
        reportAdapterSnapshot,
} from '../../adapters/common/providerAdapter.js';
import type { AdapterObservation, ProviderAdapterDescriptor } from '../../adapters/common/providerAdapter.js';
import {
        cooldownActive,
        isProviderCapacitySnapshot,
        projectCapacityDisclosure,
        quotaWindowContains,
} from '../../semantics/common/capacityDisclosure.js';
import type { ActiveCooldown, ProviderCapacitySnapshot } from '../../semantics/common/capacityDisclosure.js';
import type { SidecarKit } from '../../sidecar/common/sidecarKit.js';

/**
 * The kit module's own re-declared literal copy of the routing
 * contract-set version (the COMMAND_FACADE idiom: declared
 * independently of routingContract.ts's copy, pinned equal by the
 * test suite). The kit stamps ITS records with THIS copy; the
 * contract module's guards check against THEIR copy - if the two
 * ever drift, the kit's own route() output fails closed at the
 * isRoutingDecision self-check and serializeRoutingRecord refuses
 * the kit's own fold: the drift can never reach a caller as a
 * valid-looking record.
 */
export const ROUTING_KIT_VERSION = '1.0.0';

/**
 * The provenance scope-label convention for the no-observation
 * candidate: the routing candidate is adapter/provider-scoped and
 * the honest unknown fold carries no model ids, so the folded
 * provenance's model fields name the ROUTING probe scope - a scope
 * label, never a model claim (mirroring the sidecar family's
 * SIDECAR_CAPACITY_REPORT_SCOPE convention).
 */
export const ROUTING_PROBE_SCOPE = 'routing.capacity-probe';

/**
 * The kit options: the injected clock (THE INJECTED-CLOCK LAW), the
 * bound adapter record + catalog (arriving as unknown at the runtime
 * boundary, validated through the landed admitProviderAdapterRecord -
 * which validates the catalog through the landed admitCatalogRecord
 * and every adapter's providerEntryId resolution: the
 * no-dangling-ref laws cited, never re-implemented), and the
 * OPTIONAL sidecar (THE OPTIONAL-SIDECAR LAW: present or absent, a
 * sidecar is never required; when present it must satisfy the landed
 * SidecarKit interface structurally - list and reportSnapshot
 * functions - fail-closed TypeError otherwise).
 */
export interface RoutingKitOptions {
        readonly now: () => number;
        readonly adapters: unknown;
        readonly catalog: unknown;
        readonly sidecar?: SidecarKit;
}

/**
 * The input of runWithFailover: the caller-injected effect thunk
 * (the ONLY thing that performs the real attempt - the engine never
 * performs IO), the bounded retry policy, and the injected run-start
 * instant.
 */
export interface RunWithFailoverInput {
        readonly attempt: (candidate: RoutingCandidate) => AttemptOutcome;
        readonly policy: RetryPolicy;
        readonly at: number;
}

/**
 * One row of the kit's state fold: the candidate's adapter id, the
 * effective capacity snapshot (the report's own, or the optional
 * sidecar's fold when the sidecar serves the provider), and whether
 * the sidecar supplied the state.
 */
export interface RoutingCandidateStateRow {
        readonly adapterId: string;
        readonly snapshot: ProviderCapacitySnapshot;
        readonly observedViaSidecar: boolean;
}

/**
 * The kit's own state fold (what the INF-008 UI layer reads): every
 * admitted candidate's honest current state, sorted by adapterId
 * (stable), folded at the injected clock's time, keyed to the bound
 * adapter set's id (the routing set IS the bound adapter set plus
 * observations - no new authority id). Carries the routing
 * contract-set version stamp (the kit's copy).
 */
export interface RoutingKitSnapshot {
        readonly contractVersion: string;
        readonly routingSetId: string;
        readonly foldedAtEpochMs: number;
        readonly rows: readonly RoutingCandidateStateRow[];
}

/**
 * The deterministic routing kit: fail-closed candidate admission,
 * the disclosed deterministic selection with the honest attempt
 * ledger, the optional-sidecar state resolution, the honest
 * no-observation candidate fold, the kit state fold, and the
 * bounded retry/failover engine over caller-injected thunks. Pure
 * vocabulary over injected values: no network, no IO, no clock
 * reading, no credential material, no matching engine (INF-006's
 * item).
 */
export interface RoutingKit {
        addCandidate(candidate: unknown): RoutingAdmission;
        route(input: { readonly at: number }): RoutingOutcome;
        runWithFailover(input: RunWithFailoverInput): FailoverOutcome;
        reportSnapshot(): RoutingKitSnapshot;
        unknownCandidate(adapterId: string): RoutingCandidate | undefined;
        count(): number;
        list(): readonly RoutingCandidate[];
}

/**
 * Creates a routing kit (fail-closed factory). Validation order is
 * deterministic: the options shape (now must be a function), the
 * bound adapter record through the LANDED admitProviderAdapterRecord
 * (its catalog binding and no-dangling-ref laws cited verbatim in
 * the TypeError on rejection), the optional sidecar's structural
 * shape (list and reportSnapshot functions), and finally ONE read of
 * the injected clock to validate it can produce a finite fold time.
 * The kit starts with ZERO candidates.
 */
export function createRoutingKit(options: RoutingKitOptions): RoutingKit {
        if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
                throw new TypeError(
                        'createRoutingKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
                );
        }
        const record = options as RoutingKitOptions;
        const adaptersAdmission = admitProviderAdapterRecord(record.adapters, record.catalog);
        if (!adaptersAdmission.admitted) {
                throw new TypeError(
                        `createRoutingKit: the bound adapter record must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
                );
        }
        const boundAdapterSetId = adaptersAdmission.record.adapterSetId;
        const adaptersById = new Map<string, ProviderAdapterDescriptor>();
        for (const adapter of adaptersAdmission.record.adapters) {
                adaptersById.set(adapter.adapterId, adapter);
        }
        const sidecar = record.sidecar;
        if (sidecar !== undefined && !isUsableSidecar(sidecar)) {
                throw new TypeError(
                        'createRoutingKit: options.sidecar, when present, must satisfy the landed SidecarKit interface (list and reportSnapshot functions) - a sidecar is never required, but a malformed one is never silently ignored',
                );
        }
        const now = record.now;
        if (!isFiniteEpochMs(now())) {
                throw new TypeError(
                        'createRoutingKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
                );
        }
        const registered = new Map<string, RoutingCandidate>();

        const kit: RoutingKit = {
                addCandidate(candidate: unknown): RoutingAdmission {
                        return admitCandidate(candidate, registered, adaptersById);
                },
                route(input: { readonly at: number }): RoutingOutcome {
                        if (!isRecord(input) || !isFiniteEpochMs((input as Record<string, unknown>).at)) {
                                throw new TypeError(
                                        'route: input.at must be a finite epoch-ms number (the injected probe instant - the kit never reads a clock itself)',
                                );
                        }
                        const at = (input as { readonly at: number }).at;
                        const scan = scanCandidates(registered, adaptersById, sidecar, at);
                        if (scan.eligible.length === 0) {
                                // Zero eligible candidates: the typed exhausted outcome
                                // carrying the FULL honest ledger - never a silent empty.
                                return {
                                        kind: 'exhausted',
                                        contractVersion: ROUTING_KIT_VERSION,
                                        atEpochMs: at,
                                        attemptLedger: scan.ledger,
                                };
                        }
                        // THE DISCLOSED SELECTION RULE: the scan walks the
                        // candidates in ascending adapterId order, so the FIRST
                        // eligible candidate IS the selection - deterministic,
                        // no randomness, no fabricated ranking.
                        const chosen = scan.eligible[0];
                        const decision = buildDecision(chosen, at);
                        const attemptLedger = scan.ledger.map((entry) =>
                                entry.outcome === 'eligible' && entry.adapterId === chosen.candidate.adapterId
                                        ? { ...entry, outcome: 'selected' as const }
                                        : entry,
                        );
                        return {
                                kind: 'selected',
                                contractVersion: ROUTING_KIT_VERSION,
                                decision,
                                attemptLedger,
                        };
                },
                runWithFailover(input: RunWithFailoverInput): FailoverOutcome {
                        const rejection = validateFailoverInput(input);
                        if (rejection !== undefined) {
                                return rejection;
                        }
                        const run = input as RunWithFailoverInput;
                        const scan = scanCandidates(registered, adaptersById, sidecar, run.at);
                        if (scan.eligible.length === 0) {
                                return {
                                        kind: 'exhausted',
                                        contractVersion: ROUTING_KIT_VERSION,
                                        atEpochMs: run.at,
                                        attemptLedger: scan.ledger,
                                };
                        }
                        const runLedger: RoutingAttempt[] = [...scan.ledger];
                        let engineTime = run.at;
                        let thunkCalls = 0;
                        for (const entry of scan.eligible) {
                                for (let attemptIndex = 0; attemptIndex < run.policy.maxAttempts; attemptIndex++) {
                                        if (attemptIndex > 0) {
                                                // The retry delay: deterministic arithmetic over the
                                                // injected schedule (failover itself is immediate - the
                                                // schedule spaces RETRIES, not failovers).
                                                engineTime += run.policy.backoffScheduleMs[attemptIndex - 1];
                                        }
                                        // EVERY attempt is re-gated at its own computed time with the
                                        // SAME observed effective snapshot (the engine re-reads no
                                        // external state mid-run). A gate trip ends the candidate's
                                        // budget - recorded honestly - and fails over immediately.
                                        const skip = gateAt(entry.effectiveSnapshot, engineTime);
                                        if (skip !== undefined) {
                                                runLedger.push({
                                                        adapterId: entry.candidate.adapterId,
                                                        atEpochMs: engineTime,
                                                        outcome: skip.outcome,
                                                        reason: skip.reason,
                                                });
                                                break;
                                        }
                                        thunkCalls += 1;
                                        const outcome = run.attempt(entry.candidate);
                                        if (outcome === 'succeeded') {
                                                runLedger.push({
                                                        adapterId: entry.candidate.adapterId,
                                                        atEpochMs: engineTime,
                                                        outcome: 'attempted-succeeded',
                                                        reason: 'none',
                                                });
                                                return {
                                                        kind: 'succeeded',
                                                        contractVersion: ROUTING_KIT_VERSION,
                                                        adapterId: entry.candidate.adapterId,
                                                        atEpochMs: run.at,
                                                        attemptCount: thunkCalls,
                                                        attemptLedger: runLedger,
                                                };
                                        }
                                        runLedger.push({
                                                adapterId: entry.candidate.adapterId,
                                                atEpochMs: engineTime,
                                                outcome: 'attempted-failed',
                                                reason: 'attempt-failed',
                                        });
                                }
                        }
                        return {
                                kind: 'exhausted',
                                contractVersion: ROUTING_KIT_VERSION,
                                atEpochMs: run.at,
                                attemptLedger: runLedger,
                        };
                },
                reportSnapshot(): RoutingKitSnapshot {
                        const foldedAtEpochMs = now();
                        if (!isFiniteEpochMs(foldedAtEpochMs)) {
                                throw new TypeError(
                                        'reportSnapshot: the injected clock must produce a finite epoch-ms fold time',
                                );
                        }
                        const rows = sortedCandidates(registered).map((candidate) => {
                                const adapter = adaptersById.get(candidate.adapterId);
                                if (adapter === undefined) {
                                        throw new TypeError(
                                                `reportSnapshot: the admitted candidate '${candidate.adapterId}' must resolve in the bound adapter record - never a dangling ref`,
                                        );
                                }
                                const sidecarSnapshot = readSidecar(sidecar, adapter.providerEntryId);
                                return {
                                        adapterId: candidate.adapterId,
                                        snapshot: sidecarSnapshot ?? candidate.report.snapshot,
                                        observedViaSidecar: sidecarSnapshot !== undefined,
                                };
                        });
                        return {
                                contractVersion: ROUTING_KIT_VERSION,
                                routingSetId: boundAdapterSetId,
                                foldedAtEpochMs,
                                rows,
                        };
                },
                unknownCandidate(adapterId: string): RoutingCandidate | undefined {
                        const adapter = adaptersById.get(adapterId);
                        if (adapter === undefined) {
                                return undefined;
                        }
                        // THE NO-FABRICATION LAW: the honest no-observation candidate
                        // rides the landed reportAdapterSnapshot fold over an
                        // ALL-UNKNOWN observation (health 'unknown', quota unknown, no
                        // cooldown, unknown reset) and an unverified provenance naming
                        // the adapter's provider entry with the routing probe scope -
                        // never a fabricated healthy state.
                        const observedAtEpochMs = now();
                        if (!isFiniteEpochMs(observedAtEpochMs)) {
                                throw new TypeError(
                                        'unknownCandidate: the injected clock must produce a finite epoch-ms observation time',
                                );
                        }
                        const observation: AdapterObservation = {
                                observedAtEpochMs,
                                health: 'unknown',
                                quota: { state: 'unknown' },
                                cooldown: { state: 'none' },
                                reset: { kind: 'unknown' },
                        };
                        const report = reportAdapterSnapshot(adapter, observation, {
                                requestedProviderId: adapter.providerEntryId,
                                requestedModelId: ROUTING_PROBE_SCOPE,
                                actualProviderId: adapter.providerEntryId,
                                actualModelId: ROUTING_PROBE_SCOPE,
                                recordedAtEpochMs: observedAtEpochMs,
                        });
                        return { adapterId, report };
                },
                count(): number {
                        return registered.size;
                },
                list(): readonly RoutingCandidate[] {
                        return sortedCandidates(registered);
                },
        };
        return kit;
}

/**
 * Canonical serialization of the kit's audit record (the
 * RoutingKitSnapshot state fold): fixed key order (contractVersion,
 * routingSetId, foldedAtEpochMs, rows in the fold's own sorted
 * order), deterministic bytes regardless of the input record's key
 * insertion order - the capacity snapshot sub-records mirror the
 * landed adapter family's canonical snapshot key order (cited, never
 * re-derived semantics). Refuses non-well-formed folds (fail closed:
 * no dishonest kit state ever gets canonical bytes). This canonical
 * form is the persistence/audit shape for the INF-006..009 binders
 * (INF-008's UI renders it).
 */
export function serializeRoutingRecord(snapshot: unknown): string {
        if (!isRoutingKitSnapshot(snapshot)) {
                throw new TypeError(
                        'serializeRoutingRecord: snapshot must be a well-formed RoutingKitSnapshot stamped with the routing contract-set version - no dishonest kit state ever gets canonical bytes',
                );
        }
        return JSON.stringify({
                contractVersion: snapshot.contractVersion,
                routingSetId: snapshot.routingSetId,
                foldedAtEpochMs: snapshot.foldedAtEpochMs,
                rows: snapshot.rows.map((row) => ({
                        adapterId: row.adapterId,
                        snapshot: canonicalSnapshotObject(row.snapshot),
                        observedViaSidecar: row.observedViaSidecar,
                })),
        });
}

/**
 * The candidate admission walk - the frozen
 * ROUTING_REJECTION_REASONS list order, first failure is THE
 * verdict. Shape checks run first (the landed kit idiom): a
 * malformed duplicate reports the shape reason, never the duplicate.
 * The admitted candidate is stored verbatim; a repeat of its id is
 * the typed duplicate rejection, never a silent overwrite.
 */
function admitCandidate(
        candidate: unknown,
        registered: Map<string, RoutingCandidate>,
        adaptersById: Map<string, ProviderAdapterDescriptor>,
): RoutingAdmission {
        if (!isRecord(candidate)) {
                return rejectCandidate('not-an-object', 'candidate must be a non-null object');
        }
        const input = candidate as Record<string, unknown>;
        const adapterId = input.adapterId;
        if (!isNonEmptyString(adapterId)) {
                return rejectCandidate('adapter-id-empty', 'adapterId must be a non-empty string');
        }
        const report = input.report;
        if (!isAdapterHealthReport(report)) {
                return rejectCandidate(
                        'adapter-report-malformed',
                        'report must satisfy the landed isAdapterHealthReport - a candidate without an honest health report is never admitted',
                );
        }
        if (report.adapterId !== adapterId) {
                return rejectCandidate(
                        'adapter-report-malformed',
                        `the report names adapterId '${report.adapterId}' but the candidate is '${adapterId}' - a candidate carrying another adapter's report is misattributed`,
                );
        }
        const adapter = adaptersById.get(adapterId);
        if (adapter === undefined) {
                // THE NO-DANGLING-REF LAW, extended to routing: a candidate id
                // that resolves to no admitted adapter is a typed rejection.
                return rejectCandidate(
                        'routing-unknown-adapter',
                        `the candidate adapterId '${adapterId}' resolves to no admitted adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
                );
        }
        if (report.snapshot.providerId !== adapter.providerEntryId) {
                return rejectCandidate(
                        'adapter-report-misattributed',
                        `the report's snapshot names provider '${report.snapshot.providerId}' but adapter '${adapterId}' serves provider '${adapter.providerEntryId}' - a capacity report attributed to the wrong provider is a lie`,
                );
        }
        if (registered.has(adapterId)) {
                // THE DUPLICATE LAW: a repeat is a typed rejection - the kit
                // never silently overwrites.
                return rejectCandidate(
                        'routing-candidate-duplicate',
                        `the candidate adapterId '${adapterId}' is already admitted in this routing set - an admitted adapter id is unique, never a silent overwrite`,
                );
        }
        const admittedCandidate: RoutingCandidate = { adapterId, report };
        registered.set(adapterId, admittedCandidate);
        return { admitted: true, candidate: admittedCandidate };
}

interface ScanEntry {
        readonly candidate: RoutingCandidate;
        readonly effectiveSnapshot: ProviderCapacitySnapshot;
}

/**
 * The eligibility scan at an injected instant: every admitted
 * candidate (ascending adapterId order - the disclosed selection
 * rule's order) appears exactly once in the ledger - eligible or
 * honestly skipped; the optional sidecar is read once per candidate
 * (one observation per call). Deterministic: same inputs, same
 * ledger, same eligible order.
 */
function scanCandidates(
        registered: Map<string, RoutingCandidate>,
        adaptersById: Map<string, ProviderAdapterDescriptor>,
        sidecar: SidecarKit | undefined,
        atEpochMs: number,
): { ledger: RoutingAttempt[]; eligible: ScanEntry[] } {
        const ledger: RoutingAttempt[] = [];
        const eligible: ScanEntry[] = [];
        for (const candidate of sortedCandidates(registered)) {
                const adapter = adaptersById.get(candidate.adapterId);
                if (adapter === undefined) {
                        throw new TypeError(
                                `route: the admitted candidate '${candidate.adapterId}' must resolve in the bound adapter record - never a dangling ref`,
                        );
                }
                const sidecarSnapshot = readSidecar(sidecar, adapter.providerEntryId);
                const effectiveSnapshot = sidecarSnapshot ?? candidate.report.snapshot;
                const skip = gateAt(effectiveSnapshot, atEpochMs);
                if (skip !== undefined) {
                        ledger.push({
                                adapterId: candidate.adapterId,
                                atEpochMs,
                                outcome: skip.outcome,
                                reason: skip.reason,
                        });
                } else {
                        ledger.push({
                                adapterId: candidate.adapterId,
                                atEpochMs,
                                outcome: 'eligible',
                                reason: 'none',
                        });
                        eligible.push({ candidate, effectiveSnapshot });
                }
        }
        return { ledger, eligible };
}

interface GateSkip {
        readonly outcome: 'skipped-cooldown' | 'skipped-quota';
        readonly reason: RoutingAttemptReason;
}

/**
 * The two eligibility gates at an injected instant, THE DELEGATED
 * BOUNDARY MATH (cooldown first - the frozen outcome order; a
 * candidate tripping both reports the cooldown):
 *   1. the cooldown gate - the landed cooldownActive (INCLUSIVE
 *      boundaries): the authority on ACTIVE; a stale 'cooldown'
 *      health label with no active interval does NOT gate;
 *   2. the quota gate - a KNOWN quota at zero remaining inside its
 *      INCLUSIVE window (the landed quotaWindowContains): a genuine
 *      current exhaustion. A zero remaining outside its window is a
 *      stale observation - the landed projection discloses it as-is
 *      and the router fabricates no verdict from it.
 */
function gateAt(snapshot: ProviderCapacitySnapshot, atEpochMs: number): GateSkip | undefined {
        if (cooldownActive(snapshot.cooldown, atEpochMs)) {
                return {
                        outcome: 'skipped-cooldown',
                        reason: (snapshot.cooldown as ActiveCooldown).reason,
                };
        }
        const quota = snapshot.quota;
        if (quota.state === 'known' && quota.remaining <= 0 && quotaWindowContains(quota.window, atEpochMs)) {
                return { outcome: 'skipped-quota', reason: 'quota-exhausted' };
        }
        return undefined;
}

/**
 * The decision build: DISCLOSURE THROUGH THE PROJECTION - the landed
 * projectCapacityDisclosure is the ONLY disclosure path (the
 * candidate's own report provenance rides it verbatim; the effective
 * snapshot may be the optional sidecar's fold, which names the same
 * provider the attribution laws already pinned). A projection
 * rejection is a fail-closed TypeError, never a hand-built
 * disclosure. The kit's version stamp is then checked through the
 * CONTRACT module's guard (the drift fail-closed law).
 */
function buildDecision(chosen: ScanEntry, atEpochMs: number): RoutingDecision {
        const projected = projectCapacityDisclosure(
                chosen.effectiveSnapshot,
                chosen.candidate.report.provenance,
                atEpochMs,
        );
        if (!projected.disclosed) {
                throw new TypeError(
                        `route: the capacity projection rejected the chosen candidate: '${projected.reason}': ${projected.detail}`,
                );
        }
        const decision: RoutingDecision = {
                contractVersion: ROUTING_KIT_VERSION,
                adapterId: chosen.candidate.adapterId,
                selectionRule: 'stable-adapter-id-order',
                disclosure: projected.disclosure,
                decidedAtEpochMs: atEpochMs,
        };
        if (!isRoutingDecision(decision)) {
                // The kit's own literal stamp is checked through the CONTRACT
                // guard's copy - a version drift fails closed here, never
                // reaching the caller as a valid-looking decision.
                throw new TypeError(
                        'route: the produced decision must satisfy isRoutingDecision (the kit and contract version copies must agree - the drift fails closed)',
                );
        }
        return decision;
}

/**
 * The failover input validation - the frozen
 * FAILOVER_REJECTION_REASONS order, first failure is THE verdict.
 * The thunk, the policy arithmetic and the start instant are all
 * caller-injected; a malformed input is a typed rejection, never a
 * silent default.
 */
function validateFailoverInput(input: unknown): FailoverRejected | undefined {
        if (!isRecord(input) || typeof input.attempt !== 'function') {
                return rejectFailover(
                        'invalid-attempt-thunk',
                        'input.attempt must be a caller-injected function (candidate) => AttemptOutcome - the engine never performs IO itself',
                );
        }
        const policy = input.policy;
        let maxAttempts: number;
        if (isRecord(policy) && isBoundedAttempts((policy as Record<string, unknown>).maxAttempts)) {
                maxAttempts = (policy as Record<string, unknown>).maxAttempts as number;
        } else {
                return rejectFailover(
                        'invalid-max-attempts',
                        'policy.maxAttempts must be an integer >= 1 (the per-candidate attempt bound)',
                );
        }
        const schedule = isRecord(policy) ? (policy as Record<string, unknown>).backoffScheduleMs : undefined;
        if (
                !Array.isArray(schedule)
                || schedule.length !== maxAttempts - 1
                || !schedule.every((delay) => isFiniteEpochMs(delay) && (delay as number) >= 0)
        ) {
                return rejectFailover(
                        'invalid-backoff-schedule',
                        `policy.backoffScheduleMs must be an array of exactly maxAttempts-1 (${maxAttempts - 1}) finite non-negative epoch-ms delays (the injected backoff schedule - the engine performs no hidden arithmetic)`,
                );
        }
        if (!isFiniteEpochMs(input.at)) {
                return rejectFailover(
                        'invalid-at',
                        'input.at must be a finite epoch-ms number (the injected run-start instant - the kit never reads a clock itself)',
                );
        }
        return undefined;
}

/**
 * THE OPTIONAL-SIDECAR LAW resolution: when a bound sidecar SERVES
 * the candidate's provider, its reportSnapshot fold IS the effective
 * observed state (the landed kit's list() is the stable
 * sorted-by-sidecarId order - the first record serving the provider
 * wins, deterministically); the landed fold's own fail-closed laws
 * (malformed or misattributed attached state, and its honest
 * unknownSnapshot no-state default) apply verbatim - never swallowed
 * here. No record serving the provider -> undefined (the candidate's
 * own report drives).
 */
function readSidecar(
        sidecar: SidecarKit | undefined,
        providerEntryId: string,
): ProviderCapacitySnapshot | undefined {
        if (sidecar === undefined) {
                return undefined;
        }
        for (const sidecarRecord of sidecar.list()) {
                if (sidecarRecord.providerId === providerEntryId) {
                        return sidecar.reportSnapshot(sidecarRecord.sidecarId);
                }
        }
        return undefined;
}

/**
 * The private fold guard for serializeRoutingRecord: a well-formed,
 * version-stamped kit snapshot (checked against the CONTRACT
 * module's copy - the drift fail-closed law) with a non-empty
 * routing set id, a finite fold time and well-formed rows.
 */
function isRoutingKitSnapshot(value: unknown): value is RoutingKitSnapshot {
        if (!isRecord(value)) {
                return false;
        }
        const snapshot = value as Record<string, unknown>;
        if (snapshot.contractVersion !== INFERENCE_ROUTING_VERSION) {
                return false;
        }
        if (!isNonEmptyString(snapshot.routingSetId)) {
                return false;
        }
        if (!isFiniteEpochMs(snapshot.foldedAtEpochMs)) {
                return false;
        }
        if (!Array.isArray(snapshot.rows)) {
                return false;
        }
        for (const row of snapshot.rows) {
                if (!isRecord(row)) {
                        return false;
                }
                const rowRecord = row as Record<string, unknown>;
                if (!isNonEmptyString(rowRecord.adapterId)) {
                        return false;
                }
                if (!isProviderCapacitySnapshot(rowRecord.snapshot)) {
                        return false;
                }
                if (typeof rowRecord.observedViaSidecar !== 'boolean') {
                        return false;
                }
        }
        return true;
}

/**
 * The canonical capacity snapshot object: fixed key order per state
 * kind, MIRRORING the landed adapter family's canonical snapshot key
 * order (the cited idiom - the key order is mirrored, the state
 * semantics are the snapshot's own).
 */
function canonicalSnapshotObject(snapshot: ProviderCapacitySnapshot): Record<string, unknown> {
        return {
                contractVersion: snapshot.contractVersion,
                providerId: snapshot.providerId,
                verification: snapshot.verification,
                health: snapshot.health,
                quota:
                        snapshot.quota.state === 'known'
                                ? {
                                                state: 'known',
                                                remaining: snapshot.quota.remaining,
                                                limit: snapshot.quota.limit,
                                                window: {
                                                        kind: snapshot.quota.window.kind,
                                                        windowStartEpochMs: snapshot.quota.window.windowStartEpochMs,
                                                        windowLengthMs: snapshot.quota.window.windowLengthMs,
                                                },
                                        }
                                : { state: 'unknown' },
                cooldown:
                        snapshot.cooldown.state === 'active'
                                ? {
                                                state: 'active',
                                                reason: snapshot.cooldown.reason,
                                                sinceEpochMs: snapshot.cooldown.sinceEpochMs,
                                                untilEpochMs: snapshot.cooldown.untilEpochMs,
                                        }
                                : { state: 'none' },
                resetSchedule: canonicalResetScheduleObject(snapshot.resetSchedule),
                observedAtEpochMs: snapshot.observedAtEpochMs,
        };
}

/** The canonical reset-schedule object: fixed key order per kind (the cited idiom). */
function canonicalResetScheduleObject(schedule: ProviderCapacitySnapshot['resetSchedule']): Record<string, unknown> {
        switch (schedule.kind) {
                case 'fixed-instant':
                        return { kind: 'fixed-instant', atEpochMs: schedule.atEpochMs };
                case 'interval-aligned':
                        return {
                                kind: 'interval-aligned',
                                anchorEpochMs: schedule.anchorEpochMs,
                                intervalMs: schedule.intervalMs,
                        };
                case 'provider-discretion':
                        return { kind: 'provider-discretion' };
                default:
                        return { kind: 'unknown' };
        }
}

/** The admitted candidates in ascending adapterId order (the disclosed rule's order). */
function sortedCandidates(registered: Map<string, RoutingCandidate>): RoutingCandidate[] {
        return [...registered.values()].sort((left, right) => {
                if (left.adapterId < right.adapterId) {
                        return -1;
                }
                return left.adapterId > right.adapterId ? 1 : 0;
        });
}

/** The optional sidecar's structural shape: the landed interface's used surface. */
function isUsableSidecar(sidecar: unknown): sidecar is SidecarKit {
        return (
                isRecord(sidecar)
                && typeof (sidecar as Record<string, unknown>).list === 'function'
                && typeof (sidecar as Record<string, unknown>).reportSnapshot === 'function'
        );
}

function isBoundedAttempts(value: unknown): value is number {
        return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function rejectCandidate(reason: RoutingRejectionReason, detail: string): RoutingAdmission {
        return { admitted: false, reason, detail };
}

function rejectFailover(reason: FailoverRejectionReason, detail: string): FailoverRejected {
        return { kind: 'rejected', reason, detail };
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
