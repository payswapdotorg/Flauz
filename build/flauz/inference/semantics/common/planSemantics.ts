/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-001 Free Inference Fabric contracts: the Free-plan promise
 * semantics - the promise split, the typed plan tiers, the typed
 * plan-semantic record and the fail-closed honest-promise guard
 * (contract module, the labContracts discipline).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'):
 * - THE PROMISE-SPLIT LAW (binding): the user-facing Free plan
 *   promise is 'unlimited Flauz usage' - the product-experience
 *   guarantee, always Flauz-side. It is NEVER 'unlimited provider
 *   tokens': provider capacity is what a provider actually
 *   permits, always provider-dependent, always provider-side. The
 *   two sides of the split are distinct types; a record that
 *   conflates them (product side speaking for provider capacity,
 *   or provider side speaking for product usage) is rejected.
 * - Unrepresentable AND rejected: the provider-side guarantee
 *   vocabulary is closed to 'provider-dependent' alone, so the
 *   'unlimited provider tokens' promise cannot be typed; the
 *   fail-closed guard rejects it anyway at runtime boundaries
 *   where types do not reach (persisted records, foreign input).
 * - No shared public Flauz gateway pooling third-party free-tier
 *   provider keys: 'third-party-free-tier' capacity is disclosed
 *   capacity, never a Flauz guarantee.
 * - No hidden provider/model substitution: the sibling
 *   capacityDisclosure module owns the provenance contract that
 *   binds this law; this module never models key pools or
 *   substitution itself.
 * - Determinism: no Math.random, no Date.now, no new Date, no
 *   process.env in this module. Timestamps are injected plain
 *   numbers; ids are injected plain strings.
 * - Zero-dependency: this module pulls in nothing from other
 *   modules. The contract-set version shared with the sibling
 *   capacityDisclosure module is re-declared here and pinned
 *   structurally by the test suite (the COMMAND_FACADE idiom).
 * - Vocabulary only: this module declares types, constants, pure
 *   guards and pure transitions. It is not a runtime, not an
 *   engine, not a scheduler, not a second authority.
 * - Every persisted record carries contractVersion.
 */

/** Version of the inference-semantics contract set (all modules carry it). */
export const INFERENCE_SEMANTICS_CONTRACTS_VERSION = '1.0.0';

/**
 * The closed, minimal honest tier set. The tiers differ ONLY in
 * capacity provenance (where provider-side capacity actually comes
 * from); the Flauz-side product promise is uniform. Defended in the
 * subtree README; changing the set is a contract change requiring
 * a version bump.
 */
export const FLAUZ_PLAN_TIERS = ['free', 'provisioned', 'self-hosted'] as const;
export type FlauzPlanTier = (typeof FLAUZ_PLAN_TIERS)[number];

/** Flauz-side promise subjects: what the product itself guarantees. */
export const FLAUZ_SIDE_PROMISE_SUBJECTS = ['flauz-product-usage'] as const;
export type FlauzSidePromiseSubject = (typeof FLAUZ_SIDE_PROMISE_SUBJECTS)[number];

/**
 * Product-experience guarantees. Only the product side may say
 * 'unlimited', and only about flauz-product-usage.
 */
export const FLAUZ_PRODUCT_GUARANTEES = ['unlimited', 'metered'] as const;
export type FlauzProductGuarantee = (typeof FLAUZ_PRODUCT_GUARANTEES)[number];

/**
 * The Flauz-side promise: the product-experience guarantee. This is
 * the side of the split that may carry 'unlimited' - and only over
 * flauz-product-usage.
 */
export interface FlauzSidePromise {
	readonly promiseSide: 'flauz-side';
	readonly subject: FlauzSidePromiseSubject;
	readonly guarantee: FlauzProductGuarantee;
}

/**
 * The closed provider-side guarantee vocabulary: provider capacity
 * is ALWAYS provider-dependent. 'unlimited' is not a member and can
 * never be added (the unrepresentable lie).
 */
