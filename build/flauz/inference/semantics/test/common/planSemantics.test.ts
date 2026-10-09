/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-001 Free-plan semantics test suite (mocha tdd style, matching
 * build/flauz/capabilities/commands/test/common/mirror.test.ts).
 *
 * Fixture policy: every plan id and every probe value below is
 * SYNTHETIC (prefixed 'fixture.') and is NOT an authority value.
 * Closed-vocabulary members (tier names, guarantee names) are the
 * contract's own values under test. Runtime-boundary probes are
 * injected as JSON-parsed values, the shape foreign input arrives
 * in at a real boundary.
 */
import { strict as assert } from 'node:assert';
import {
	CAPACITY_PROVENANCES,
	FLAUZ_PLAN_TIERS,
	FLAUZ_PRODUCT_GUARANTEES,
	FLAUZ_PRODUCT_PROMISE,
	HONEST_PROMISE_REJECTION_REASONS,
	INFERENCE_SEMANTICS_CONTRACTS_VERSION,
	PLAN_TIER_SEMANTICS,
	PLAN_TIER_TRANSITIONS,
	PROVIDER_CAPACITY_GUARANTEES,
	TIER_TRANSITION_REJECTION_REASONS,
	admitHonestPromise,
	assertHonestPromise,
	canTransitionPlanTier,
	isPlanSemanticsRecord,
	planSemanticsForTier,
	serializePlanSemanticsRecord,
	transitionPlanSemantics,
} from '../../common/planSemantics.js';
import type {
	DishonestPromise,
	HonestPromiseAdmission,
	PlanSemanticsRecord,
	TierTransitionOutcome,
} from '../../common/planSemantics.js';

const FIXTURE_PLAN_ID = 'fixture.plan.alpha';

function fixtureRecord(tier: 'free' | 'provisioned' | 'self-hosted'): PlanSemanticsRecord {
	return planSemanticsForTier(tier, FIXTURE_PLAN_ID);
}

