/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-005 routing contract test suite (mocha tdd style, matching
 * build/flauz/inference/sidecar/test/common/sidecarContract.test.ts).
 *
 * Fixture policy: every adapter id, provider entry id, model id,
 * credential handle and probe value below is SYNTHETIC (prefixed
 * 'fixture.') and is NOT an authority value. Closed-vocabulary
 * members (the health states, the cooldown reasons, the selection
 * rule, the version stamps) are the contract's own values under
 * test. Runtime-boundary probes are injected as JSON-parsed values,
 * the shape foreign input arrives in at a real boundary. All
 * timestamps are injected plain-number epoch milliseconds; the
 * suites never read a clock.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        ATTEMPT_OUTCOME_KINDS,
        FAILOVER_REJECTION_REASONS,
        INFERENCE_ROUTING_VERSION,
        ROUTING_ATTEMPT_OUTCOMES,
        ROUTING_ATTEMPT_REASONS,
        ROUTING_REJECTION_REASONS,
        ROUTING_SELECTION_RULES,
        isRoutingCandidate,
        isRoutingDecision,
        serializeRoutingDecision,
} from '../../common/routingContract.js';
import {
        COOLDOWN_REASONS,
        INFERENCE_SEMANTICS_CONTRACTS_VERSION,
        projectCapacityDisclosure,
        serializeCapacityDisclosure,
} from '../../../semantics/common/capacityDisclosure.js';
import type { ProviderCapacityDisclosure } from '../../../semantics/common/capacityDisclosure.js';
import {
        INFERENCE_ADAPTER_VERSION,
        reportAdapterSnapshot,
} from '../../../adapters/common/providerAdapter.js';
import type {
        AdapterObservation,
        ProviderAdapterDescriptor,
        ProviderAdapterHealthReport,
} from '../../../adapters/common/providerAdapter.js';

const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ENTRY_ALPHA = 'fixture.entry.alpha';
const FIXTURE_MODEL_ALPHA = 'fixture.model.alpha';
const FIXTURE_DISPLAY_NAME = 'Fixture Adapter Alpha';
const FIXTURE_CREDENTIAL_HANDLE = 'fixture.credential.handle.alpha';
const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_START_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_LENGTH_MS = 60_000;

function fixtureDescriptor(): ProviderAdapterDescriptor {
        return {
                adapterId: FIXTURE_ADAPTER_ALPHA,
                displayName: FIXTURE_DISPLAY_NAME,
                providerEntryId: FIXTURE_ENTRY_ALPHA,
                transportKind: 'http-generic-json',
                capacityProvenance: 'user-owned-endpoint',
                credentialHandle: FIXTURE_CREDENTIAL_HANDLE,
                contractVersion: INFERENCE_ADAPTER_VERSION,
        };
}

function fixtureObservation(): AdapterObservation {
        return {
                observedAtEpochMs: FIXTURE_NOW_MS,
                health: 'healthy',
                quota: {
                        state: 'known',
                        remaining: 42,
                        limit: 60,
                        window: {
                                kind: 'fixed',
                                windowStartEpochMs: FIXTURE_WINDOW_START_MS,
                                windowLengthMs: FIXTURE_WINDOW_LENGTH_MS,
                        },
                },
                cooldown: { state: 'none' },
                reset: {
                        kind: 'interval-aligned',
                        anchorEpochMs: FIXTURE_WINDOW_START_MS,
                        intervalMs: FIXTURE_WINDOW_LENGTH_MS,
                },
        };
}

function fixtureReport(): ProviderAdapterHealthReport {
        return reportAdapterSnapshot(fixtureDescriptor(), fixtureObservation(), {
                requestedProviderId: FIXTURE_ENTRY_ALPHA,
                requestedModelId: FIXTURE_MODEL_ALPHA,
                actualProviderId: FIXTURE_ENTRY_ALPHA,
                actualModelId: FIXTURE_MODEL_ALPHA,
                recordedAtEpochMs: FIXTURE_NOW_MS,
        });
}

function fixtureDisclosure(atEpochMs: number = FIXTURE_NOW_MS): ProviderCapacityDisclosure {
        const report = fixtureReport();
        const projected = projectCapacityDisclosure(report.snapshot, report.provenance, atEpochMs);
        if (!projected.disclosed) {
                throw new Error(`fixture disclosure rejected: ${projected.reason}: ${projected.detail}`);
        }
        return projected.disclosure;
}

