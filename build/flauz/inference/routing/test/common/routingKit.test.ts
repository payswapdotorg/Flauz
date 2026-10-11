/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-005 routing kit test suite (mocha tdd style, matching
 * build/flauz/inference/sidecar/test/common/sidecarKit.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle, adapter-set/catalog id and probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (the health states, the cooldown
 * reasons, the selection rule, the version stamps, the disclosed
 * sidecar fixture ids) are the contract's own values under test.
 * Runtime-boundary probes are injected as JSON-parsed values, the
 * shape foreign input arrives in at a real boundary. All timestamps
 * are injected plain-number epoch milliseconds; the suites never
 * read a clock.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        INFERENCE_ROUTING_VERSION as KIT_REEXPORT_INFERENCE_ROUTING_VERSION,
        ROUTING_KIT_VERSION,
        ROUTING_PROBE_SCOPE,
        createRoutingKit,
        serializeRoutingRecord,
} from '../../common/routingKit.js';
import type { RoutingKit, RunWithFailoverInput } from '../../common/routingKit.js';
import {
        INFERENCE_ROUTING_VERSION as CONTRACT_INFERENCE_ROUTING_VERSION,
        isRoutingCandidate,
        isRoutingDecision,
        serializeRoutingDecision,
} from '../../common/routingContract.js';
import type { AttemptOutcome, RoutingAttempt, RoutingDecision } from '../../common/routingContract.js';
import {
        cooldownActive,
        markProvenanceVerified,
        projectCapacityDisclosure,
        quotaWindowContains,
        unknownSnapshot,
} from '../../../semantics/common/capacityDisclosure.js';
import type {
        CooldownReason,
        ProviderCapacityDisclosure,
        ProviderCapacitySnapshot,
} from '../../../semantics/common/capacityDisclosure.js';
import {
        INFERENCE_ADAPTER_VERSION,
        isAdapterHealthReport,
        markReportVerified,
        reportAdapterSnapshot,
} from '../../../adapters/common/providerAdapter.js';
import type {
        AdapterObservation,
        AdapterTransportKind,
        ProviderAdapterDescriptor,
        ProviderAdapterHealthReport,
        ProviderAdapterRecord,
} from '../../../adapters/common/providerAdapter.js';
import type { CapacityProvenance } from '../../../semantics/common/planSemantics.js';
import {
        INFERENCE_CATALOG_VERSION,
        unknownCapacityEntry,
} from '../../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../../catalog/common/providerCatalog.js';
import {
        FIXTURE_SIDECAR_NO_STATE_ID,
        createSidecarKit,
} from '../../../sidecar/common/sidecarKit.js';
import type { SidecarKit } from '../../../sidecar/common/sidecarKit.js';

const FIXTURE_CATALOG_ID = 'fixture.catalog.routing';
const FIXTURE_ADAPTER_SET_ID = 'fixture.adapter-set.routing';
const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_GAMMA = 'fixture.adapter.gamma';
const FIXTURE_ADAPTER_DELTA = 'fixture.adapter.delta';
const FIXTURE_PROVIDER_ALPHA = 'fixture.provider.alpha';
const FIXTURE_PROVIDER_BETA = 'fixture.provider.beta';
const FIXTURE_PROVIDER_GAMMA = 'fixture.provider.gamma';
const FIXTURE_PROVIDER_DELTA = 'fixture.provider.delta';
const FIXTURE_MODEL_MAIN = 'fixture.model.main';
const FIXTURE_CREDENTIAL_ALPHA = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_BETA = 'fixture.credential.handle.beta';
const FIXTURE_CREDENTIAL_GAMMA = 'fixture.credential.handle.gamma';
const FIXTURE_CREDENTIAL_DELTA = 'fixture.credential.handle.delta';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_COOLDOWN_HALF_MS = 60_000;
const FIXTURE_BACKOFF_MS = 15_000;

interface AdapterTableRow {
        readonly entryId: string;
        readonly transportKind: AdapterTransportKind;
        readonly provenance: CapacityProvenance;
        readonly handle: string;
}

const ADAPTER_TABLE: Record<string, AdapterTableRow> = {
        [FIXTURE_ADAPTER_ALPHA]: {
                entryId: FIXTURE_PROVIDER_ALPHA,
                transportKind: 'http-generic-json',
                provenance: 'user-owned-endpoint',
                handle: FIXTURE_CREDENTIAL_ALPHA,
        },
        [FIXTURE_ADAPTER_BETA]: {
                entryId: FIXTURE_PROVIDER_BETA,
                transportKind: 'local-sidecar',
                provenance: 'third-party-free-tier',
                handle: FIXTURE_CREDENTIAL_BETA,
        },
        [FIXTURE_ADAPTER_GAMMA]: {
                entryId: FIXTURE_PROVIDER_GAMMA,
                transportKind: 'http-generic-json',
                provenance: 'third-party-free-tier',
                handle: FIXTURE_CREDENTIAL_GAMMA,
        },
        [FIXTURE_ADAPTER_DELTA]: {
                entryId: FIXTURE_PROVIDER_DELTA,
                transportKind: 'http-generic-json',
                provenance: 'user-owned-endpoint',
                handle: FIXTURE_CREDENTIAL_DELTA,
        },
};

function fixtureDescriptorFor(adapterId: string): ProviderAdapterDescriptor {
        const row = ADAPTER_TABLE[adapterId];
        return {
                adapterId,
                displayName: `Fixture Adapter ${adapterId}`,
                providerEntryId: row.entryId,
                transportKind: row.transportKind,
                capacityProvenance: row.provenance,
                credentialHandle: row.handle,
                contractVersion: INFERENCE_ADAPTER_VERSION,
        };
}

function fixtureAdapterRecord(): ProviderAdapterRecord {
        return {
                adapterSetId: FIXTURE_ADAPTER_SET_ID,
                adapters: [
                        fixtureDescriptorFor(FIXTURE_ADAPTER_ALPHA),
                        fixtureDescriptorFor(FIXTURE_ADAPTER_BETA),
                        fixtureDescriptorFor(FIXTURE_ADAPTER_GAMMA),
                        fixtureDescriptorFor(FIXTURE_ADAPTER_DELTA),
                ],
                contractVersion: INFERENCE_ADAPTER_VERSION,
        };
}

function fixtureCatalogRecord(): ProviderCatalogRecord {
        return {
                catalogId: FIXTURE_CATALOG_ID,
                entries: [
                        unknownCapacityEntry(FIXTURE_PROVIDER_ALPHA, 'third-party-free-tier', FIXTURE_NOW_MS),
                        unknownCapacityEntry(FIXTURE_PROVIDER_BETA, 'user-owned-endpoint', FIXTURE_NOW_MS),
                        unknownCapacityEntry(FIXTURE_PROVIDER_GAMMA, 'third-party-free-tier', FIXTURE_NOW_MS),
                        unknownCapacityEntry(FIXTURE_PROVIDER_DELTA, 'user-owned-endpoint', FIXTURE_NOW_MS),
                ],
                contractVersion: INFERENCE_CATALOG_VERSION,
        };
}