export const PROVIDER_CAPACITY_GUARANTEES = ['provider-dependent'] as const;
export type ProviderCapacityGuarantee = (typeof PROVIDER_CAPACITY_GUARANTEES)[number];

/** Provider-side claim subjects: what a provider actually permits. */
export const PROVIDER_SIDE_CLAIM_SUBJECTS = ['provider-capacity'] as const;
export type ProviderSideClaimSubject = (typeof PROVIDER_SIDE_CLAIM_SUBJECTS)[number];

/**
 * Where plan capacity actually comes from. Provenance is disclosed
 * capacity, never a Flauz guarantee:
 * - third-party-free-tier: permitted user-owned/direct third-party
 *   free-tier capacity (never a shared public Flauz key pool);
 * - flauz-provisioned: capacity Flauz provisions under its own
 *   arrangements;
 * - user-owned-endpoint: the user's own local/self-hosted endpoint.
 */
export const CAPACITY_PROVENANCES = [
	'third-party-free-tier',
	'flauz-provisioned',
	'user-owned-endpoint',
] as const;
export type CapacityProvenance = (typeof CAPACITY_PROVENANCES)[number];

/**
 * The ProviderCapacityClaim: what a provider actually permits.
 * Always provider-dependent; carries the capacity provenance so the
 * claim stays attributable and observable. This type can never
 * express 'unlimited' - that is the promise-split law made
 * structural.
 */
export interface ProviderCapacityClaim {
	readonly promiseSide: 'provider-side';
	readonly subject: ProviderSideClaimSubject;
	readonly guarantee: ProviderCapacityGuarantee;
	readonly capacityProvenance: CapacityProvenance;
}

/**
 * The typed plan-semantic record: one honest plan semantics as the
 * persistence/audit shape. Carries the contract-set version stamp.
 */
export interface PlanSemanticsRecord {
	readonly planId: string;
	readonly contractVersion: string;
	readonly tier: FlauzPlanTier;
	readonly productPromise: FlauzSidePromise;
	readonly providerCapacityClaim: ProviderCapacityClaim;
}

/**
 * The canonical Flauz-side product promise (the Free plan law,
 * tier-independent): unlimited Flauz product usage.
 */
export const FLAUZ_PRODUCT_PROMISE: Readonly<FlauzSidePromise> = Object.freeze({
	promiseSide: 'flauz-side',
	subject: 'flauz-product-usage',
	guarantee: 'unlimited',
});

/**
 * The canonical tier semantics table: the provider-side capacity
 * claim per tier. The tiers differ only in capacity provenance.
 * Frozen; changing an entry is a contract change requiring a
 * version bump.
 */
export const PLAN_TIER_SEMANTICS: Readonly<Record<FlauzPlanTier, ProviderCapacityClaim>> = Object.freeze({
	free: {
		promiseSide: 'provider-side',
		subject: 'provider-capacity',
		guarantee: 'provider-dependent',
		capacityProvenance: 'third-party-free-tier',
	},
	provisioned: {
		promiseSide: 'provider-side',
		subject: 'provider-capacity',
		guarantee: 'provider-dependent',
		capacityProvenance: 'flauz-provisioned',
	},
	'self-hosted': {
		promiseSide: 'provider-side',
		subject: 'provider-capacity',
		guarantee: 'provider-dependent',
		capacityProvenance: 'user-owned-endpoint',
	},
});

/**
 * Pure derivation: the plan-semantic record for one tier and one
 * injected planId. Deterministic; stamps the contract-set version;
 * never reads a clock and never mints ids. Throws TypeError on an
 * unknown tier or an empty planId (fail-closed factory).
 */
