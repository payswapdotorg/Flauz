/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-001 capacity disclosure test suite (mocha tdd style, matching
 * build/flauz/capabilities/commands/test/common/mirror.test.ts).
 *
 * Fixture policy: every provider id, model id and probe value below
 * is SYNTHETIC (prefixed 'fixture.' or synthetic epoch constants)
 * and is NOT an authority value - no real provider, model, key or
 * endpoint is named anywhere in this suite.
 */
import { strict as assert } from 'node:assert';
import {
	CAPACITY_DISCLOSURE_REJECTION_REASONS,
	COOLDOWN_REASONS,
	DISCLOSED_CAPACITY_STATES,
	INFERENCE_SEMANTICS_CONTRACTS_VERSION as DISCLOSURE_CONTRACT_VERSION,
	PROVENANCE_REJECTION_REASONS,
	PROVIDER_HEALTH_STATES,
	PROVIDER_METADATA_VERIFICATIONS,
	RESET_SCHEDULE_KINDS,
	SUBSTITUTION_STATES,
	admitProvenance,
	cooldownActive,
	isProviderCapacityDisclosure,
	isProviderCapacitySnapshot,
	markProvenanceVerified,
	nextResetAt,
	projectCapacityDisclosure,
	quotaWindowContains,
	serializeCapacityDisclosure,
	unknownSnapshot,
	unverifiedProvenance,
} from '../../common/capacityDisclosure.js';
import type {
	CapacityDisclosureOutcome,
	CooldownState,
	InferenceProvenance,
	ProviderCapacityDisclosure,
	ProviderCapacitySnapshot,
	ProviderHealthState,
	ProviderMetadataVerification,
	ProvenanceAdmission,
	QuotaState,
	QuotaWindowSpec,
	ResetSchedule,
} from '../../common/capacityDisclosure.js';
import { INFERENCE_SEMANTICS_CONTRACTS_VERSION as PLAN_SEMANTICS_CONTRACT_VERSION } from '../../common/planSemantics.js';

const FIXTURE_PROVIDER_A = 'fixture.provider.alpha';
const FIXTURE_PROVIDER_B = 'fixture.provider.beta';
const FIXTURE_MODEL_A = 'fixture.model.small';
const FIXTURE_MODEL_B = 'fixture.model.large';

const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_START_MS = 1_700_000_000_000;
const FIXTURE_WINDOW_LENGTH_MS = 60_000;

const FIXTURE_WINDOW: QuotaWindowSpec = {
	kind: 'fixed',
	windowStartEpochMs: FIXTURE_WINDOW_START_MS,
	windowLengthMs: FIXTURE_WINDOW_LENGTH_MS,
};

function fixtureProvenance(): InferenceProvenance {
	return unverifiedProvenance({
		requestedProviderId: FIXTURE_PROVIDER_A,
		requestedModelId: FIXTURE_MODEL_A,
		actualProviderId: FIXTURE_PROVIDER_A,
		actualModelId: FIXTURE_MODEL_A,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	});
}