function healthyObservationAt(at: number): AdapterObservation {
        return {
                observedAtEpochMs: at,
                health: 'healthy',
                quota: {
                        state: 'known',
                        remaining: 42,
                        limit: 60,
                        window: {
                                kind: 'fixed',
                                windowStartEpochMs: at,
                                windowLengthMs: 2 * FIXTURE_COOLDOWN_HALF_MS,
                        },
                },
                cooldown: { state: 'none' },
                reset: { kind: 'unknown' },
        };
}

function cooldownObservationAt(at: number, reason: CooldownReason = 'rate-limited'): AdapterObservation {
        return {
                ...healthyObservationAt(at),
                health: 'cooldown',
                cooldown: {
                        state: 'active',
                        reason,
                        sinceEpochMs: at - FIXTURE_COOLDOWN_HALF_MS,
                        untilEpochMs: at + FIXTURE_COOLDOWN_HALF_MS,
                },
        };
}

/** A cooldown that begins in the FUTURE (the first attempt passes, the retry re-gate trips). */
function futureCooldownObservationAt(at: number): AdapterObservation {
        return {
                ...healthyObservationAt(at),
                cooldown: {
                        state: 'active',
                        reason: 'rate-limited',
                        sinceEpochMs: at + 5_000,
                        untilEpochMs: at + FIXTURE_COOLDOWN_HALF_MS,
                },
        };
}

function exhaustedQuotaObservationAt(at: number): AdapterObservation {
        return {
                ...healthyObservationAt(at),
                quota: {
                        state: 'known',
                        remaining: 0,
                        limit: 60,
                        window: {
                                kind: 'fixed',
                                windowStartEpochMs: at - FIXTURE_COOLDOWN_HALF_MS,
                                windowLengthMs: 2 * FIXTURE_COOLDOWN_HALF_MS,
                        },
                },
        };
}

function unknownObservationAt(at: number): AdapterObservation {
        return {
                observedAtEpochMs: at,
                health: 'unknown',
                quota: { state: 'unknown' },
                cooldown: { state: 'none' },
                reset: { kind: 'unknown' },
        };
}

function fixtureReportFor(adapterId: string, observation: AdapterObservation): ProviderAdapterHealthReport {
        const row = ADAPTER_TABLE[adapterId];
        return reportAdapterSnapshot(fixtureDescriptorFor(adapterId), observation, {
                requestedProviderId: row.entryId,
                requestedModelId: FIXTURE_MODEL_MAIN,
                actualProviderId: row.entryId,
                actualModelId: FIXTURE_MODEL_MAIN,
                recordedAtEpochMs: observation.observedAtEpochMs,
        });
}

function fixedClock(): number {
        return FIXTURE_NOW_MS;
}

function sequencedClock(startEpochMs: number, stepMs: number): { now: () => number } {
        let current = startEpochMs;
        return {
                now: () => {
                        const at = current;
                        current += stepMs;
                        return at;
                },
        };
}

function fixtureKit(): RoutingKit {
        return createRoutingKit({
                now: fixedClock,
                adapters: fixtureAdapterRecord(),
                catalog: fixtureCatalogRecord(),
        });
}

function fixtureKitWithSidecar(sidecar: SidecarKit): RoutingKit {
        return createRoutingKit({
                now: fixedClock,
                adapters: fixtureAdapterRecord(),
                catalog: fixtureCatalogRecord(),
                sidecar,
        });
}

function fixtureSidecar(): SidecarKit {
        return createSidecarKit({ now: fixedClock });
}

function admitCandidate(kit: RoutingKit, adapterId: string, observation: AdapterObservation): void {
        const admission = kit.addCandidate({ adapterId, report: fixtureReportFor(adapterId, observation) });
        assert.equal(
                admission.admitted,
                true,
                `expected admission, got: ${JSON.stringify(admission)}`,
        );
}