function fixtureDishonest(admission: HonestPromiseAdmission): DishonestPromise {
	assert.equal(admission.honest, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as DishonestPromise;
}

function rejectedTransition(outcome: TierTransitionOutcome): { reason: string; detail: string } {
	assert.equal(outcome.transitioned, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
	return { reason: outcome.reason, detail: outcome.detail };
}

function appliedTransition(outcome: TierTransitionOutcome): { from: string; to: string; record: PlanSemanticsRecord } {
	assert.equal(outcome.transitioned, true, `expected transition, got: ${JSON.stringify(outcome)}`);
	return outcome as unknown as { from: string; to: string; record: PlanSemanticsRecord };
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

function thrownMessage(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		return String((error as Error).message);
	}
	return 'no-throw';
}

suite('INF-001 Free-plan promise semantics', () => {

	suite('constants and closed lists', () => {
		test('contract set version is 1.0.0', () => {
			assert.equal(INFERENCE_SEMANTICS_CONTRACTS_VERSION, '1.0.0');
		});

		test('plan tiers are the closed free/provisioned/self-hosted list', () => {
			assert.deepEqual(FLAUZ_PLAN_TIERS, ['free', 'provisioned', 'self-hosted']);
		});

		test('the provider-side guarantee vocabulary never contains unlimited (the lie is unrepresentable)', () => {
			assert.deepEqual(PROVIDER_CAPACITY_GUARANTEES, ['provider-dependent']);
			assert.equal((PROVIDER_CAPACITY_GUARANTEES as readonly string[]).includes('unlimited'), false);
		});

		test('only the product-side guarantee vocabulary contains unlimited, alongside metered', () => {
			assert.deepEqual(FLAUZ_PRODUCT_GUARANTEES, ['unlimited', 'metered']);
		});

		test('capacity provenances are the closed three-source list', () => {
			assert.deepEqual(CAPACITY_PROVENANCES, [
				'third-party-free-tier',
				'flauz-provisioned',
				'user-owned-endpoint',
			]);
		});

		test('rejection vocabularies are closed, non-empty and duplicate-free', () => {
			for (const list of [HONEST_PROMISE_REJECTION_REASONS, TIER_TRANSITION_REJECTION_REASONS]) {
				assert.equal(list.length > 0, true);
				assert.equal(new Set(list).size, list.length);
			}
		});
	});

	suite('planSemanticsForTier derivation', () => {
		test('every tier derives the unlimited product-side promise (the Free plan law)', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				const record = planSemanticsForTier(tier, FIXTURE_PLAN_ID);
				assert.deepEqual(record.productPromise, FLAUZ_PRODUCT_PROMISE);
				assert.equal(record.productPromise.promiseSide, 'flauz-side');
				assert.equal(record.productPromise.subject, 'flauz-product-usage');
				assert.equal(record.productPromise.guarantee, 'unlimited');
			}
		});

		test('every tier derives a provider-dependent capacity claim (never unlimited)', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				const claim = planSemanticsForTier(tier, FIXTURE_PLAN_ID).providerCapacityClaim;
				assert.equal(claim.promiseSide, 'provider-side');
				assert.equal(claim.subject, 'provider-capacity');
				assert.equal(claim.guarantee, 'provider-dependent');
			}
		});

		test('tiers differ only in capacity provenance and match the frozen table', () => {
			assert.equal(PLAN_TIER_SEMANTICS.free.capacityProvenance, 'third-party-free-tier');
			assert.equal(PLAN_TIER_SEMANTICS.provisioned.capacityProvenance, 'flauz-provisioned');
			assert.equal(PLAN_TIER_SEMANTICS['self-hosted'].capacityProvenance, 'user-owned-endpoint');
			for (const tier of FLAUZ_PLAN_TIERS) {
				assert.deepEqual(
					planSemanticsForTier(tier, FIXTURE_PLAN_ID).providerCapacityClaim,
					PLAN_TIER_SEMANTICS[tier],
				);
			}
		});

		test('every derived record is admitted by the honest-promise guard and stamps the version', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				const record = planSemanticsForTier(tier, FIXTURE_PLAN_ID);
				assert.equal(record.contractVersion, INFERENCE_SEMANTICS_CONTRACTS_VERSION);
				const admission = admitHonestPromise(record);
				assert.equal(admission.honest, true, `tier '${tier}' must be admitted`);
			}
		});

		test('the planId is carried verbatim and never minted', () => {
			assert.equal(planSemanticsForTier('free', 'fixture.plan.beta').planId, 'fixture.plan.beta');
		});

		test('throws TypeError on an unknown tier (fail-closed factory)', () => {
			assert.throws(
				() => planSemanticsForTier(foreign('"fixture.tier.enterprise"'), FIXTURE_PLAN_ID),
				TypeError,
			);
		});

		test('throws TypeError on an empty plan id', () => {
			assert.throws(() => planSemanticsForTier('free', ''), TypeError);
		});
	});

	suite('tier transitions', () => {
		test('the transition table allows every cross-tier move and forbids same-tier', () => {
			assert.deepEqual(PLAN_TIER_TRANSITIONS.free, ['provisioned', 'self-hosted']);
			assert.deepEqual(PLAN_TIER_TRANSITIONS.provisioned, ['free', 'self-hosted']);
			assert.deepEqual(PLAN_TIER_TRANSITIONS['self-hosted'], ['free', 'provisioned']);
			for (const from of FLAUZ_PLAN_TIERS) {
				for (const to of FLAUZ_PLAN_TIERS) {
					assert.equal(canTransitionPlanTier(from, to), from !== to);
				}
			}
		});

		test('canTransitionPlanTier fails closed on unknown tiers', () => {
			assert.equal(canTransitionPlanTier(foreign('"fixture.tier.enterprise"'), 'free'), false);
			assert.equal(canTransitionPlanTier('free', foreign('"fixture.tier.enterprise"')), false);
		});

		test('every allowed transition re-derives honest target-tier semantics over the same plan id', () => {
			for (const from of FLAUZ_PLAN_TIERS) {
				for (const to of PLAN_TIER_TRANSITIONS[from]) {
					const applied = appliedTransition(transitionPlanSemantics(fixtureRecord(from), to));
					assert.equal(applied.from, from);
					assert.equal(applied.to, to);
					assert.deepEqual(applied.record, planSemanticsForTier(to, FIXTURE_PLAN_ID));
					assert.equal(applied.record.planId, FIXTURE_PLAN_ID);
					assert.equal(admitHonestPromise(applied.record).honest, true);
				}
			}
		});

		test('same-tier is rejected with the closed reason', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				const rejection = rejectedTransition(transitionPlanSemantics(fixtureRecord(tier), tier));
				assert.equal(rejection.reason, 'same-tier');
			}
		});

		test('an unknown target tier is rejected', () => {
			const rejection = rejectedTransition(
				transitionPlanSemantics(fixtureRecord('free'), foreign('"fixture.tier.enterprise"')),
			);
			assert.equal(rejection.reason, 'unknown-tier');
		});

		test('a dishonest input record is rejected before any transition', () => {
			const lie = { ...fixtureRecord('free'), providerCapacityClaim: { ...fixtureRecord('free').providerCapacityClaim, guarantee: 'unlimited' } };
			const rejection = rejectedTransition(transitionPlanSemantics(lie, 'provisioned'));
			assert.equal(rejection.reason, 'invalid-record');
			assert.equal(rejection.detail.includes('unlimited-provider-capacity'), true);
		});

		test('transition outcomes are deterministic: double-run serialization is byte-equal', () => {
			const first = appliedTransition(transitionPlanSemantics(fixtureRecord('free'), 'provisioned'));
			const second = appliedTransition(transitionPlanSemantics(fixtureRecord('free'), 'provisioned'));
			assert.equal(serializePlanSemanticsRecord(first.record), serializePlanSemanticsRecord(second.record));
		});
	});

	suite('assertHonestPromise / admitHonestPromise rejections (every path)', () => {
		test('rejects non-objects: null, undefined, strings, numbers, booleans', () => {
			for (const candidate of [null, undefined, 'fixture.string', 42, true]) {
				const rejection = fixtureDishonest(admitHonestPromise(candidate));
				assert.equal(rejection.reason, 'not-an-object');
			}
			assert.throws(() => assertHonestPromise(null), /not-an-object/);
		});

		test('rejects a contract-version mismatch', () => {
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), contractVersion: '0.9.9' }));
			assert.equal(rejection.reason, 'version-mismatch');
			const missing = { ...fixtureRecord('free') } as Record<string, unknown>;
			delete missing.contractVersion;
			assert.equal(fixtureDishonest(admitHonestPromise(missing)).reason, 'version-mismatch');
		});

		test('rejects a missing or empty plan id', () => {
			assert.equal(
				fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), planId: '' })).reason,
				'invalid-plan-id',
			);
			const missing = { ...fixtureRecord('free') } as Record<string, unknown>;
			delete missing.planId;
			assert.equal(fixtureDishonest(admitHonestPromise(missing)).reason, 'invalid-plan-id');
		});

		test('rejects an unknown tier', () => {
			const rejection = fixtureDishonest(
				admitHonestPromise({ ...fixtureRecord('free'), tier: 'fixture.tier.enterprise' }),
			);
			assert.equal(rejection.reason, 'unknown-tier');
		});

		test('rejects a non-object product promise', () => {
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), productPromise: 'fixture.promise' }));
			assert.equal(rejection.reason, 'invalid-product-promise');
		});

		test('rejects a product guarantee outside the closed vocabulary', () => {
			const promise = { ...FLAUZ_PRODUCT_PROMISE, guarantee: 'fixture.guarantee.eternal' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), productPromise: promise }));
			assert.equal(rejection.reason, 'invalid-product-promise');
		});

		test('rejects the lie: a provider-side claim carrying the unlimited guarantee', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, guarantee: 'unlimited' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }));
			assert.equal(rejection.reason, 'unlimited-provider-capacity');
			assert.throws(() => assertHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }), /unlimited-provider-capacity/);
		});

		test('rejects the lie: unlimited attached to provider capacity on the product side', () => {
			const promise = { promiseSide: 'flauz-side', subject: 'provider-capacity', guarantee: 'unlimited' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), productPromise: promise }));
			assert.equal(rejection.reason, 'unlimited-provider-capacity');
		});

		test('rejects product-promise side conflation', () => {
			const promise = { promiseSide: 'provider-side', subject: 'flauz-product-usage', guarantee: 'metered' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), productPromise: promise }));
			assert.equal(rejection.reason, 'promise-conflation');
		});

		test('rejects product-promise subject conflation', () => {
			const promise = { promiseSide: 'flauz-side', subject: 'provider-capacity', guarantee: 'metered' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), productPromise: promise }));
			assert.equal(rejection.reason, 'promise-conflation');
		});

		test('rejects a non-object provider claim', () => {
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: 42 }));
			assert.equal(rejection.reason, 'invalid-provider-claim');
		});

		test('rejects provider-claim side conflation', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, promiseSide: 'flauz-side' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }));
			assert.equal(rejection.reason, 'promise-conflation');
		});

		test('rejects provider-claim subject conflation', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, subject: 'flauz-product-usage' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }));
			assert.equal(rejection.reason, 'promise-conflation');
		});

		test('rejects a provider guarantee outside the closed vocabulary', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, guarantee: 'fixture.guarantee.bounded' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }));
			assert.equal(rejection.reason, 'invalid-provider-claim');
		});

		test('rejects an unknown capacity provenance', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, capacityProvenance: 'fixture.provenance.moon' };
			const rejection = fixtureDishonest(admitHonestPromise({ ...fixtureRecord('free'), providerCapacityClaim: claim }));
			assert.equal(rejection.reason, 'invalid-provider-claim');
		});

		test('assertHonestPromise throws a deterministic Error naming the reason', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, guarantee: 'unlimited' };
			const lie = { ...fixtureRecord('free'), providerCapacityClaim: claim };
			const first = thrownMessage(() => assertHonestPromise(lie));
			const second = thrownMessage(() => assertHonestPromise(lie));
			assert.equal(first, second);
			assert.equal(first.includes('unlimited-provider-capacity'), true);
		});
	});

	suite('honest acceptance', () => {
		test('admits every canonical tier record', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				assert.equal(admitHonestPromise(fixtureRecord(tier)).honest, true);
				assert.equal(isPlanSemanticsRecord(fixtureRecord(tier)), true);
			}
		});

		test('admits a custom metered product promise (honest, non-canonical)', () => {
			const record = {
				...fixtureRecord('provisioned'),
				productPromise: { promiseSide: 'flauz-side', subject: 'flauz-product-usage', guarantee: 'metered' },
			};
			assert.equal(admitHonestPromise(record).honest, true);
		});

		test('admission never mutates the candidate', () => {
			const candidate = fixtureRecord('free');
			const before = JSON.stringify(candidate);
			admitHonestPromise(candidate);
			assertHonestPromise(candidate);
			assert.equal(JSON.stringify(candidate), before);
		});

		test('assertHonestPromise returns the narrowed record', () => {
			const narrowed = assertHonestPromise(fixtureRecord('self-hosted'));
			assert.equal(narrowed.tier, 'self-hosted');
			assert.equal(narrowed.providerCapacityClaim.capacityProvenance, 'user-owned-endpoint');
		});
	});

	suite('determinism and canonical serialization', () => {
		test('double derivation is byte-equal for every tier', () => {
			for (const tier of FLAUZ_PLAN_TIERS) {
				const first = serializePlanSemanticsRecord(planSemanticsForTier(tier, FIXTURE_PLAN_ID));
				const second = serializePlanSemanticsRecord(planSemanticsForTier(tier, FIXTURE_PLAN_ID));
				assert.equal(first, second);
				assert.equal(typeof first, 'string');
			}
		});

		test('canonical bytes are independent of the input key insertion order', () => {
			const canonical = serializePlanSemanticsRecord(fixtureRecord('free'));
			const shuffled = {
				providerCapacityClaim: fixtureRecord('free').providerCapacityClaim,
				productPromise: fixtureRecord('free').productPromise,
				tier: 'free' as const,
				contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
				planId: FIXTURE_PLAN_ID,
			};
			assert.equal(serializePlanSemanticsRecord(shuffled), canonical);
		});

		test('each tier serializes to distinct canonical bytes', () => {
			const bytes = FLAUZ_PLAN_TIERS.map((tier) => serializePlanSemanticsRecord(fixtureRecord(tier)));
			assert.equal(new Set(bytes).size, bytes.length);
		});

		test('the canonical bytes carry the version stamp', () => {
			const bytes = serializePlanSemanticsRecord(fixtureRecord('free'));
			assert.equal(bytes.includes(`"contractVersion":"${INFERENCE_SEMANTICS_CONTRACTS_VERSION}"`), true);
		});

		test('serialization refuses dishonest records (fail closed)', () => {
			const claim = { ...fixtureRecord('free').providerCapacityClaim, guarantee: 'unlimited' };
			const lie = { ...fixtureRecord('free'), providerCapacityClaim: claim };
			assert.throws(() => serializePlanSemanticsRecord(lie), /unlimited-provider-capacity/);
		});
	});
});
