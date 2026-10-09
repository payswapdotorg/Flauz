# Flauz inference semantics contracts (INF-001, Free Inference Fabric)

Typed contract set for the Free Inference Fabric semantics: the
Free-plan promise split (unlimited Flauz usage, never unlimited
provider tokens), the typed plan tiers, the fail-closed
honest-promise guard, and the per-provider capacity disclosure
vocabulary (health, quota, cooldown, reset, mandatory provenance).

Contract set version: `INFERENCE_SEMANTICS_CONTRACTS_VERSION = '1.0.0'`,
carried by every module and stamped on every persisted record (both
module copies of the constant are pinned equal by the test suite -
the COMMAND_FACADE zero-dependency idiom).

## Module index

- `common/planSemantics.ts` - the Free-plan promise semantics:
  `FlauzSidePromise` vs `ProviderCapacityClaim` (THE PROMISE-SPLIT
  LAW, binding), the closed tier set `FLAUZ_PLAN_TIERS`
  (free/provisioned/self-hosted), `PLAN_TIER_SEMANTICS` and
  `PLAN_TIER_TRANSITIONS` (the frozen tier tables),
  `planSemanticsForTier` (pure derivation),
  `admitHonestPromise` / `assertHonestPromise` /
  `isPlanSemanticsRecord` (the fail-closed honest-promise guard:
  the 'unlimited provider tokens' lie is unrepresentable in the
  types AND rejected at runtime boundaries),
  `transitionPlanSemantics` / `canTransitionPlanTier` (typed tier
  transitions), `serializePlanSemanticsRecord` (canonical
  deterministic bytes), `INFERENCE_SEMANTICS_CONTRACTS_VERSION`.
- `common/capacityDisclosure.ts` - the typed capacity disclosure
  contract: `ProviderCapacitySnapshot` (health, quota, cooldown,
  reset-schedule vocabulary; 'unknown'/'unverified' are first-class
  typed states, never silent nulls), `InferenceProvenance` (the
  MANDATORY provenance of the selected provider/model - no hidden
  substitution), `admitProvenance` (fail-closed provenance guard:
  hidden substitution rejected), `projectCapacityDisclosure` (the
  pure user-facing disclosure projection with a deterministic
  capacity-state precedence), `quotaWindowContains` /
  `nextResetAt` / `cooldownActive` (inclusive-boundary math, all
  timestamps injected), `unknownSnapshot` /
  `unverifiedProvenance` (the honest defaults - the
  unverified-default law), `markProvenanceVerified` (the one-way
  verification promotion), `isProviderCapacitySnapshot` /
  `isProviderCapacityDisclosure` (shape guards),
  `serializeCapacityDisclosure` (canonical deterministic bytes),
  `INFERENCE_SEMANTICS_CONTRACTS_VERSION`.
- `test/common/planSemantics.test.ts` - mocha tdd suite: every
  honest-promise guard rejection path, every tier state and
  transition, canonical-byte determinism, version stamping
  (fixture evidence).
- `test/common/capacityDisclosure.test.ts` - mocha tdd suite:
  every typed state and transition, inclusive reset-window and
  cooldown boundary math, the unverified-default law, every
  capacity-state projection branch, every provenance/projection
  rejection path, byte-determinism (fixture evidence).

Evidence label: `fixture` (both suites run on synthetic
`fixture.`-prefixed ids and synthetic epoch constants only; no
authority values, no real providers or models, no network, no
storage, no credentials).

Owner item: INF-001 (TL-B, B2 lane - capability exchange +
inference fabric).

## Laws

- THE PROMISE-SPLIT LAW: the user-facing Free plan promise is
  `unlimited Flauz usage` (the product-experience guarantee,
  Flauz-side), never `unlimited provider tokens` (provider
  capacity is always provider-dependent, provider-side). The two
  sides are distinct types; conflating records are rejected, and
  the lie is unrepresentable in the provider-side vocabulary.