function fixtureHealthySnapshot(): ProviderCapacitySnapshot {
	return {
		contractVersion: DISCLOSURE_CONTRACT_VERSION,
		providerId: FIXTURE_PROVIDER_A,
		verification: 'unverified',
		health: 'healthy',
		quota: {
			state: 'known',
			remaining: 42,
			limit: 60,
			window: FIXTURE_WINDOW,
		},
		cooldown: { state: 'none' },
		resetSchedule: {
			kind: 'interval-aligned',
			anchorEpochMs: FIXTURE_WINDOW_START_MS,
			intervalMs: FIXTURE_WINDOW_LENGTH_MS,
		},
		observedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function snapshotWith(overrides: {
	health?: ProviderHealthState;
	verification?: ProviderMetadataVerification;
	quota?: QuotaState;
	cooldown?: CooldownState;
	resetSchedule?: ResetSchedule;
}): ProviderCapacitySnapshot {
	const base = fixtureHealthySnapshot();
	return {
		contractVersion: base.contractVersion,
		providerId: base.providerId,
		verification: overrides.verification ?? base.verification,
		health: overrides.health ?? base.health,
		quota: overrides.quota ?? base.quota,
		cooldown: overrides.cooldown ?? base.cooldown,
		resetSchedule: overrides.resetSchedule ?? base.resetSchedule,
		observedAtEpochMs: base.observedAtEpochMs,
	};
}

function fixtureProvenanceWith(overrides: Record<string, unknown>): unknown {
	return { ...fixtureProvenance(), ...overrides };
}

function fixtureRejectedProvenance(admission: ProvenanceAdmission): { reason: string; detail: string } {
	assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return { reason: admission.reason, detail: admission.detail };
}

function fixtureRejectedProjection(outcome: CapacityDisclosureOutcome): { reason: string; detail: string } {
	assert.equal(outcome.disclosed, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
	return { reason: outcome.reason, detail: outcome.detail };
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

suite('INF-001 capacity disclosure contracts', () => {

	suite('version and cross-module pins', () => {
		test('the contract-set version is 1.0.0 and both module copies agree (one versioned set)', () => {
			assert.equal(DISCLOSURE_CONTRACT_VERSION, PLAN_SEMANTICS_CONTRACT_VERSION);
			assert.equal(DISCLOSURE_CONTRACT_VERSION, '1.0.0');
		});

		test('rejection vocabularies are closed, non-empty and duplicate-free', () => {
			for (const list of [CAPACITY_DISCLOSURE_REJECTION_REASONS, PROVENANCE_REJECTION_REASONS]) {
				assert.equal(list.length > 0, true);
				assert.equal(new Set(list).size, list.length);
			}
		});
	});

	suite('closed vocabularies', () => {
		test('provider health states are the closed healthy/degraded/cooldown/unknown list', () => {
			assert.deepEqual(PROVIDER_HEALTH_STATES, ['healthy', 'degraded', 'cooldown', 'unknown']);
		});

		test('provider metadata verification is the closed unverified/verified list', () => {
			assert.deepEqual(PROVIDER_METADATA_VERIFICATIONS, ['unverified', 'verified']);
		});

		test('cooldown reasons are the closed four-reason list', () => {
			assert.deepEqual(COOLDOWN_REASONS, ['quota-exhausted', 'rate-limited', 'provider-error', 'manual-hold']);
		});

		test('reset schedule kinds are the closed four-kind list', () => {
			assert.deepEqual(RESET_SCHEDULE_KINDS, [
				'fixed-instant',
				'interval-aligned',
				'provider-discretion',
				'unknown',
			]);
		});

		test('disclosed capacity states are the closed five-state list', () => {
			assert.deepEqual(DISCLOSED_CAPACITY_STATES, ['available', 'limited', 'exhausted', 'cooldown', 'unknown']);
		});

		test('substitution states are the closed none/disclosed list', () => {
			assert.deepEqual(SUBSTITUTION_STATES, ['none', 'disclosed']);
		});
	});

	suite('the unverified-default law', () => {
		test('unknownSnapshot is the honest default: unknown health, unknown quota, no cooldown, unknown reset, unverified metadata', () => {
			const snapshot = unknownSnapshot(FIXTURE_PROVIDER_A, FIXTURE_NOW_MS);
			assert.equal(snapshot.contractVersion, DISCLOSURE_CONTRACT_VERSION);
			assert.equal(snapshot.providerId, FIXTURE_PROVIDER_A);
			assert.equal(snapshot.verification, 'unverified');
			assert.equal(snapshot.health, 'unknown');
			assert.deepEqual(snapshot.quota, { state: 'unknown' });
			assert.deepEqual(snapshot.cooldown, { state: 'none' });
			assert.deepEqual(snapshot.resetSchedule, { kind: 'unknown' });
			assert.equal(snapshot.observedAtEpochMs, FIXTURE_NOW_MS);
		});

		test('unknownSnapshot throws TypeError on a malformed provider id or timestamp', () => {
			assert.throws(() => unknownSnapshot('', FIXTURE_NOW_MS), TypeError);
			assert.throws(() => unknownSnapshot(foreign('42'), FIXTURE_NOW_MS), TypeError);
			assert.throws(() => unknownSnapshot(FIXTURE_PROVIDER_A, Number.NaN), TypeError);
			assert.throws(() => unknownSnapshot(FIXTURE_PROVIDER_A, foreign('"fixture.epoch"')), TypeError);
		});

		test('unverifiedProvenance defaults model verification to unverified and stamps the version', () => {
			const provenance = fixtureProvenance();
			assert.equal(provenance.modelVerification, 'unverified');
			assert.equal(provenance.contractVersion, DISCLOSURE_CONTRACT_VERSION);
		});

		test('unverifiedProvenance is honest by construction: a differing actual selection is labeled disclosed', () => {
			const provenance = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_A,
				requestedModelId: FIXTURE_MODEL_A,
				actualProviderId: FIXTURE_PROVIDER_B,
				actualModelId: FIXTURE_MODEL_B,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			assert.equal(provenance.substitution, 'disclosed');
			assert.equal(admitProvenance(provenance).admitted, true);
		});

		test('unverifiedProvenance keeps a same selection as substitution none', () => {
			assert.equal(fixtureProvenance().substitution, 'none');
		});

		test('unverifiedProvenance throws TypeError on empty ids or a non-finite timestamp', () => {
			assert.throws(
				() => unverifiedProvenance({
					requestedProviderId: '',
					requestedModelId: FIXTURE_MODEL_A,
					actualProviderId: FIXTURE_PROVIDER_A,
					actualModelId: FIXTURE_MODEL_A,
					recordedAtEpochMs: FIXTURE_NOW_MS,
				}),
				TypeError,
			);
			assert.throws(
				() => unverifiedProvenance({
					requestedProviderId: FIXTURE_PROVIDER_A,
					requestedModelId: FIXTURE_MODEL_A,
					actualProviderId: FIXTURE_PROVIDER_A,
					actualModelId: foreign('42'),
					recordedAtEpochMs: FIXTURE_NOW_MS,
				}),
				TypeError,
			);
			assert.throws(
				() => unverifiedProvenance({
					requestedProviderId: FIXTURE_PROVIDER_A,
					requestedModelId: FIXTURE_MODEL_A,
					actualProviderId: FIXTURE_PROVIDER_A,
					actualModelId: FIXTURE_MODEL_A,
					recordedAtEpochMs: foreign('null'),
				}),
				TypeError,
			);
		});
	});

	suite('verification transition (one-way promotion)', () => {
		test('markProvenanceVerified promotes unverified to verified and preserves every other field', () => {
			const before = fixtureProvenance();
			const after = markProvenanceVerified(before);
			assert.equal(after.modelVerification, 'verified');
			assert.equal(after.requestedProviderId, before.requestedProviderId);
			assert.equal(after.requestedModelId, before.requestedModelId);
			assert.equal(after.actualProviderId, before.actualProviderId);
			assert.equal(after.actualModelId, before.actualModelId);
			assert.equal(after.substitution, before.substitution);
			assert.equal(after.contractVersion, before.contractVersion);
			assert.equal(after.recordedAtEpochMs, before.recordedAtEpochMs);
			assert.equal(before.modelVerification, 'unverified');
		});

		test('promotion is idempotent: verified stays verified', () => {
			const once = markProvenanceVerified(fixtureProvenance());
			const twice = markProvenanceVerified(once);
			assert.equal(twice.modelVerification, 'verified');
			assert.deepEqual(once, twice);
		});

		test('promotion never rewrites the substitution label or the ids (no hidden rewrite)', () => {
			const disclosed = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_A,
				requestedModelId: FIXTURE_MODEL_A,
				actualProviderId: FIXTURE_PROVIDER_B,
				actualModelId: FIXTURE_MODEL_B,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			const promoted = markProvenanceVerified(disclosed);
			assert.equal(promoted.substitution, 'disclosed');
			assert.equal(promoted.actualProviderId, FIXTURE_PROVIDER_B);
			assert.equal(admitProvenance(promoted).admitted, true);
		});
	});

	suite('quota window boundary math (inclusive boundaries)', () => {
		const window = {
			kind: 'fixed' as const,
			windowStartEpochMs: FIXTURE_WINDOW_START_MS,
			windowLengthMs: FIXTURE_WINDOW_LENGTH_MS,
		};

		test('contains its start boundary (inclusive)', () => {
			assert.equal(quotaWindowContains(window, FIXTURE_WINDOW_START_MS), true);
		});

		test('contains its end boundary start+length (inclusive)', () => {
			assert.equal(quotaWindowContains(window, FIXTURE_WINDOW_START_MS + FIXTURE_WINDOW_LENGTH_MS), true);
		});

		test('excludes just before the start', () => {
			assert.equal(quotaWindowContains(window, FIXTURE_WINDOW_START_MS - 1), false);
		});

		test('excludes just past the end', () => {
			assert.equal(quotaWindowContains(window, FIXTURE_WINDOW_START_MS + FIXTURE_WINDOW_LENGTH_MS + 1), false);
		});

		test('treats fixed and rolling windows with the same inclusive math', () => {
			const rolling = { ...window, kind: 'rolling' as const };
			assert.equal(quotaWindowContains(rolling, FIXTURE_WINDOW_START_MS), true);
			assert.equal(quotaWindowContains(rolling, FIXTURE_WINDOW_START_MS + FIXTURE_WINDOW_LENGTH_MS), true);
			assert.equal(quotaWindowContains(rolling, FIXTURE_WINDOW_START_MS - 1), false);
			assert.equal(quotaWindowContains(rolling, FIXTURE_WINDOW_START_MS + FIXTURE_WINDOW_LENGTH_MS + 1), false);
		});

		test('fails closed: a non-finite probe or a malformed window contains nothing', () => {
			assert.equal(quotaWindowContains(window, Number.NaN), false);
			assert.equal(
				quotaWindowContains({ ...window, windowStartEpochMs: Number.NaN }, FIXTURE_NOW_MS),
				false,
			);
			assert.equal(
				quotaWindowContains({ ...window, windowLengthMs: Number.NaN }, FIXTURE_NOW_MS),
				false,
			);
			assert.equal(
				quotaWindowContains({ ...window, windowLengthMs: -1 }, FIXTURE_NOW_MS),
				false,
			);
		});
	});

	suite('reset schedule boundary math (inclusive boundaries)', () => {
		test('fixed-instant: before the reset, the instant is returned', () => {
			const schedule = { kind: 'fixed-instant' as const, atEpochMs: FIXTURE_NOW_MS + 30_000 };
			assert.equal(nextResetAt(schedule, FIXTURE_NOW_MS), FIXTURE_NOW_MS + 30_000);
		});

		test('fixed-instant: at the reset instant, the instant itself is returned (inclusive)', () => {
			const schedule = { kind: 'fixed-instant' as const, atEpochMs: FIXTURE_NOW_MS };
			assert.equal(nextResetAt(schedule, FIXTURE_NOW_MS), FIXTURE_NOW_MS);
		});

		test('fixed-instant: past the reset, the next reset is honestly unknown', () => {
			const schedule = { kind: 'fixed-instant' as const, atEpochMs: FIXTURE_NOW_MS - 1 };
			assert.equal(nextResetAt(schedule, FIXTURE_NOW_MS), 'unknown');
		});

		test('interval-aligned: before the anchor, the anchor is the next reset', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			assert.equal(nextResetAt(schedule, FIXTURE_WINDOW_START_MS - 1), FIXTURE_WINDOW_START_MS);
		});

		test('interval-aligned: at the anchor, the anchor itself is returned (inclusive)', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			assert.equal(nextResetAt(schedule, FIXTURE_WINDOW_START_MS), FIXTURE_WINDOW_START_MS);
		});

		test('interval-aligned: exactly on a later boundary, that boundary is returned (inclusive)', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			const boundary = FIXTURE_WINDOW_START_MS + 2 * FIXTURE_WINDOW_LENGTH_MS;
			assert.equal(nextResetAt(schedule, boundary), boundary);
		});

		test('interval-aligned: just before a boundary returns the boundary', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			const boundary = FIXTURE_WINDOW_START_MS + 2 * FIXTURE_WINDOW_LENGTH_MS;
			assert.equal(nextResetAt(schedule, boundary - 1), boundary);
		});

		test('interval-aligned: a far-future probe lands on the correct multiple', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			const probe = FIXTURE_WINDOW_START_MS + 7 * FIXTURE_WINDOW_LENGTH_MS + 1;
			assert.equal(
				nextResetAt(schedule, probe),
				FIXTURE_WINDOW_START_MS + 8 * FIXTURE_WINDOW_LENGTH_MS,
			);
		});

		test('provider-discretion and unknown schedules never guess: unknown', () => {
			assert.equal(nextResetAt({ kind: 'provider-discretion' }, FIXTURE_NOW_MS), 'unknown');
			assert.equal(nextResetAt({ kind: 'unknown' }, FIXTURE_NOW_MS), 'unknown');
		});

		test('fails closed: a non-finite probe or a malformed schedule yields unknown', () => {
			const schedule = {
				kind: 'interval-aligned' as const,
				anchorEpochMs: FIXTURE_WINDOW_START_MS,
				intervalMs: FIXTURE_WINDOW_LENGTH_MS,
			};
			assert.equal(nextResetAt(schedule, Number.NaN), 'unknown');
			assert.equal(nextResetAt({ ...schedule, intervalMs: 0 }, FIXTURE_NOW_MS), 'unknown');
			assert.equal(nextResetAt({ ...schedule, intervalMs: -1 }, FIXTURE_NOW_MS), 'unknown');
			assert.equal(nextResetAt({ ...schedule, anchorEpochMs: Number.NaN }, FIXTURE_NOW_MS), 'unknown');
			assert.equal(
				nextResetAt(foreign('"fixture.schedule"') as ResetSchedule, FIXTURE_NOW_MS),
				'unknown',
			);
		});
	});

	suite('cooldown boundary math (inclusive boundaries)', () => {
		const active = {
			state: 'active' as const,
			reason: 'rate-limited' as const,
			sinceEpochMs: FIXTURE_NOW_MS - 1_000,
			untilEpochMs: FIXTURE_NOW_MS + 30_000,
		};

		test('no cooldown is never active', () => {
			assert.equal(cooldownActive({ state: 'none' }, FIXTURE_NOW_MS), false);
		});

		test('active at the since boundary (inclusive)', () => {
			assert.equal(cooldownActive(active, active.sinceEpochMs), true);
		});

		test('active at the until boundary (inclusive)', () => {
			assert.equal(cooldownActive(active, active.untilEpochMs), true);
		});

		test('inactive just before since and just after until', () => {
			assert.equal(cooldownActive(active, active.sinceEpochMs - 1), false);
			assert.equal(cooldownActive(active, active.untilEpochMs + 1), false);
		});

		test('fails closed: a non-finite probe or an inverted cooldown is inactive', () => {
			assert.equal(cooldownActive(active, Number.NaN), false);
			assert.equal(
				cooldownActive({ ...active, sinceEpochMs: FIXTURE_NOW_MS + 10_000, untilEpochMs: FIXTURE_NOW_MS }, FIXTURE_NOW_MS),
				false,
			);
		});
	});

	suite('snapshot shape guard', () => {
		test('admits the honest fixture snapshot and the unknown snapshot', () => {
			assert.equal(isProviderCapacitySnapshot(fixtureHealthySnapshot()), true);
			assert.equal(isProviderCapacitySnapshot(unknownSnapshot(FIXTURE_PROVIDER_A, FIXTURE_NOW_MS)), true);
		});

		test('rejects a version mismatch, an empty provider id and a bad verification state', () => {
			assert.equal(isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), contractVersion: '0.9.9' }), false);
			assert.equal(isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), providerId: '' }), false);
			assert.equal(
				isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), verification: 'fixture.verification' }),
				false,
			);
		});

		test('rejects unknown health, malformed quota, malformed cooldown and malformed reset schedules', () => {
			assert.equal(isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), health: 'fixture.health' }), false);
			assert.equal(isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), quota: { state: 'fixture' } }), false);
			assert.equal(
				isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), quota: { state: 'known', remaining: 42.5, limit: 60, window: FIXTURE_WINDOW } }),
				false,
			);
			assert.equal(
				isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), quota: { state: 'known', remaining: -1, limit: 60, window: FIXTURE_WINDOW } }),
				false,
			);
			assert.equal(
				isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), cooldown: { state: 'active', reason: 'fixture.reason', sinceEpochMs: 0, untilEpochMs: 1 } }),
				false,
			);
			assert.equal(
				isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), resetSchedule: { kind: 'fixture.schedule' } }),
				false,
			);
		});

		test('rejects a non-finite observedAtEpochMs and non-objects', () => {
			assert.equal(isProviderCapacitySnapshot({ ...fixtureHealthySnapshot(), observedAtEpochMs: Number.NaN }), false);
			assert.equal(isProviderCapacitySnapshot(null), false);
			assert.equal(isProviderCapacitySnapshot('fixture.snapshot'), false);
		});
	});

	suite('provenance admission guard (every rejection path)', () => {
		test('rejects non-objects', () => {
			for (const candidate of [null, undefined, 'fixture.string', 42]) {
				const rejection = fixtureRejectedProvenance(admitProvenance(candidate));
				assert.equal(rejection.reason, 'not-an-object');
			}
		});

		test('rejects a version mismatch', () => {
			const rejection = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ contractVersion: '0.9.9' })));
			assert.equal(rejection.reason, 'version-mismatch');
		});

		test('rejects empty or non-string ids', () => {
			const rejection = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ requestedProviderId: '' })));
			assert.equal(rejection.reason, 'invalid-ids');
			const nonString = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ actualModelId: foreign('42') })));
			assert.equal(nonString.reason, 'invalid-ids');
		});

		test('rejects a substitution label outside the closed list', () => {
			const rejection = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ substitution: 'fixture.substitution' })));
			assert.equal(rejection.reason, 'invalid-substitution');
		});

		test('rejects THE hidden substitution: actual differs, label none', () => {
			const hidden = fixtureProvenanceWith({
				actualProviderId: FIXTURE_PROVIDER_B,
				substitution: 'none',
			});
			const rejection = fixtureRejectedProvenance(admitProvenance(hidden));
			assert.equal(rejection.reason, 'hidden-substitution');
			assert.equal(rejection.detail.includes('hidden substitution'), true);
		});

		test('rejects a substitution label mismatch: actual equals requested, label disclosed', () => {
			const mismatch = fixtureProvenanceWith({ substitution: 'disclosed' });
			const rejection = fixtureRejectedProvenance(admitProvenance(mismatch));
			assert.equal(rejection.reason, 'substitution-label-mismatch');
		});

		test('rejects a modelVerification outside the closed list', () => {
			const rejection = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ modelVerification: 'fixture.verification' })));
			assert.equal(rejection.reason, 'invalid-verification');
		});

		test('rejects a non-finite recordedAtEpochMs', () => {
			const rejection = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ recordedAtEpochMs: Number.NaN })));
			assert.equal(rejection.reason, 'invalid-recorded-at');
			const nonNumber = fixtureRejectedProvenance(admitProvenance(fixtureProvenanceWith({ recordedAtEpochMs: 'fixture.epoch' })));
			assert.equal(nonNumber.reason, 'invalid-recorded-at');
		});

		test('admits the honest no-substitution provenance and the honest disclosed-substitution provenance', () => {
			assert.equal(admitProvenance(fixtureProvenance()).admitted, true);
			const disclosed = fixtureProvenanceWith({
				actualProviderId: FIXTURE_PROVIDER_B,
				actualModelId: FIXTURE_MODEL_B,
				substitution: 'disclosed',
			});
			const admission = admitProvenance(disclosed);
			assert.equal(admission.admitted, true);
			if (admission.admitted) {
				assert.equal(admission.provenance.substitution, 'disclosed');
			}
		});

		test('admission never mutates the candidate', () => {
			const candidate = fixtureProvenance();
			const before = JSON.stringify(candidate);
			admitProvenance(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});
	});

	suite('capacity state projection (every typed state)', () => {
		test('cooldown: an active cooldown projects the cooldown state', () => {
			const snapshot = snapshotWith({
				cooldown: {
					state: 'active',
					reason: 'rate-limited',
					sinceEpochMs: FIXTURE_NOW_MS - 1_000,
					untilEpochMs: FIXTURE_NOW_MS + 30_000,
				},
			});
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'cooldown');
			}
		});

		test('cooldown: cooldown health alone projects the cooldown state', () => {
			const snapshot = snapshotWith({ health: 'cooldown' });
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'cooldown');
			}
		});

		test('unknown: unknown health projects unknown', () => {
			const snapshot = snapshotWith({ health: 'unknown' });
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'unknown');
			}
		});

		test('unknown: unknown quota projects unknown', () => {
			const snapshot = snapshotWith({ quota: { state: 'unknown' } });
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'unknown');
				assert.equal(outcome.disclosure.quotaRemaining, 'unknown');
			}
		});

		test('exhausted: zero remaining projects exhausted', () => {
			const snapshot = snapshotWith({
				quota: { state: 'known', remaining: 0, limit: 60, window: FIXTURE_WINDOW },
			});
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'exhausted');
				assert.equal(outcome.disclosure.quotaRemaining, 0);
			}
		});

		test('limited: degraded health projects limited even at full quota', () => {
			const snapshot = snapshotWith({ health: 'degraded' });
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'limited');
			}
		});

		test('limited: remaining below limit projects limited', () => {
			const snapshot = fixtureHealthySnapshot();
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'limited');
			}
		});

		test('available: healthy with full remaining projects available', () => {
			const snapshot = snapshotWith({
				quota: { state: 'known', remaining: 60, limit: 60, window: FIXTURE_WINDOW },
			});
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.capacityState, 'available');
			}
		});

		test('the disclosure carries the provider id, health, verification, quota, generatedAt and the version stamp', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				const disclosure = outcome.disclosure;
				assert.equal(disclosure.contractVersion, DISCLOSURE_CONTRACT_VERSION);
				assert.equal(disclosure.providerId, FIXTURE_PROVIDER_A);
				assert.equal(disclosure.health, 'healthy');
				assert.equal(disclosure.verification, 'unverified');
				assert.equal(disclosure.quotaRemaining, 42);
				assert.equal(disclosure.generatedAtEpochMs, FIXTURE_NOW_MS);
				assert.equal(isProviderCapacityDisclosure(disclosure), true);
			}
		});

		test('reset expectation is known with the basis kind and the next reset epoch', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.deepEqual(outcome.disclosure.resetExpectation, {
					kind: 'known',
					nextResetEpochMs: FIXTURE_WINDOW_START_MS,
					basis: 'interval-aligned',
				});
			}
		});

		test('reset expectation is unknown for provider-discretion schedules', () => {
			const snapshot = snapshotWith({ resetSchedule: { kind: 'provider-discretion' } });
			const outcome = projectCapacityDisclosure(snapshot, fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.deepEqual(outcome.disclosure.resetExpectation, { kind: 'unknown' });
			}
		});

		test('the provenance is carried verbatim on the disclosure (mandatory provenance)', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.deepEqual(outcome.disclosure.provenance, fixtureProvenance());
			}
		});

		test('a disclosed substitution flows through the projection honestly', () => {
			const provenance = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_A,
				requestedModelId: FIXTURE_MODEL_A,
				actualProviderId: FIXTURE_PROVIDER_B,
				actualModelId: FIXTURE_MODEL_B,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			const snapshotOfB = { ...fixtureHealthySnapshot(), providerId: FIXTURE_PROVIDER_B };
			const outcome = projectCapacityDisclosure(snapshotOfB, provenance, FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				assert.equal(outcome.disclosure.provenance.substitution, 'disclosed');
				assert.equal(outcome.disclosure.providerId, FIXTURE_PROVIDER_B);
			}
		});
	});

	suite('projection rejections (fail closed)', () => {
		test('rejects a malformed snapshot with invalid-snapshot', () => {
			const outcome = projectCapacityDisclosure(
				{ ...fixtureHealthySnapshot(), contractVersion: '0.9.9' },
				fixtureProvenance(),
				FIXTURE_NOW_MS,
			);
			const rejection = fixtureRejectedProjection(outcome);
			assert.equal(rejection.reason, 'invalid-snapshot');
		});

		test('rejects a provenance that fails admission with invalid-provenance', () => {
			const hidden = fixtureProvenanceWith({
				actualProviderId: FIXTURE_PROVIDER_B,
				substitution: 'none',
			});
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), hidden as InferenceProvenance, FIXTURE_NOW_MS);
			const rejection = fixtureRejectedProjection(outcome);
			assert.equal(rejection.reason, 'invalid-provenance');
			assert.equal(rejection.detail.includes('hidden-substitution'), true);
		});

		test('rejects a provenance naming a different provider than the snapshot (misattribution)', () => {
			const provenanceOfB = unverifiedProvenance({
				requestedProviderId: FIXTURE_PROVIDER_B,
				requestedModelId: FIXTURE_MODEL_A,
				actualProviderId: FIXTURE_PROVIDER_B,
				actualModelId: FIXTURE_MODEL_A,
				recordedAtEpochMs: FIXTURE_NOW_MS,
			});
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), provenanceOfB, FIXTURE_NOW_MS);
			const rejection = fixtureRejectedProjection(outcome);
			assert.equal(rejection.reason, 'provider-mismatch');
		});

		test('rejects a non-finite now with invalid-now', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), Number.NaN);
			const rejection = fixtureRejectedProjection(outcome);
			assert.equal(rejection.reason, 'invalid-now');
		});
	});

	suite('determinism and canonical serialization', () => {
		test('double projection is byte-equal', () => {
			const first = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			const second = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(first.disclosed, true);
			assert.equal(second.disclosed, true);
			if (first.disclosed && second.disclosed) {
				assert.equal(
					serializeCapacityDisclosure(first.disclosure),
					serializeCapacityDisclosure(second.disclosure),
				);
			}
		});

		test('canonical bytes are independent of the input key insertion order', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				const canonical = serializeCapacityDisclosure(outcome.disclosure);
				const shuffled = {
					generatedAtEpochMs: outcome.disclosure.generatedAtEpochMs,
					provenance: {
						recordedAtEpochMs: outcome.disclosure.provenance.recordedAtEpochMs,
						modelVerification: outcome.disclosure.provenance.modelVerification,
						substitution: outcome.disclosure.provenance.substitution,
						actualModelId: outcome.disclosure.provenance.actualModelId,
						actualProviderId: outcome.disclosure.provenance.actualProviderId,
						requestedModelId: outcome.disclosure.provenance.requestedModelId,
						requestedProviderId: outcome.disclosure.provenance.requestedProviderId,
						contractVersion: outcome.disclosure.provenance.contractVersion,
					},
					resetExpectation: outcome.disclosure.resetExpectation,
					quotaRemaining: outcome.disclosure.quotaRemaining,
					capacityState: outcome.disclosure.capacityState,
					verification: outcome.disclosure.verification,
					health: outcome.disclosure.health,
					providerId: outcome.disclosure.providerId,
					contractVersion: outcome.disclosure.contractVersion,
				};
				assert.equal(serializeCapacityDisclosure(shuffled as ProviderCapacityDisclosure), canonical);
			}
		});

		test('unknownSnapshot double construction is JSON-identical', () => {
			const first = JSON.stringify(unknownSnapshot(FIXTURE_PROVIDER_A, FIXTURE_NOW_MS));
			const second = JSON.stringify(unknownSnapshot(FIXTURE_PROVIDER_A, FIXTURE_NOW_MS));
			assert.equal(first, second);
		});

		test('the canonical bytes carry the version stamp', () => {
			const outcome = projectCapacityDisclosure(fixtureHealthySnapshot(), fixtureProvenance(), FIXTURE_NOW_MS);
			assert.equal(outcome.disclosed, true);
			if (outcome.disclosed) {
				const bytes = serializeCapacityDisclosure(outcome.disclosure);
				assert.equal(bytes.includes(`"contractVersion":"${DISCLOSURE_CONTRACT_VERSION}"`), true);
			}
		});
	});
});