function fixtureDecision(): Record<string, unknown> {
        return {
                contractVersion: INFERENCE_ROUTING_VERSION,
                adapterId: FIXTURE_ADAPTER_ALPHA,
                selectionRule: 'stable-adapter-id-order',
                disclosure: fixtureDisclosure(),
                decidedAtEpochMs: FIXTURE_NOW_MS,
        };
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

suite('INF-005 routing contract', () => {

        suite('version stamping (the single declaration)', () => {
                test('INFERENCE_ROUTING_VERSION is 1.0.0', () => {
                        assert.equal(INFERENCE_ROUTING_VERSION, '1.0.0');
                });

                test('the routing stamp and the landed sub-record stamps are distinct roles', () => {
                        const decision = fixtureDecision();
                        assert.equal(decision.contractVersion, INFERENCE_ROUTING_VERSION);
                        const disclosure = decision.disclosure as ProviderCapacityDisclosure;
                        assert.equal(disclosure.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
                        assert.equal(
                                disclosure.provenance.contractVersion,
                                INFERENCE_SEMANTICS_CONTRACTS_VERSION,
                        );
                });
        });

        suite('ROUTING_REJECTION_REASONS (the frozen list)', () => {
                test('the exact frozen contents and order', () => {
                        assert.deepEqual(ROUTING_REJECTION_REASONS, [
                                'not-an-object',
                                'adapter-id-empty',
                                'adapter-report-malformed',
                                'routing-unknown-adapter',
                                'adapter-report-misattributed',
                                'routing-candidate-duplicate',
                        ]);
                });

                test('the list is unique (no reason can fire twice)', () => {
                        assert.equal(new Set(ROUTING_REJECTION_REASONS).size, ROUTING_REJECTION_REASONS.length);
                });

                test('the three routing-law reasons are members', () => {
                        const reasons = ROUTING_REJECTION_REASONS as readonly string[];
                        assert.equal(reasons.includes('routing-candidate-duplicate'), true);
                        assert.equal(reasons.includes('adapter-report-malformed'), true);
                        assert.equal(reasons.includes('routing-unknown-adapter'), true);
                });
        });

        suite('the derived frozen vocabularies', () => {
                test('ROUTING_ATTEMPT_OUTCOMES: exact contents, order, uniqueness', () => {
                        assert.deepEqual(ROUTING_ATTEMPT_OUTCOMES, [
                                'eligible',
                                'selected',
                                'skipped-cooldown',
                                'skipped-quota',
                                'attempted-succeeded',
                                'attempted-failed',
                        ]);
                        assert.equal(new Set(ROUTING_ATTEMPT_OUTCOMES).size, ROUTING_ATTEMPT_OUTCOMES.length);
                });

                test('ROUTING_ATTEMPT_REASONS: the landed cooldown reasons verbatim plus the two documented additions', () => {
                        assert.deepEqual(ROUTING_ATTEMPT_REASONS, ['none', ...COOLDOWN_REASONS, 'attempt-failed']);
                        assert.equal(new Set(ROUTING_ATTEMPT_REASONS).size, ROUTING_ATTEMPT_REASONS.length);
                });

                test('ROUTING_SELECTION_RULES: the closed one-member set', () => {
                        assert.deepEqual(ROUTING_SELECTION_RULES, ['stable-adapter-id-order']);
                });

                test('ATTEMPT_OUTCOME_KINDS: the thunk verdict vocabulary', () => {
                        assert.deepEqual(ATTEMPT_OUTCOME_KINDS, ['succeeded', 'failed']);
                });

                test('FAILOVER_REJECTION_REASONS: exact contents, order, uniqueness', () => {
                        assert.deepEqual(FAILOVER_REJECTION_REASONS, [
                                'invalid-attempt-thunk',
                                'invalid-max-attempts',
                                'invalid-backoff-schedule',
                                'invalid-at',
                        ]);
                        assert.equal(
                                new Set(FAILOVER_REJECTION_REASONS).size,
                                FAILOVER_REJECTION_REASONS.length,
                        );
                });
        });

        suite('isRoutingCandidate (both directions)', () => {
                test('admits a well-formed candidate whose report came through the landed fold', () => {
                        const candidate = { adapterId: FIXTURE_ADAPTER_ALPHA, report: fixtureReport() };
                        assert.equal(isRoutingCandidate(candidate), true);
                        assert.equal(isRoutingCandidate(foreign(JSON.stringify(candidate))), true);
                });

                test('rejects non-objects', () => {
                        for (const bad of [undefined, null, 'fixture.candidate', 42, true]) {
                                assert.equal(isRoutingCandidate(bad), false);
                        }
                });

                test('rejects an empty or missing adapterId', () => {
                        assert.equal(isRoutingCandidate({ report: fixtureReport() }), false);
                        assert.equal(isRoutingCandidate({ adapterId: '', report: fixtureReport() }), false);
                        assert.equal(isRoutingCandidate({ adapterId: 42, report: fixtureReport() }), false);
                });

                test('rejects a missing or malformed report', () => {
                        assert.equal(isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA }), false);
                        assert.equal(
                                isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: 'fixture.report' }),
                                false,
                        );
                        const bogusVersion = { ...fixtureReport(), contractVersion: '0.9.9' };
                        assert.equal(
                                isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: bogusVersion }),
                                false,
                        );
                });

                test('rejects a report whose own observation times disagree (one observation, one time)', () => {
                        const report = fixtureReport();
                        const disagreeing = {
                                ...report,
                                observedAtEpochMs: report.observedAtEpochMs + 1,
                        };
                        assert.equal(
                                isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: disagreeing }),
                                false,
                        );
                });

                test('rejects a report naming another adapter (misattributed candidate)', () => {
                        const report = fixtureReport();
                        const misattributed = { ...report, adapterId: 'fixture.adapter.other' };
                        assert.equal(
                                isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report: misattributed }),
                                false,
                        );
                });

                test('admits the honest all-unknown report (the no-fabrication shape)', () => {
                        const report = reportAdapterSnapshot(
                                fixtureDescriptor(),
                                {
                                        observedAtEpochMs: FIXTURE_NOW_MS,
                                        health: 'unknown',
                                        quota: { state: 'unknown' },
                                        cooldown: { state: 'none' },
                                        reset: { kind: 'unknown' },
                                },
                                {
                                        requestedProviderId: FIXTURE_ENTRY_ALPHA,
                                        requestedModelId: FIXTURE_MODEL_ALPHA,
                                        actualProviderId: FIXTURE_ENTRY_ALPHA,
                                        actualModelId: FIXTURE_MODEL_ALPHA,
                                        recordedAtEpochMs: FIXTURE_NOW_MS,
                                },
                        );
                        assert.equal(report.snapshot.health, 'unknown');
                        assert.equal(isRoutingCandidate({ adapterId: FIXTURE_ADAPTER_ALPHA, report }), true);
                });

                test('the guard is pure: the candidate is untouched', () => {
                        const candidate = { adapterId: FIXTURE_ADAPTER_ALPHA, report: fixtureReport() };
                        const before = JSON.stringify(candidate);
                        isRoutingCandidate(candidate);
                        isRoutingCandidate({ adapterId: 'fixture.adapter.beta', report: candidate.report });
                        assert.equal(JSON.stringify(candidate), before);
                });
        });

        suite('isRoutingDecision (both directions)', () => {
                test('admits a well-formed decision', () => {
                        assert.equal(isRoutingDecision(fixtureDecision()), true);
                });

                test('rejects non-objects', () => {
                        for (const bad of [undefined, null, 'fixture.decision', 42, true]) {
                                assert.equal(isRoutingDecision(bad), false);
                        }
                });

                test('rejects a version mismatch', () => {
                        const decision = { ...fixtureDecision(), contractVersion: '0.9.9' };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects an empty adapterId', () => {
                        const decision = { ...fixtureDecision(), adapterId: '' };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects a selectionRule outside the closed vocabulary', () => {
                        const decision = { ...fixtureDecision(), selectionRule: 'random-lottery' };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects a malformed disclosure (a bogus health state at the boundary)', () => {
                        const disclosure = fixtureDisclosure();
                        const bogus = foreign(JSON.stringify({ ...disclosure, health: 'not-a-state' }));
                        const decision = { ...fixtureDecision(), disclosure: bogus };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects a disclosure without provenance (missing attribution)', () => {
                        const disclosure = fixtureDisclosure();
                        const stripped = foreign(
                                JSON.stringify({ ...disclosure, provenance: 'fixture.provenance' }),
                        );
                        const decision = { ...fixtureDecision(), disclosure: stripped };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects a non-finite decision time', () => {
                        const decision = { ...fixtureDecision(), decidedAtEpochMs: NaN };
                        assert.equal(isRoutingDecision(decision), false);
                });

                test('rejects a decision time disagreeing with the disclosure generation time (one decision, one time)', () => {
                        const decision = { ...fixtureDecision(), decidedAtEpochMs: FIXTURE_NOW_MS + 1 };
                        assert.equal(isRoutingDecision(decision), false);
                });
        });

        suite('serializeRoutingDecision (canonical bytes)', () => {
                test('double-run byte-equal', () => {
                        const decision = fixtureDecision();
                        assert.equal(serializeRoutingDecision(decision), serializeRoutingDecision(decision));
                });

                test('key-insertion-order independence: scrambled input keys, same bytes', () => {
                        const decision = fixtureDecision();
                        const disclosure = decision.disclosure as ProviderCapacityDisclosure;
                        const scrambledDisclosure = {
                                generatedAtEpochMs: disclosure.generatedAtEpochMs,
                                provenance: { ...disclosure.provenance },
                                resetExpectation: { ...disclosure.resetExpectation },
                                quotaRemaining: disclosure.quotaRemaining,
                                capacityState: disclosure.capacityState,
                                verification: disclosure.verification,
                                health: disclosure.health,
                                providerId: disclosure.providerId,
                                contractVersion: disclosure.contractVersion,
                        };
                        const scrambled = {
                                decidedAtEpochMs: decision.decidedAtEpochMs,
                                disclosure: scrambledDisclosure,
                                selectionRule: decision.selectionRule,
                                adapterId: decision.adapterId,
                                contractVersion: decision.contractVersion,
                        };
                        assert.equal(serializeRoutingDecision(scrambled), serializeRoutingDecision(decision));
                });

                test('the disclosure sub-record is the landed canonical form, byte-for-byte', () => {
                        const decision = fixtureDecision();
                        const bytes = serializeRoutingDecision(decision);
                        const parsed = JSON.parse(bytes) as { disclosure: ProviderCapacityDisclosure };
                        assert.equal(
                                JSON.stringify(parsed.disclosure),
                                serializeCapacityDisclosure(decision.disclosure as ProviderCapacityDisclosure),
                        );
                        assert.deepEqual(parsed.disclosure, decision.disclosure);
                });

                test('the bytes pin the fixed key order', () => {
                        const bytes = serializeRoutingDecision(fixtureDecision());
                        const keys = Object.keys(JSON.parse(bytes) as Record<string, unknown>);
                        assert.deepEqual(keys, [
                                'contractVersion',
                                'adapterId',
                                'selectionRule',
                                'disclosure',
                                'decidedAtEpochMs',
                        ]);
                });

                test('the version stamp rides the bytes', () => {
                        const bytes = serializeRoutingDecision(fixtureDecision());
                        assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_ROUTING_VERSION}"`), true);
                });

                test('the honest-unknown decision serializes canonically (unknown states are first-class bytes)', () => {
                        const report = reportAdapterSnapshot(
                                fixtureDescriptor(),
                                {
                                        observedAtEpochMs: FIXTURE_NOW_MS,
                                        health: 'unknown',
                                        quota: { state: 'unknown' },
                                        cooldown: { state: 'none' },
                                        reset: { kind: 'unknown' },
                                },
                                {
                                        requestedProviderId: FIXTURE_ENTRY_ALPHA,
                                        requestedModelId: FIXTURE_MODEL_ALPHA,
                                        actualProviderId: FIXTURE_ENTRY_ALPHA,
                                        actualModelId: FIXTURE_MODEL_ALPHA,
                                        recordedAtEpochMs: FIXTURE_NOW_MS,
                                },
                        );
                        const projected = projectCapacityDisclosure(
                                report.snapshot,
                                report.provenance,
                                FIXTURE_NOW_MS,
                        );
                        if (!projected.disclosed) {
                                throw new Error(`fixture rejected: ${projected.reason}`);
                        }
                        const decision = {
                                contractVersion: INFERENCE_ROUTING_VERSION,
                                adapterId: FIXTURE_ADAPTER_ALPHA,
                                selectionRule: 'stable-adapter-id-order',
                                disclosure: projected.disclosure,
                                decidedAtEpochMs: FIXTURE_NOW_MS,
                        };
                        const bytes = serializeRoutingDecision(decision);
                        assert.equal(bytes.includes('"capacityState":"unknown"'), true);
                        assert.equal(bytes.includes('"quotaRemaining":"unknown"'), true);
                        assert.equal(serializeRoutingDecision(decision), bytes);
                });

                test('refuses a malformed decision fail-closed (no dishonest decision gets canonical bytes)', () => {
                        assert.throws(() => serializeRoutingDecision(undefined), TypeError);
                        assert.throws(() => serializeRoutingDecision({ adapterId: 'fixture.adapter.alpha' }), TypeError);
                        assert.throws(
                                () => serializeRoutingDecision({ ...fixtureDecision(), selectionRule: 'random-lottery' }),
                                TypeError,
                        );
                });
        });

        suite('the determinism ban (in-suite source grep)', () => {
                test('every Date.now / Math.random / process.env hit in routingContract.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/routingContract.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });

                test('every Date.now / Math.random / process.env hit in routingKit.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/routingKit.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });
        });
});