- No hidden provider/model substitution: every disclosure carries
  the provenance of the selected provider/model; a differing actual
  selection must be labeled disclosed, else it is rejected.
- Free capacity is provider-dependent and must remain honest and
  observable: unknown/unverified are first-class typed states, the
  defaults, never silent nulls.
- No shared public Flauz gateway pooling third-party free-tier
  provider keys is modeled or permitted by these contracts;
  third-party-free-tier capacity is disclosed capacity, never a
  Flauz guarantee.
- Determinism: no clock reads and no randomness inside
  `common/**`; all timestamps are injected epoch-ms numbers and all
  ids are injected strings. Boundary math is inclusive.
- Vocabulary only: this family DEFINES vocabulary - it is not a
  runtime, not an engine, not a scheduler, not a router, not a key
  pool, not a second authority.
- Every persisted record carries `contractVersion`.

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values. No
authority seam needs transcription before the gates run; both
suites are green as shipped.

## Future binder note (INF-002..009)

- INF-002 (provider catalog/capability matrix): consumes
  `common/planSemantics.ts` (tier semantics + the honest-promise
  guard for catalog-facing plan claims) and
  `common/capacityDisclosure.ts` (the snapshot/disclosure
  vocabulary for catalog entries).
- INF-003 (per-user/direct provider adapters): consume
  `common/capacityDisclosure.ts` (the quota/cooldown/reset/
  provenance states the adapters report; timestamps injected by the
  adapter runtime).
- INF-004 (optional per-user/local FreeLLMAPI-compatible
  sidecar/adapter): consumes `common/capacityDisclosure.ts` (the
  snapshot + provenance vocabulary; the sidecar is replaceable
  technology, never an authority).
- INF-005 (health/quota/cooldown/retry/failover routing):
  consumes `common/capacityDisclosure.ts` (health/quota/cooldown
  vocabulary, inclusive boundary math, the disclosure projection);
  the router itself lives elsewhere - this family stays
  vocabulary-only.
- INF-006 (context-window/capability matching): consumes
  `common/capacityDisclosure.ts` (the provenance of the selected
  provider/model - match decisions are disclosed, never silently
  substituted).
- INF-007 (credential isolation and provider-term eligibility):
  consumes `common/planSemantics.ts` (the capacityProvenance
  vocabulary: third-party-free-tier vs flauz-provisioned vs
  user-owned-endpoint) and `common/capacityDisclosure.ts` (the
  provider-metadata verification states).
- INF-008 (provenance/capacity/reset UI): consumes
  `common/capacityDisclosure.ts` as the primary binder - the
  disclosure projection types, reset expectations and mandatory
  provenance are exactly the user-facing shapes.
- INF-009 (live-provider acceptance and failure drills): consumes
  both modules (the honest-promise guard + the disclosure
  projection as the acceptance vocabulary; evidence labels upgrade
  there - `fixture` here proves vocabulary behavior only).

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - see
`build/flauz/dogfood/README.md`; pins: typescript 5.9.3, mocha@11,
the tsx loader):

	npx tsc -p build/flauz/inference/semantics/tsconfig.json
	NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/inference/semantics/test/common/*.test.ts
	grep -nE 'Date\.now|Math\.random|process\.env' build/flauz/inference/semantics/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist.

## Tier-set reasoning (the minimal honest set)

`free | provisioned | self-hosted` is the minimal tier set that can
be defended honestly. The Flauz-side product promise is unlimited
product usage on every tier (that is the product guarantee, and the
only place 'unlimited' is ever legal). The tiers differ ONLY in
capacity provenance - where the provider-side capacity actually
comes from: third-party permitted free-tier capacity, Flauz-
provisioned capacity, or the user's own endpoint. Collapsing the
set further would hide a capacity-provenance difference the user is
entitled to see; widening it (e.g. paid token-metered tiers) is a
product decision that belongs to a future, separately versioned
contract set - `FLAUZ_PRODUCT_GUARANTEES` already admits 'metered'
records so such a future set does not need to break this one.