export function planSemanticsForTier(tier: FlauzPlanTier, planId: string): PlanSemanticsRecord {
	if (!isNonEmptyString(planId)) {
		throw new TypeError('planSemanticsForTier: planId must be a non-empty string');
	}
	if (!isFlauzPlanTier(tier)) {
		throw new TypeError(
			`planSemanticsForTier: tier must be one of free/provisioned/self-hosted, got '${String(tier)}'`,
		);
	}
	return {
		planId,
		contractVersion: INFERENCE_SEMANTICS_CONTRACTS_VERSION,
		tier,
		productPromise: FLAUZ_PRODUCT_PROMISE,
		providerCapacityClaim: PLAN_TIER_SEMANTICS[tier],
	};
}

/** Closed list of honest-promise rejection reasons. */
export const HONEST_PROMISE_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-plan-id',
	'unknown-tier',
	'invalid-product-promise',
	'promise-conflation',
	'unlimited-provider-capacity',
	'invalid-provider-claim',
] as const;
export type HonestPromiseRejectionReason = (typeof HONEST_PROMISE_REJECTION_REASONS)[number];

export interface HonestPromise {
	readonly honest: true;
	readonly record: PlanSemanticsRecord;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface DishonestPromise {
	readonly honest: false;
	readonly reason: HonestPromiseRejectionReason;
	readonly detail: string;
}

export type HonestPromiseAdmission = HonestPromise | DishonestPromise;

/**
 * Pure fail-closed guard: admits only records whose product-side
 * usage promise and provider-side capacity claim stay on their own
 * sides of the promise split. THE LIE is detected and named
 * wherever it appears: a provider-side 'unlimited' guarantee, or
 * any 'unlimited' guarantee attached to provider capacity.
 * Deterministic: same candidate, same verdict, same reason and
 * detail. Never mutates its input; never reads a clock.
 */
export function admitHonestPromise(candidate: unknown): HonestPromiseAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_SEMANTICS_CONTRACTS_VERSION) {
		return reject(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_SEMANTICS_CONTRACTS_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const planId = record.planId;
	if (!isNonEmptyString(planId)) {
		return reject('invalid-plan-id', 'planId must be a non-empty string');
	}
	const tier = record.tier;
	if (!isFlauzPlanTier(tier)) {
		return reject(
			'unknown-tier',
			`tier must be one of free/provisioned/self-hosted, got '${String(tier)}'`,
		);
	}
	const productPromise = record.productPromise;
	const providerClaim = record.providerCapacityClaim;
	// THE LIE is checked first, on both sides of the split, so an
	// 'unlimited provider tokens' promise is always named as the lie
	// and never downgraded to a generic shape rejection.
	if (
		isRecord(productPromise)
		&& (productPromise as Record<string, unknown>).subject === 'provider-capacity'
		&& (productPromise as Record<string, unknown>).guarantee === 'unlimited'
	) {
		return reject(
			'unlimited-provider-capacity',
			'a product-side promise may not attach the unlimited guarantee to provider capacity - the unlimited provider tokens promise is a lie by law',
		);
	}
	if (isRecord(providerClaim) && (providerClaim as Record<string, unknown>).guarantee === 'unlimited') {
		return reject(
			'unlimited-provider-capacity',
			'a provider capacity claim may never carry the unlimited guarantee - provider capacity is always provider-dependent',
		);
	}
	// Product-promise shape and side wiring.
	if (!isRecord(productPromise)) {
		return reject('invalid-product-promise', 'productPromise must be a non-null object');
	}
	const promise = productPromise as Record<string, unknown>;
	if (promise.promiseSide !== 'flauz-side') {
		return reject(
			'promise-conflation',
			`productPromise.promiseSide must be 'flauz-side', got '${String(promise.promiseSide)}'`,
		);
	}
	if (promise.subject !== 'flauz-product-usage') {
		return reject(
			'promise-conflation',
			`productPromise.subject must be 'flauz-product-usage' (the product side never speaks for provider capacity), got '${String(promise.subject)}'`,
		);
	}
	const productGuarantee = promise.guarantee;
	if (!isFlauzProductGuarantee(productGuarantee)) {
		return reject(
			'invalid-product-promise',
			`productPromise.guarantee must be unlimited or metered, got '${String(productGuarantee)}'`,
		);
	}
	// Provider-claim shape and side wiring.
	if (!isRecord(providerClaim)) {
		return reject('invalid-provider-claim', 'providerCapacityClaim must be a non-null object');
	}
	const claim = providerClaim as Record<string, unknown>;
	if (claim.promiseSide !== 'provider-side') {
		return reject(
			'promise-conflation',
			`providerCapacityClaim.promiseSide must be 'provider-side', got '${String(claim.promiseSide)}'`,
		);
	}
	if (claim.subject !== 'provider-capacity') {
		return reject(
			'promise-conflation',
			`providerCapacityClaim.subject must be 'provider-capacity' (the provider side never speaks for product usage), got '${String(claim.subject)}'`,
		);
	}
	const providerGuarantee = claim.guarantee;
	if (!isProviderCapacityGuarantee(providerGuarantee)) {
		return reject(
			'invalid-provider-claim',
			`providerCapacityClaim.guarantee must be provider-dependent, got '${String(providerGuarantee)}'`,
		);
	}
	const capacityProvenance = claim.capacityProvenance;
	if (!isCapacityProvenance(capacityProvenance)) {
		return reject(
			'invalid-provider-claim',
			`capacityProvenance must be one of third-party-free-tier/flauz-provisioned/user-owned-endpoint, got '${String(capacityProvenance)}'`,
		);
	}
	return {
		honest: true,
		record: {
			planId,
			contractVersion,
			tier,
			productPromise: {
				promiseSide: 'flauz-side',
				subject: 'flauz-product-usage',
				guarantee: productGuarantee,
			},
			providerCapacityClaim: {
				promiseSide: 'provider-side',
				subject: 'provider-capacity',
				guarantee: providerGuarantee,
				capacityProvenance,
			},
		},
	};
}

/**
 * Throwing fail-closed wrapper over admitHonestPromise: returns the
 * narrowed honest record or throws a deterministic Error naming the
 * rejection reason. For hard runtime boundaries.
 */
export function assertHonestPromise(candidate: unknown): PlanSemanticsRecord {
	const admission = admitHonestPromise(candidate);
	if (admission.honest) {
		return admission.record;
	}
	throw new Error(
		`assertHonestPromise: dishonest promise rejected '${admission.reason}': ${admission.detail}`,
	);
}

/** Pure shape predicate: an honest, well-formed plan-semantic record. */
export function isPlanSemanticsRecord(value: unknown): value is PlanSemanticsRecord {
	return admitHonestPromise(value).honest;
}

/** Pure tier predicate over the closed tier list. */
export function isFlauzPlanTier(value: unknown): value is FlauzPlanTier {
	return (FLAUZ_PLAN_TIERS as readonly string[]).includes(value as string);
}

/**
 * The tier-transition whitelist: every cross-tier move is explicit;
 * a same-tier move is not a transition. Frozen; changing the table
 * is a contract change requiring a version bump.
 */
export const PLAN_TIER_TRANSITIONS: Readonly<Record<FlauzPlanTier, readonly FlauzPlanTier[]>> = Object.freeze({
	free: Object.freeze(['provisioned', 'self-hosted'] as const),
	provisioned: Object.freeze(['free', 'self-hosted'] as const),
	'self-hosted': Object.freeze(['free', 'provisioned'] as const),
});

/**
 * Pure verdict: is this cross-tier move an allowed transition?
 * Same-tier is false (not a transition); unknown tiers are false
 * (fail closed).
 */
export function canTransitionPlanTier(from: FlauzPlanTier, to: FlauzPlanTier): boolean {
	if (!isFlauzPlanTier(from) || !isFlauzPlanTier(to)) {
		return false;
	}
	if (from === to) {
		return false;
	}
	return (PLAN_TIER_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** Closed list of tier-transition rejection reasons. */
export const TIER_TRANSITION_REJECTION_REASONS = [
	'invalid-record',
	'same-tier',
	'unknown-tier',
	'transition-not-allowed',
] as const;
export type TierTransitionRejectionReason = (typeof TIER_TRANSITION_REJECTION_REASONS)[number];

export interface TierTransitionApplied {
	readonly transitioned: true;
	readonly from: FlauzPlanTier;
	readonly to: FlauzPlanTier;
	readonly record: PlanSemanticsRecord;
}

export interface TierTransitionRejected {
	readonly transitioned: false;
	readonly reason: TierTransitionRejectionReason;
	readonly detail: string;
}

export type TierTransitionOutcome = TierTransitionApplied | TierTransitionRejected;

/**
 * Pure transition: move an honest record to a new tier by
 * re-deriving the target tier's canonical semantics over the SAME
 * planId (plan identity is preserved; minting a new plan id is the
 * caller's own construction, never this transition). The input
 * record must pass the honest-promise guard (fail closed).
 * Deterministic; never mutates the input.
 */
export function transitionPlanSemantics(record: unknown, toTier: FlauzPlanTier): TierTransitionOutcome {
	const admission = admitHonestPromise(record);
	if (!admission.honest) {
		return {
			transitioned: false,
			reason: 'invalid-record',
			detail: `the input record must satisfy the honest-promise guard: '${admission.reason}': ${admission.detail}`,
		};
	}
	const fromTier = admission.record.tier;
	if (fromTier === toTier) {
		return {
			transitioned: false,
			reason: 'same-tier',
			detail: `a tier transition must change the tier; from and to are both '${fromTier}'`,
		};
	}
	if (!isFlauzPlanTier(toTier)) {
		return {
			transitioned: false,
			reason: 'unknown-tier',
			detail: `tier must be one of free/provisioned/self-hosted, got '${String(toTier)}'`,
		};
	}
	if (!canTransitionPlanTier(fromTier, toTier)) {
		return {
			transitioned: false,
			reason: 'transition-not-allowed',
			detail: `the '${fromTier}' -> '${toTier}' move is not in the tier-transition whitelist`,
		};
	}
	return {
		transitioned: true,
		from: fromTier,
		to: toTier,
		record: planSemanticsForTier(toTier, admission.record.planId),
	};
}

/**
 * Canonical serialization of a plan-semantic record: fixed key
 * order, deterministic bytes independent of the input record's key
 * insertion order. Refuses dishonest records (fail closed: no
 * dishonest record ever gets canonical bytes). This canonical form
 * is the persistence/audit shape for the INF-002..009 binders.
 */
export function serializePlanSemanticsRecord(record: unknown): string {
	const admission = admitHonestPromise(record);
	if (!admission.honest) {
		throw new Error(
			`serializePlanSemanticsRecord: dishonest record rejected '${admission.reason}': ${admission.detail}`,
		);
	}
	const honest = admission.record;
	return JSON.stringify({
		planId: honest.planId,
		contractVersion: honest.contractVersion,
		tier: honest.tier,
		productPromise: {
			promiseSide: honest.productPromise.promiseSide,
			subject: honest.productPromise.subject,
			guarantee: honest.productPromise.guarantee,
		},
		providerCapacityClaim: {
			promiseSide: honest.providerCapacityClaim.promiseSide,
			subject: honest.providerCapacityClaim.subject,
			guarantee: honest.providerCapacityClaim.guarantee,
			capacityProvenance: honest.providerCapacityClaim.capacityProvenance,
		},
	});
}

function isFlauzProductGuarantee(value: unknown): value is FlauzProductGuarantee {
	return (FLAUZ_PRODUCT_GUARANTEES as readonly string[]).includes(value as string);
}

function isProviderCapacityGuarantee(value: unknown): value is ProviderCapacityGuarantee {
	return (PROVIDER_CAPACITY_GUARANTEES as readonly string[]).includes(value as string);
}

function isCapacityProvenance(value: unknown): value is CapacityProvenance {
	return (CAPACITY_PROVENANCES as readonly string[]).includes(value as string);
}

function reject(reason: HonestPromiseRejectionReason, detail: string): DishonestPromise {
	return { honest: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