function selectedDecision(kit: RoutingKit, at: number): RoutingDecision {
        const outcome = kit.route({ at });
        assert.equal(outcome.kind, 'selected', `expected a selection, got: ${JSON.stringify(outcome)}`);
        return outcome.decision;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
        return JSON.parse(value);
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
        const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
        const source = readFileSync(modulePath, 'utf8');
        return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

/** A counting attempt thunk: fails for the given adapter ids, succeeds otherwise. */
function countingThunk(failFor: readonly string[]): { attempt: (candidate: { adapterId: string }) => AttemptOutcome; calls: () => number } {
        let calls = 0;
        return {
                attempt: (candidate: { adapterId: string }): AttemptOutcome => {
                        calls += 1;
                        return failFor.includes(candidate.adapterId) ? 'failed' : 'succeeded';
                },
                calls: () => calls,
        };
}

function eligibleLine(adapterId: string, atEpochMs: number): RoutingAttempt {
        return { adapterId, atEpochMs, outcome: 'eligible', reason: 'none' };
}

function attemptedFailedLine(adapterId: string, atEpochMs: number): RoutingAttempt {
        return { adapterId, atEpochMs, outcome: 'attempted-failed', reason: 'attempt-failed' };
}

/** The landed projection applied to a fixture report (disclosure through the projection). */
function projectDisclosureOf(
        report: ProviderAdapterHealthReport,
        atEpochMs: number,
): ProviderCapacityDisclosure {
        const projected = projectCapacityDisclosure(report.snapshot, report.provenance, atEpochMs);
        if (!projected.disclosed) {
                throw new Error(`fixture projection rejected: ${projected.reason}: ${projected.detail}`);
        }
        return projected.disclosure;
}

suite('INF-005 routing kit', () => {

        suite('createRoutingKit (the fail-closed factory)', () => {
                test('throws TypeError when options is missing or not an object', () => {
                        for (const bad of [undefined, null, 'fixture.options', 42, true]) {
                                assert.throws(() => createRoutingKit(bad as any), TypeError);
                        }
                });

                test('throws TypeError when now is not a function (the injected-clock law)', () => {
                        const base = { adapters: fixtureAdapterRecord(), catalog: fixtureCatalogRecord() };
                        assert.throws(() => createRoutingKit({ ...base } as any), TypeError);
                        assert.throws(() => createRoutingKit({ ...base, now: 42 } as any), TypeError);
                        assert.throws(() => createRoutingKit({ ...base, now: 'fixture.now' } as any), TypeError);
                });

                test('throws TypeError when the injected clock cannot produce a finite fold time', () => {
                        const base = { adapters: fixtureAdapterRecord(), catalog: fixtureCatalogRecord() };
                        assert.throws(() => createRoutingKit({ ...base, now: () => NaN } as any), TypeError);
                        assert.throws(() => createRoutingKit({ ...base, now: () => Infinity } as any), TypeError);
                });

                test('throws TypeError when the bound adapter record fails the landed guard (the reason cited verbatim)', () => {
                        const badRecord = { ...fixtureAdapterRecord(), contractVersion: '0.9.9' };
                        assert.throws(
                                () => createRoutingKit({ now: fixedClock, adapters: badRecord, catalog: fixtureCatalogRecord() }),
                                /admitProviderAdapterRecord.*version-mismatch/,
                        );
                });

                test('throws TypeError when the bound catalog fails the landed guard (cited through the adapter guard)', () => {
                        assert.throws(
                                () => createRoutingKit({ now: fixedClock, adapters: fixtureAdapterRecord(), catalog: {} }),
                                /invalid-catalog/,
                        );
                        assert.throws(
                                () => createRoutingKit({ now: fixedClock, adapters: fixtureAdapterRecord(), catalog: undefined }),
                                /admitProviderAdapterRecord/,
                        );
                });

                test('throws TypeError on a dangling provider ref in the adapter record (the no-dangling-ref law propagates)', () => {
                        const dangling = {
                                ...fixtureAdapterRecord(),
                                adapters: [
                                        {
                                                ...fixtureDescriptorFor(FIXTURE_ADAPTER_ALPHA),
                                                providerEntryId: 'fixture.provider.missing',
                                        },
                                ],
                        };
                        assert.throws(
                                () => createRoutingKit({ now: fixedClock, adapters: dangling, catalog: fixtureCatalogRecord() }),
                                /unknown-provider-entry/,
                        );
                });

                test('throws TypeError when a present sidecar is structurally malformed (never silently ignored)', () => {
                        const base = { now: fixedClock, adapters: fixtureAdapterRecord(), catalog: fixtureCatalogRecord() };
                        assert.throws(() => createRoutingKit({ ...base, sidecar: 42 } as any), TypeError);
                        assert.throws(() => createRoutingKit({ ...base, sidecar: {} } as any), TypeError);
                        assert.throws(
                                () => createRoutingKit({ ...base, sidecar: { list: 42, reportSnapshot: fixedClock } } as any),
                                TypeError,
                        );
                });

                test('a valid creation yields the kit surface, with and without an optional sidecar', () => {
                        const kit = fixtureKit();
                        assert.equal(typeof kit, 'object');
                        assert.equal(kit.count(), 0);
                        const sidecarKit = fixtureKitWithSidecar(fixtureSidecar());
                        assert.equal(typeof sidecarKit, 'object');
                        assert.equal(sidecarKit.count(), 0);
                });
        });

        suite('addCandidate (the frozen admission walk)', () => {
                test('admits a well-formed candidate through the landed report fold (incl. the JSON-parsed runtime boundary)', () => {
                        const kit = fixtureKit();
                        const report = fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const admission = kit.addCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report });
                        assert.equal(admission.admitted, true);
                        assert.deepEqual(admission.candidate, { adapterId: FIXTURE_ADAPTER_ALPHA, report });
                        assert.equal(kit.count(), 1);
                        // the runtime-boundary probe: the same honest candidate as the
                        // JSON-parsed shape foreign input arrives in at a real boundary.
                        const parsed = foreign(JSON.stringify({ adapterId: FIXTURE_ADAPTER_ALPHA, report }));
                        const parsedAdmission = kit.addCandidate(parsed);
                        assert.equal(parsedAdmission.admitted, false);
                        assert.equal(parsedAdmission.reason, 'routing-candidate-duplicate');
                        assert.equal(kit.count(), 1);
                        const freshKit = fixtureKit();
                        const freshParsed = foreign(JSON.stringify({ adapterId: FIXTURE_ADAPTER_ALPHA, report }));
                        assert.equal(freshKit.addCandidate(freshParsed).admitted, true);
                        assert.equal(freshKit.count(), 1);
                });

                test("'not-an-object' fires for non-object probes", () => {
                        const kit = fixtureKit();
                        for (const bad of [undefined, null, 'fixture.candidate', 42, true]) {
                                const admission = kit.addCandidate(bad as any);
                                assert.equal(admission.admitted, false);
                                assert.equal(admission.reason, 'not-an-object');
                        }
                });

                test("'adapter-id-empty' fires for empty, missing and non-string ids", () => {
                        const kit = fixtureKit();
                        const report = fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        for (const adapterId of [undefined, '', 42]) {
                                const admission = kit.addCandidate({ adapterId, report } as any);
                                assert.equal(admission.admitted, false);
                                assert.equal(admission.reason, 'adapter-id-empty');
                        }
                });

                test("'adapter-report-malformed' fires when the report fails the landed guard", () => {
                        const kit = fixtureKit();
                        const report = fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        for (const badReport of [undefined, 'fixture.report', { ...report, contractVersion: '0.9.9' }]) {
                                const admission = kit.addCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: badReport } as any);
                                assert.equal(admission.admitted, false);
                                assert.equal(admission.reason, 'adapter-report-malformed');
                        }
                });

                test("'adapter-report-malformed' fires when the report names another adapter id", () => {
                        const kit = fixtureKit();
                        const otherReport = fixtureReportFor(FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const admission = kit.addCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: otherReport });
                        assert.equal(admission.admitted, false);
                        assert.equal(admission.reason, 'adapter-report-malformed');
                });

                test("'routing-unknown-adapter' fires for a candidate resolving to no admitted adapter", () => {
                        const kit = fixtureKit();
                        const missingReport = reportAdapterSnapshot(
                                {
                                        ...fixtureDescriptorFor(FIXTURE_ADAPTER_ALPHA),
                                        adapterId: 'fixture.adapter.missing',
                                        providerEntryId: 'fixture.provider.missing',
                                },
                                healthyObservationAt(FIXTURE_NOW_MS),
                                {
                                        requestedProviderId: 'fixture.provider.missing',
                                        requestedModelId: FIXTURE_MODEL_MAIN,
                                        actualProviderId: 'fixture.provider.missing',
                                        actualModelId: FIXTURE_MODEL_MAIN,
                                        recordedAtEpochMs: FIXTURE_NOW_MS,
                                },
                        );
                        const admission = kit.addCandidate({
                                adapterId: 'fixture.adapter.missing',
                                report: missingReport,
                        });
                        assert.equal(admission.admitted, false);
                        assert.equal(admission.reason, 'routing-unknown-adapter');
                });

                test("'adapter-report-misattributed' fires when the report's snapshot names another provider", () => {
                        const kit = fixtureKit();
                        const misattributedReport = reportAdapterSnapshot(
                                {
                                        ...fixtureDescriptorFor(FIXTURE_ADAPTER_ALPHA),
                                        providerEntryId: 'fixture.provider.other',
                                },
                                healthyObservationAt(FIXTURE_NOW_MS),
                                {
                                        requestedProviderId: 'fixture.provider.other',
                                        requestedModelId: FIXTURE_MODEL_MAIN,
                                        actualProviderId: 'fixture.provider.other',
                                        actualModelId: FIXTURE_MODEL_MAIN,
                                        recordedAtEpochMs: FIXTURE_NOW_MS,
                                },
                        );
                        const admission = kit.addCandidate({
                                adapterId: FIXTURE_ADAPTER_ALPHA,
                                report: misattributedReport,
                        });
                        assert.equal(admission.admitted, false);
                        assert.equal(admission.reason, 'adapter-report-misattributed');
                });

                test("'routing-candidate-duplicate' fires on a repeat and never mutates the set", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const repeat = kit.addCandidate({
                                adapterId: FIXTURE_ADAPTER_ALPHA,
                                report: fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS)),
                        });
                        assert.equal(repeat.admitted, false);
                        assert.equal(repeat.reason, 'routing-candidate-duplicate');
                        assert.equal(kit.count(), 1);
                });

                test('the shape checks run FIRST: a malformed duplicate reports the shape reason, never the duplicate', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const malformedDuplicate = kit.addCandidate({
                                adapterId: FIXTURE_ADAPTER_ALPHA,
                                report: 'fixture.report',
                        } as any);
                        assert.equal(malformedDuplicate.admitted, false);
                        assert.equal(malformedDuplicate.reason, 'adapter-report-malformed');
                });

                test('rejections never mutate the kit (count and list unchanged)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const before = kit.list();
                        kit.addCandidate(undefined as any);
                        kit.addCandidate({ adapterId: '', report: null } as any);
                        kit.addCandidate({
                                adapterId: 'fixture.adapter.missing',
                                report: fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS)),
                        });
                        assert.equal(kit.count(), 1);
                        assert.deepEqual(kit.list(), before);
                });
        });

        suite('route (the disclosed deterministic selection)', () => {
                test('a single eligible candidate is selected with the decision fields pinned', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.equal(decision.selectionRule, 'stable-adapter-id-order');
                        assert.equal(decision.decidedAtEpochMs, FIXTURE_NOW_MS);
                        assert.equal(decision.contractVersion, ROUTING_KIT_VERSION);
                        assert.equal(isRoutingDecision(decision), true);
                });

                test('the disclosure rides the landed projection verbatim (disclosure through the projection)', () => {
                        const kit = fixtureKit();
                        const report = fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        kit.addCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report });
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.deepEqual(decision.disclosure, projectDisclosureOf(report, FIXTURE_NOW_MS));
                });

                test('NO-FABRICATION end-to-end: the no-observation candidate discloses honest-unknown states', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, unknownObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.disclosure.health, 'unknown');
                        assert.equal(decision.disclosure.capacityState, 'unknown');
                        assert.equal(decision.disclosure.quotaRemaining, 'unknown');
                        assert.deepEqual(decision.disclosure.resetExpectation, { kind: 'unknown' });
                        assert.equal(decision.disclosure.verification, 'unverified');
                });

                test('stable-adapter-id-order: the lexicographically first eligible is selected regardless of insertion order', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.deepEqual(
                                kit.list().map((candidate) => candidate.adapterId),
                                [FIXTURE_ADAPTER_ALPHA, FIXTURE_ADAPTER_BETA, FIXTURE_ADAPTER_GAMMA],
                        );
                });

                test("the selected outcome's ledger carries one selected line plus the eligible lines", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.route({ at: FIXTURE_NOW_MS });
                        assert.equal(outcome.kind, 'selected');
                        if (outcome.kind !== 'selected') {
                                throw new Error('unreachable');
                        }
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'selected',
                                        reason: 'none',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'eligible',
                                        reason: 'none',
                                },
                        ]);
                });

                test('the cooldown gate is INCLUSIVE at both boundaries (exactly-on at until, off one past it)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, cooldownObservationAt(FIXTURE_NOW_MS));
                        const until = FIXTURE_NOW_MS + FIXTURE_COOLDOWN_HALF_MS;
                        const atUntil = kit.route({ at: until });
                        assert.equal(atUntil.kind, 'exhausted');
                        if (atUntil.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.deepEqual(atUntil.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: until,
                                        outcome: 'skipped-cooldown',
                                        reason: 'rate-limited',
                                },
                        ]);
                        assert.equal(cooldownActive({ state: 'active', reason: 'rate-limited', sinceEpochMs: until - FIXTURE_COOLDOWN_HALF_MS, untilEpochMs: until }, until), true);
                        assert.equal(selectedDecision(kit, until + 1).adapterId, FIXTURE_ADAPTER_ALPHA);
                });

                test('the cooldown gate is INCLUSIVE at the since boundary (exactly-on at since, off one before it)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, cooldownObservationAt(FIXTURE_NOW_MS));
                        const since = FIXTURE_NOW_MS - FIXTURE_COOLDOWN_HALF_MS;
                        const atSince = kit.route({ at: since });
                        assert.equal(atSince.kind, 'exhausted');
                        assert.equal(selectedDecision(kit, since - 1).adapterId, FIXTURE_ADAPTER_ALPHA);
                });

                test('the quota gate is INCLUSIVE at both window boundaries (exactly-on, exactly-off)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, exhaustedQuotaObservationAt(FIXTURE_NOW_MS));
                        const windowStart = FIXTURE_NOW_MS - FIXTURE_COOLDOWN_HALF_MS;
                        const windowEnd = windowStart + 2 * FIXTURE_COOLDOWN_HALF_MS;
                        const window = {
                                kind: 'fixed' as const,
                                windowStartEpochMs: windowStart,
                                windowLengthMs: 2 * FIXTURE_COOLDOWN_HALF_MS,
                        };
                        assert.equal(quotaWindowContains(window, windowStart), true);
                        assert.equal(quotaWindowContains(window, windowEnd), true);
                        assert.equal(kit.route({ at: windowStart }).kind, 'exhausted');
                        assert.equal(kit.route({ at: windowEnd }).kind, 'exhausted');
                        assert.equal(selectedDecision(kit, windowStart - 1).adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.equal(selectedDecision(kit, windowEnd + 1).adapterId, FIXTURE_ADAPTER_ALPHA);
                });

                test('the exhausted quota ledger line carries the quota-exhausted reason', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, exhaustedQuotaObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.route({ at: FIXTURE_NOW_MS });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-quota',
                                        reason: 'quota-exhausted',
                                },
                        ]);
                });

                test('a stale zero remaining OUTSIDE its window never fabricates a verdict (the honest reading)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, exhaustedQuotaObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS + 10 * FIXTURE_COOLDOWN_HALF_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.equal(decision.disclosure.quotaRemaining, 0);
                });

                test('a positive remaining quota and an unknown quota are both eligible', () => {
                        const positive = fixtureKit();
                        admitCandidate(positive, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        assert.equal(positive.route({ at: FIXTURE_NOW_MS }).kind, 'selected');
                        const unknown = fixtureKit();
                        admitCandidate(unknown, FIXTURE_ADAPTER_ALPHA, unknownObservationAt(FIXTURE_NOW_MS));
                        assert.equal(unknown.route({ at: FIXTURE_NOW_MS }).kind, 'selected');
                });

                test("a stale 'cooldown' health label with NO active interval does not gate (the landed math is the authority)", () => {
                        const kit = fixtureKit();
                        const staleLabel: AdapterObservation = {
                                ...healthyObservationAt(FIXTURE_NOW_MS),
                                health: 'cooldown',
                                cooldown: {
                                        state: 'active',
                                        reason: 'manual-hold',
                                        sinceEpochMs: FIXTURE_NOW_MS - 2 * FIXTURE_COOLDOWN_HALF_MS,
                                        untilEpochMs: FIXTURE_NOW_MS - FIXTURE_COOLDOWN_HALF_MS,
                                },
                        };
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, staleLabel);
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.equal(decision.disclosure.capacityState, 'cooldown');
                });

                test('zero eligible candidates: RoutingExhausted carries the FULL honest ledger', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, cooldownObservationAt(FIXTURE_NOW_MS, 'provider-error'));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, exhaustedQuotaObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, cooldownObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.route({ at: FIXTURE_NOW_MS });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.atEpochMs, FIXTURE_NOW_MS);
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-cooldown',
                                        reason: 'provider-error',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-quota',
                                        reason: 'quota-exhausted',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_GAMMA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-cooldown',
                                        reason: 'rate-limited',
                                },
                        ]);
                });

                test('an empty routing set: RoutingExhausted with an honest empty ledger (never a silent empty)', () => {
                        const kit = fixtureKit();
                        const outcome = kit.route({ at: FIXTURE_NOW_MS });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.deepEqual(outcome.attemptLedger, []);
                });

                test('route throws TypeError on a malformed probe instant', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        assert.throws(() => kit.route({ at: NaN } as any), TypeError);
                        assert.throws(() => kit.route({ at: Infinity } as any), TypeError);
                        assert.throws(() => kit.route(undefined as any), TypeError);
                });

                test('deterministic selection double-run equality: two kits, byte-identical decisions', () => {
                        const kitA = fixtureKit();
                        const kitB = fixtureKit();
                        for (const kit of [kitA, kitB]) {
                                admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                                admitCandidate(kit, FIXTURE_ADAPTER_BETA, cooldownObservationAt(FIXTURE_NOW_MS));
                        }
                        const bytesA = serializeRoutingDecision(selectedDecision(kitA, FIXTURE_NOW_MS));
                        const bytesB = serializeRoutingDecision(selectedDecision(kitB, FIXTURE_NOW_MS));
                        assert.equal(bytesA, bytesB);
                });

                test('route is pure: the same kit at the same instant decides byte-identically twice', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const first = kit.route({ at: FIXTURE_NOW_MS });
                        const second = kit.route({ at: FIXTURE_NOW_MS });
                        assert.deepEqual(first, second);
                });
        });

        suite('the optional sidecar law (a sidecar is never a required input)', () => {
                test('a kit with NO sidecar routes on the reports alone', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.disclosure.health, 'healthy');
                        assert.equal(decision.disclosure.quotaRemaining, 42);
                });

                test('a sidecar SERVING the provider overrides the effective state (the fold drives the gates)', () => {
                        const kit = fixtureKitWithSidecar(fixtureSidecar());
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.route({ at: FIXTURE_NOW_MS });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-cooldown',
                                        reason: 'rate-limited',
                                },
                        ]);
                });

                test('a sidecar carrying the provider with NO state: the router sees the landed unknownSnapshot', () => {
                        const kit = fixtureKitWithSidecar(fixtureSidecar());
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_GAMMA);
                        assert.equal(decision.disclosure.health, 'unknown');
                        assert.equal(decision.disclosure.capacityState, 'unknown');
                        assert.equal(decision.disclosure.quotaRemaining, 'unknown');
                });

                test('a sidecar NOT serving the provider leaves the report driving', () => {
                        const sidecar = fixtureSidecar();
                        const kit = fixtureKitWithSidecar(sidecar);
                        admitCandidate(kit, FIXTURE_ADAPTER_DELTA, healthyObservationAt(FIXTURE_NOW_MS));
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.adapterId, FIXTURE_ADAPTER_DELTA);
                        assert.equal(decision.disclosure.health, 'healthy');
                        assert.equal(decision.disclosure.quotaRemaining, 42);
                });

                test('a malformed sidecar-attached state fails the route closed (the landed fold law propagates)', () => {
                        const sidecar = fixtureSidecar();
                        sidecar.attachFixtureState(
                                FIXTURE_SIDECAR_NO_STATE_ID,
                                (atEpochMs: number) =>
                                        ({ ...unknownSnapshot(FIXTURE_PROVIDER_GAMMA, atEpochMs), health: 'not-a-state' }) as any,
                        );
                        const kit = fixtureKitWithSidecar(sidecar);
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        assert.throws(() => kit.route({ at: FIXTURE_NOW_MS }), TypeError);
                });
        });

        suite('unknownCandidate (the honest no-observation fold)', () => {
                test('an unknown adapter id returns undefined', () => {
                        const kit = fixtureKit();
                        assert.equal(kit.unknownCandidate('fixture.adapter.missing'), undefined);
                        assert.equal(kit.unknownCandidate(''), undefined);
                });

                test('the built candidate satisfies the contract guard and the landed report guard', () => {
                        const kit = fixtureKit();
                        const candidate = kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA);
                        assert.ok(candidate);
                        assert.equal(isRoutingCandidate(candidate), true);
                        assert.equal(isAdapterHealthReport(candidate.report), true);
                        assert.equal(candidate.adapterId, FIXTURE_ADAPTER_ALPHA);
                });

                test("the report's snapshot deep-equals the landed unknownSnapshot (the no-fabrication shape)", () => {
                        const kit = fixtureKit();
                        const candidate = kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA);
                        assert.ok(candidate);
                        assert.deepEqual(candidate.report.snapshot, unknownSnapshot(FIXTURE_PROVIDER_ALPHA, FIXTURE_NOW_MS));
                });

                test("the report's provenance is unverified, unsubstituted, provider-naming, scope-labeled", () => {
                        const kit = fixtureKit();
                        const candidate = kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA);
                        assert.ok(candidate);
                        const provenance = candidate.report.provenance;
                        assert.equal(provenance.modelVerification, 'unverified');
                        assert.equal(provenance.substitution, 'none');
                        assert.equal(provenance.requestedProviderId, FIXTURE_PROVIDER_ALPHA);
                        assert.equal(provenance.actualProviderId, FIXTURE_PROVIDER_ALPHA);
                        assert.equal(provenance.requestedModelId, ROUTING_PROBE_SCOPE);
                        assert.equal(provenance.actualModelId, ROUTING_PROBE_SCOPE);
                        assert.equal(provenance.recordedAtEpochMs, FIXTURE_NOW_MS);
                });

                test('the candidate admits through addCandidate and routes with honest-unknown disclosure', () => {
                        const kit = fixtureKit();
                        const candidate = kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA);
                        assert.ok(candidate);
                        assert.equal(kit.addCandidate(candidate).admitted, true);
                        const decision = selectedDecision(kit, FIXTURE_NOW_MS);
                        assert.equal(decision.disclosure.capacityState, 'unknown');
                });

                test('the one-way promotion is DELEGATED to the landed markReportVerified (never a router-side mutator)', () => {
                        const kit = fixtureKit();
                        const candidate = kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA);
                        assert.ok(candidate);
                        const promoted = markReportVerified(candidate.report);
                        assert.equal(promoted.provenance.modelVerification, 'verified');
                        assert.equal(promoted.snapshot.verification, 'verified');
                        assert.deepEqual(
                                { ...promoted, provenance: promoted.provenance, snapshot: promoted.snapshot },
                                promoted,
                        );
                        // the delegation pinned literally: the landed markProvenanceVerified IS the promotion
                        assert.deepEqual(
                                markReportVerified(candidate.report).provenance,
                                markProvenanceVerified(candidate.report.provenance),
                        );
                        // the kit never self-promotes: its own folds stay unverified
                        assert.equal(kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA)?.report.provenance.modelVerification, 'unverified');
                });

                test('the injected clock drives the fold: a sequenced clock advances the observation time', () => {
                        const clock = sequencedClock(FIXTURE_NOW_MS, 1_000);
                        const kit = createRoutingKit({
                                now: clock.now,
                                adapters: fixtureAdapterRecord(),
                                catalog: fixtureCatalogRecord(),
                        });
                        assert.equal(kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA)?.report.observedAtEpochMs, FIXTURE_NOW_MS + 1_000);
                        assert.equal(kit.unknownCandidate(FIXTURE_ADAPTER_ALPHA)?.report.observedAtEpochMs, FIXTURE_NOW_MS + 2_000);
                });
        });

        suite('runWithFailover (the bounded retry/failover engine)', () => {
                test("'invalid-attempt-thunk' fires for a missing or non-function thunk", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const policy = { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] };
                        for (const bad of [undefined, 42, 'fixture.thunk']) {
                                const outcome = kit.runWithFailover({ attempt: bad as any, policy, at: FIXTURE_NOW_MS });
                                assert.equal(outcome.kind, 'rejected');
                                if (outcome.kind !== 'rejected') {
                                        throw new Error('unreachable');
                                }
                                assert.equal(outcome.reason, 'invalid-attempt-thunk');
                        }
                });

                test("'invalid-max-attempts' fires for a non-integer or sub-one bound", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const attempt = (): AttemptOutcome => 'succeeded';
                        for (const maxAttempts of [0, -1, 2.5, NaN]) {
                                const outcome = kit.runWithFailover({
                                        attempt,
                                        policy: { maxAttempts, backoffScheduleMs: [] },
                                        at: FIXTURE_NOW_MS,
                                });
                                assert.equal(outcome.kind, 'rejected');
                                if (outcome.kind !== 'rejected') {
                                        throw new Error('unreachable');
                                }
                                assert.equal(outcome.reason, 'invalid-max-attempts');
                        }
                        const missing = kit.runWithFailover({
                                attempt,
                                policy: undefined as any,
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(missing.kind, 'rejected');
                        assert.equal((missing as { reason: string }).reason, 'invalid-max-attempts');
                });

                test("'invalid-backoff-schedule' fires for a wrong-length, negative or non-finite schedule", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const attempt = (): AttemptOutcome => 'succeeded';
                        for (const backoffScheduleMs of [[], [1, 2], [-1], [NaN]]) {
                                const outcome = kit.runWithFailover({
                                        attempt,
                                        policy: { maxAttempts: 2, backoffScheduleMs },
                                        at: FIXTURE_NOW_MS,
                                });
                                assert.equal(outcome.kind, 'rejected');
                                if (outcome.kind !== 'rejected') {
                                        throw new Error('unreachable');
                                }
                                assert.equal(outcome.reason, 'invalid-backoff-schedule');
                        }
                });

                test("'invalid-at' fires for a non-finite run-start instant", () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.runWithFailover({
                                attempt: (): AttemptOutcome => 'succeeded',
                                policy: { maxAttempts: 1, backoffScheduleMs: [] },
                                at: NaN,
                        });
                        assert.equal(outcome.kind, 'rejected');
                        if (outcome.kind !== 'rejected') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.reason, 'invalid-at');
                });

                test('first-attempt success: the first eligible candidate in ascending order, full ledger, attemptCount 1', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const thunk = countingThunk([]);
                        const outcome = kit.runWithFailover({
                                attempt: thunk.attempt,
                                policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'succeeded');
                        if (outcome.kind !== 'succeeded') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.adapterId, FIXTURE_ADAPTER_ALPHA);
                        assert.equal(outcome.atEpochMs, FIXTURE_NOW_MS);
                        assert.equal(outcome.attemptCount, 1);
                        assert.equal(thunk.calls(), 1);
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'eligible',
                                        reason: 'none',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'eligible',
                                        reason: 'none',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'attempted-succeeded',
                                        reason: 'none',
                                },
                        ]);
                });

                test('failover across candidates: alpha fails its budget, beta succeeds', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.runWithFailover({
                                attempt: countingThunk([FIXTURE_ADAPTER_ALPHA]).attempt,
                                policy: { maxAttempts: 1, backoffScheduleMs: [] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'succeeded');
                        if (outcome.kind !== 'succeeded') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.adapterId, FIXTURE_ADAPTER_BETA);
                        assert.equal(outcome.attemptCount, 2);
                        assert.deepEqual(outcome.attemptLedger, [
                                eligibleLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                eligibleLine(FIXTURE_ADAPTER_BETA, FIXTURE_NOW_MS),
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'attempted-failed',
                                        reason: 'attempt-failed',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'attempted-succeeded',
                                        reason: 'none',
                                },
                        ]);
                });

                test('the retry arithmetic: fail-then-succeed with an injected backoff schedule', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        let calls = 0;
                        const outcome = kit.runWithFailover({
                                attempt: (): AttemptOutcome => {
                                        calls += 1;
                                        return calls === 1 ? 'failed' : 'succeeded';
                                },
                                policy: { maxAttempts: 3, backoffScheduleMs: [10_000, 20_000] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'succeeded');
                        if (outcome.kind !== 'succeeded') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.attemptCount, 2);
                        assert.deepEqual(outcome.attemptLedger, [
                                eligibleLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'attempted-failed',
                                        reason: 'attempt-failed',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS + 10_000,
                                        outcome: 'attempted-succeeded',
                                        reason: 'none',
                                },
                        ]);
                });

                test('per-candidate budgets with immediate failover: the exhausted ledger pins every instant', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.runWithFailover({
                                attempt: countingThunk([FIXTURE_ADAPTER_ALPHA, FIXTURE_ADAPTER_BETA]).attempt,
                                policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.atEpochMs, FIXTURE_NOW_MS);
                        assert.deepEqual(outcome.attemptLedger, [
                                eligibleLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                eligibleLine(FIXTURE_ADAPTER_BETA, FIXTURE_NOW_MS),
                                attemptedFailedLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                attemptedFailedLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS + FIXTURE_BACKOFF_MS),
                                attemptedFailedLine(FIXTURE_ADAPTER_BETA, FIXTURE_NOW_MS + FIXTURE_BACKOFF_MS),
                                attemptedFailedLine(FIXTURE_ADAPTER_BETA, FIXTURE_NOW_MS + 2 * FIXTURE_BACKOFF_MS),
                        ]);
                });

                test('zero eligible at start: exhausted with the skip ledger, the thunk NEVER called', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, cooldownObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, exhaustedQuotaObservationAt(FIXTURE_NOW_MS));
                        const thunk = countingThunk([]);
                        const outcome = kit.runWithFailover({
                                attempt: thunk.attempt,
                                policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'exhausted');
                        if (outcome.kind !== 'exhausted') {
                                throw new Error('unreachable');
                        }
                        assert.equal(thunk.calls(), 0);
                        assert.deepEqual(outcome.attemptLedger, [
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-cooldown',
                                        reason: 'rate-limited',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: FIXTURE_NOW_MS,
                                        outcome: 'skipped-quota',
                                        reason: 'quota-exhausted',
                                },
                        ]);
                });

                test('the cooldown re-gate on a retry: the retry instant inside the cooldown ends the budget honestly', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, futureCooldownObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        const outcome = kit.runWithFailover({
                                attempt: countingThunk([FIXTURE_ADAPTER_ALPHA]).attempt,
                                policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] },
                                at: FIXTURE_NOW_MS,
                        });
                        assert.equal(outcome.kind, 'succeeded');
                        if (outcome.kind !== 'succeeded') {
                                throw new Error('unreachable');
                        }
                        assert.equal(outcome.adapterId, FIXTURE_ADAPTER_BETA);
                        const retryAt = FIXTURE_NOW_MS + FIXTURE_BACKOFF_MS;
                        assert.deepEqual(outcome.attemptLedger, [
                                eligibleLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                eligibleLine(FIXTURE_ADAPTER_BETA, FIXTURE_NOW_MS),
                                attemptedFailedLine(FIXTURE_ADAPTER_ALPHA, FIXTURE_NOW_MS),
                                {
                                        adapterId: FIXTURE_ADAPTER_ALPHA,
                                        atEpochMs: retryAt,
                                        outcome: 'skipped-cooldown',
                                        reason: 'rate-limited',
                                },
                                {
                                        adapterId: FIXTURE_ADAPTER_BETA,
                                        atEpochMs: retryAt,
                                        outcome: 'attempted-succeeded',
                                        reason: 'none',
                                },
                        ]);
                });

                test('determinism: two kits with the same inputs and policy produce deep-equal outcomes', () => {
                        const kitA = fixtureKit();
                        const kitB = fixtureKit();
                        for (const kit of [kitA, kitB]) {
                                admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                                admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                        }
                        const input: RunWithFailoverInput = {
                                attempt: countingThunk([FIXTURE_ADAPTER_ALPHA, FIXTURE_ADAPTER_BETA]).attempt,
                                policy: { maxAttempts: 2, backoffScheduleMs: [FIXTURE_BACKOFF_MS] },
                                at: FIXTURE_NOW_MS,
                        };
                        assert.deepEqual(kitA.runWithFailover(input), kitA.runWithFailover(input));
                        assert.deepEqual(kitA.runWithFailover(input), kitB.runWithFailover(input));
                });
        });

        suite('reportSnapshot (the kit state fold)', () => {
                test('rows for every admitted candidate, sorted, riding the reports verbatim', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.equal(fold.contractVersion, ROUTING_KIT_VERSION);
                        assert.equal(fold.routingSetId, FIXTURE_ADAPTER_SET_ID);
                        assert.equal(fold.foldedAtEpochMs, FIXTURE_NOW_MS);
                        assert.deepEqual(
                                fold.rows.map((row) => row.adapterId),
                                [FIXTURE_ADAPTER_ALPHA, FIXTURE_ADAPTER_GAMMA],
                        );
                        assert.equal(fold.rows[0].observedViaSidecar, false);
                        assert.deepEqual(
                                fold.rows[0].snapshot,
                                fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS)).snapshot,
                        );
                });

                test('the honest-unknown rows for all-unknown reports (the no-fabrication fold)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, unknownObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.deepEqual(fold.rows[0].snapshot, unknownSnapshot(FIXTURE_PROVIDER_ALPHA, FIXTURE_NOW_MS));
                });

                test('with a sidecar: the served rows carry the sidecar fold, the unserved rows the report', () => {
                        const kit = fixtureKitWithSidecar(fixtureSidecar());
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.equal(fold.rows[0].observedViaSidecar, true);
                        const sidecarFold: ProviderCapacitySnapshot = {
                                ...unknownSnapshot(FIXTURE_PROVIDER_ALPHA, FIXTURE_NOW_MS),
                                health: 'healthy',
                                quota: {
                                        state: 'known',
                                        remaining: 42,
                                        limit: 100,
                                        window: {
                                                kind: 'rolling',
                                                windowStartEpochMs: FIXTURE_NOW_MS - 600_000,
                                                windowLengthMs: 1_200_000,
                                        },
                                },
                                resetSchedule: {
                                        kind: 'interval-aligned',
                                        anchorEpochMs: 0,
                                        intervalMs: 3_600_000,
                                },
                        };
                        assert.deepEqual(fold.rows[0].snapshot, sidecarFold);
                });

                test('the no-state sidecar row IS the landed unknownSnapshot (the honest default, still sidecar-supplied)', () => {
                        const kit = fixtureKitWithSidecar(fixtureSidecar());
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.equal(fold.rows[0].observedViaSidecar, true);
                        assert.deepEqual(fold.rows[0].snapshot, unknownSnapshot(FIXTURE_PROVIDER_GAMMA, FIXTURE_NOW_MS));
                });

                test('an empty kit folds honest-empty rows', () => {
                        const kit = fixtureKit();
                        assert.deepEqual(kit.reportSnapshot().rows, []);
                });

                test('a malformed sidecar state fails the fold closed (the landed report-fold law family propagates)', () => {
                        const sidecar = fixtureSidecar();
                        sidecar.attachFixtureState(
                                FIXTURE_SIDECAR_NO_STATE_ID,
                                (atEpochMs: number) =>
                                        ({ ...unknownSnapshot(FIXTURE_PROVIDER_GAMMA, atEpochMs), health: 'not-a-state' }) as any,
                        );
                        const kit = fixtureKitWithSidecar(sidecar);
                        admitCandidate(kit, FIXTURE_ADAPTER_GAMMA, healthyObservationAt(FIXTURE_NOW_MS));
                        assert.throws(() => kit.reportSnapshot(), TypeError);
                });

                test('the injected clock drives the fold: a sequenced clock advances foldedAtEpochMs', () => {
                        const clock = sequencedClock(FIXTURE_NOW_MS, 1_000);
                        const kit = createRoutingKit({
                                now: clock.now,
                                adapters: fixtureAdapterRecord(),
                                catalog: fixtureCatalogRecord(),
                        });
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        assert.equal(kit.reportSnapshot().foldedAtEpochMs, FIXTURE_NOW_MS + 1_000);
                        assert.equal(kit.reportSnapshot().foldedAtEpochMs, FIXTURE_NOW_MS + 2_000);
                });
        });

        suite('serializeRoutingRecord (canonical bytes)', () => {
                test('double-run byte-equal', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.equal(serializeRoutingRecord(fold), serializeRoutingRecord(fold));
                });

                test('two kits on the same fixed clock with the same candidates serialize byte-equal', () => {
                        const kitA = fixtureKit();
                        const kitB = fixtureKit();
                        for (const kit of [kitA, kitB]) {
                                admitCandidate(kit, FIXTURE_ADAPTER_BETA, healthyObservationAt(FIXTURE_NOW_MS));
                                admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, cooldownObservationAt(FIXTURE_NOW_MS));
                        }
                        assert.equal(serializeRoutingRecord(kitA.reportSnapshot()), serializeRoutingRecord(kitB.reportSnapshot()));
                });

                test('key-insertion-order independence: scrambled input keys, same bytes', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        const scrambledRow = {
                                observedViaSidecar: fold.rows[0].observedViaSidecar,
                                snapshot: {
                                        observedAtEpochMs: fold.rows[0].snapshot.observedAtEpochMs,
                                        resetSchedule: { ...fold.rows[0].snapshot.resetSchedule },
                                        cooldown: { ...fold.rows[0].snapshot.cooldown },
                                        quota: { ...fold.rows[0].snapshot.quota },
                                        health: fold.rows[0].snapshot.health,
                                        verification: fold.rows[0].snapshot.verification,
                                        providerId: fold.rows[0].snapshot.providerId,
                                        contractVersion: fold.rows[0].snapshot.contractVersion,
                                },
                                adapterId: fold.rows[0].adapterId,
                        };
                        const scrambled = {
                                rows: [scrambledRow],
                                foldedAtEpochMs: fold.foldedAtEpochMs,
                                routingSetId: fold.routingSetId,
                                contractVersion: fold.contractVersion,
                        };
                        assert.equal(serializeRoutingRecord(scrambled), serializeRoutingRecord(fold));
                });

                test('the bytes pin the fixed key orders and carry the version stamp', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const bytes = serializeRoutingRecord(kit.reportSnapshot());
                        const parsed = JSON.parse(bytes) as Record<string, unknown>;
                        assert.deepEqual(Object.keys(parsed), [
                                'contractVersion',
                                'routingSetId',
                                'foldedAtEpochMs',
                                'rows',
                        ]);
                        const rows = parsed.rows as Record<string, unknown>[];
                        assert.deepEqual(Object.keys(rows[0]), ['adapterId', 'snapshot', 'observedViaSidecar']);
                        assert.equal(bytes.includes(`"contractVersion":"${ROUTING_KIT_VERSION}"`), true);
                });

                test('refuses a malformed fold fail-closed (no dishonest kit state gets canonical bytes)', () => {
                        assert.throws(() => serializeRoutingRecord(undefined), TypeError);
                        assert.throws(() => serializeRoutingRecord({ rows: 'fixture.rows' }), TypeError);
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.throws(() => serializeRoutingRecord({ ...fold, contractVersion: '0.9.9' }), TypeError);
                        assert.throws(() => serializeRoutingRecord({ ...fold, foldedAtEpochMs: NaN }), TypeError);
                });
        });

        suite('count/list (the lookups)', () => {
                test('count starts at zero, grows on admits, and list stays sorted with verbatim reports', () => {
                        const kit = fixtureKit();
                        assert.equal(kit.count(), 0);
                        const alphaReport = fixtureReportFor(FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const betaReport = fixtureReportFor(FIXTURE_ADAPTER_BETA, cooldownObservationAt(FIXTURE_NOW_MS));
                        kit.addCandidate({ adapterId: FIXTURE_ADAPTER_BETA, report: betaReport });
                        kit.addCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: alphaReport });
                        assert.equal(kit.count(), 2);
                        assert.deepEqual(kit.list(), [
                                { adapterId: FIXTURE_ADAPTER_ALPHA, report: alphaReport },
                                { adapterId: FIXTURE_ADAPTER_BETA, report: betaReport },
                        ]);
                });
        });

        suite('version stamping across both module copies (COMMAND_FACADE)', () => {
                test('the contract copy, the kit literal copy and the kit re-export are 1.0.0 and equal', () => {
                        assert.equal(CONTRACT_INFERENCE_ROUTING_VERSION, '1.0.0');
                        assert.equal(ROUTING_KIT_VERSION, '1.0.0');
                        assert.equal(KIT_REEXPORT_INFERENCE_ROUTING_VERSION, '1.0.0');
                        assert.equal(CONTRACT_INFERENCE_ROUTING_VERSION, ROUTING_KIT_VERSION);
                        assert.equal(KIT_REEXPORT_INFERENCE_ROUTING_VERSION, CONTRACT_INFERENCE_ROUTING_VERSION);
                });

                test('every decision satisfies the CONTRACT guard (the drift fails closed inside the kit)', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        admitCandidate(kit, FIXTURE_ADAPTER_BETA, unknownObservationAt(FIXTURE_NOW_MS));
                        for (const at of [FIXTURE_NOW_MS, FIXTURE_NOW_MS + 1, FIXTURE_NOW_MS - 1]) {
                                const outcome = kit.route({ at });
                                if (outcome.kind === 'selected') {
                                        assert.equal(isRoutingDecision(outcome.decision), true);
                                }
                        }
                        assert.equal(isRoutingDecision(selectedDecision(kit, FIXTURE_NOW_MS)), true);
                });

                test('the kit fold carries the kit stamp, equal to the contract stamp', () => {
                        const kit = fixtureKit();
                        admitCandidate(kit, FIXTURE_ADAPTER_ALPHA, healthyObservationAt(FIXTURE_NOW_MS));
                        const fold = kit.reportSnapshot();
                        assert.equal(fold.contractVersion, ROUTING_KIT_VERSION);
                        assert.equal(fold.contractVersion, CONTRACT_INFERENCE_ROUTING_VERSION);
                });
        });

        suite('the determinism ban (in-suite source grep)', () => {
                test('every Date.now / Math.random / process.env hit in routingKit.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/routingKit.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });

                test('every Date.now / Math.random / process.env hit in routingContract.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/routingContract.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });
        });
});
