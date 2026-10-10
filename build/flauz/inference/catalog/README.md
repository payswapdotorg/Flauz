# Flauz inference provider catalog + capability matrix contracts (INF-002, Free Inference Fabric)

Typed contract set for the Free Inference Fabric catalog family:
who can serve inference (the typed provider catalog - provider
classes, honest plan claims, disclosed capacity states, honest
verification/term defaults) and which models each provider offers
with which bounded capabilities (the typed capability matrix -
inclusive context windows, output caps, closed modality
vocabulary, no dangling provider references). Like the landed
INF-001 semantics family, this family is PURE VOCABULARY over
injected values: no runtime, no router, no engine, no scheduler,
no key pool, no network, no storage, no credentials - and no
matching engine (INF-006's item, a binding scope boundary).

Contract set version: `INFERENCE_CATALOG_VERSION = '1.0.0'` (this
family's own constant, declared once in
`common/providerCatalog.ts`, carried by `common/capabilityMatrix.ts`
via re-export, and pinned equal by the test suite - the family's
single version authority). The vocabulary INSIDE the records is the
landed INF-001 semantics family's, bound verbatim and never
re-implemented: provider classes are `CapacityProvenance` members,
plan claims are `PlanSemanticsRecord`s admitted by the landed
honest-promise guard, and capacity snapshots are
`ProviderCapacitySnapshot`s. Those sub-records keep the semantics
family's own `INFERENCE_SEMANTICS_CONTRACTS_VERSION = '1.0.0'`
stamp; the catalog stamp and the semantics stamp are distinct roles
(the suite pins both).

## Module index

- `common/providerCatalog.ts` - the typed provider catalog:
  `PROVIDER_TERM_STATES` (the closed unknown/permitted/prohibited
  vocabulary; 'unknown' is the DEFAULT - permission is never
  silently assumed), `ProviderCatalogEntry` /
  `ProviderCatalogRecord`, `admitCatalogEntry` (the fail-closed
  entry guard: dishonest plan claims are rejected THROUGH
  `admitHonestPromise`'s own reasons, cited verbatim; unknown
  provider classes rejected; a snapshot without provenance
  rejected; honest-state defaults applied when absent),
  `admitCatalogRecord` (entry-id uniqueness - a duplicate entryId
  is a typed rejection, never a silent overwrite),
  `catalogIndexById` (the pure frozen lookup-map derivation),
  `markEntryMetadataVerified` (the ONE-WAY 'unverified' ->
  'verified' promotion, mirroring the semantics family's
  `markProvenanceVerified`), `unknownCapacityEntry` (the honest
  default entry constructor riding `unknownSnapshot`),
  `serializeCatalogEntry` / `serializeCatalogRecord` (canonical
  deterministic bytes, fixed key order),
  `isProviderCatalogEntry` / `isProviderCatalogRecord` (shape
  guards), `INFERENCE_CATALOG_VERSION`.
- `common/capabilityMatrix.ts` - the typed capability matrix:
  `MODEL_MODALITIES` (the closed modality vocabulary: text-in /
  text-out / image-in / tool-call), `ContextWindow` (inclusive
  token bounds), `CapabilityDescriptor` /
  `CapabilityMatrixRecord`, `admitCapabilityDescriptor` (the
  fail-closed descriptor guard: zero/negative/non-integer token
  bounds rejected, inverted windows rejected, an output cap
  outside the window rejected, unknown modalities rejected),
  `admitCapabilityMatrix(candidate, catalog)` (the record guard
  binding a catalog: (providerEntryId, modelId) uniqueness + THE
  NO-DANGLING-REF LAW - every descriptor's provider must resolve
  in the bound catalog or the admission is a typed rejection),
  `contextWindowContains` (the pure INCLUSIVE boundary predicate:
  both window endpoints admit, both off-by-one directions reject),
  `serializeCapabilityMatrixRecord` (canonical deterministic
  bytes), `isCapabilityDescriptor` / `isCapabilityMatrixRecord`
  (shape guards).
- `test/common/providerCatalog.test.ts` - mocha tdd suite: every
  admission rejection path, every honest-state default, the one-way
  promotion (both directions), entry-id uniqueness, the pure index
  derivation, byte-determinism, version stamping, shape guards,
  the promise-split rejection surfacing the landed guard's own
  reasons verbatim (fixture evidence).
- `test/common/capabilityMatrix.test.ts` - mocha tdd suite: every
  descriptor and matrix rejection path (uniqueness + dangling
  provider refs), inclusive boundary math (both endpoints, both
  off-by-one directions), byte-determinism, version stamping,
  shape guards (fixture evidence).
- `tsconfig.json` - the scoped strict noEmit shape copied from the
  semantics family (ES2022, NodeNext, verbatimModuleSyntax, types
  node+mocha).

Evidence label: `fixture` (both suites run on synthetic
`fixture.`-prefixed ids and synthetic epoch constants only; no
authority values, no real providers, models, endpoints or keys, no
network, no storage, no credentials).

Owner item: INF-002 (TL-B, B2 lane - capability exchange +
inference fabric).

## Laws

Inherited from the semantics family (binding, unchanged):

- THE PROMISE-SPLIT LAW: every catalog plan claim passes the
  landed `admitHonestPromise` guard. The 'unlimited provider
  tokens' lie is unrepresentable in the semantics vocabulary AND
  runtime-rejected at catalog boundaries with the semantics
  family's own rejection reasons, surfaced verbatim
  (`'unlimited-provider-capacity'`, `'invalid-provider-claim'`)
  - cited, never re-worded.
- HONEST STATES ARE DEFAULTS (the unverified-default law):
  `metadataVerification` defaults `'unverified'`, `termsState`
  defaults `'unknown'` (never silently assume permission - INF-007
  later builds the eligibility guards over this state), capacity
  defaults ride `unknownSnapshot`. Never silent nulls, never
  guessed states; a present-but-invalid state is a typed rejection,
  never a silent coercion.
- No hidden provider/model substitution: the semantics family owns
  the provenance contract; catalog entries and matrix descriptors
  never substitute providers or models themselves.
- Free capacity is provider-dependent and must remain honest and
  observable: unknown/unverified are first-class typed states.
- NO SHARED PUBLIC GATEWAY: nothing in this family models or
  permits a public Flauz gateway pooling third-party free-tier
  provider keys; third-party-free-tier entries are disclosed
  capacity, never a Flauz guarantee.
- Determinism: no clock reads and no randomness inside
  `common/**`; all timestamps are injected epoch-ms numbers and all
  ids are injected strings. Boundary math is inclusive;
  serialization is canonical with fixed key order.
- Vocabulary only: no runtime, no router, no engine, no scheduler,
  no key pool, no network, no storage, no credentials, no second
  authority.
- Every persisted record carries `contractVersion`.

New in this family:

- ENTRY-ID UNIQUENESS: a catalog entry id is unique inside a
  record; `admitCatalogRecord` rejects a duplicate as a typed
  rejection (`'duplicate-entry-id'`), never a silent overwrite.
- (MODEL, PROVIDER) UNIQUENESS: a capability-matrix model offering
  is unique per provider entry; a duplicate
  (providerEntryId, modelId) pair is a typed rejection
  (`'duplicate-model-provider-pair'`), never a silent overwrite.
  The same modelId under different providers, and different models
  under the same provider, are both honest and admitted.
- THE NO-DANGLING-REF LAW: every matrix descriptor's
  `providerEntryId` resolves in the bound catalog record.
  `admitCapabilityMatrix` rejects a dangling reference
  (`'unknown-provider-entry'`) - a matrix referencing a provider
  the catalog does not carry never enters the record.
- ONE-WAY PROMOTIONS: `markEntryMetadataVerified` promotes
  'unverified' -> 'verified' (mirroring
  `markProvenanceVerified`); an already-verified entry stays
  verified and there is deliberately NO demotion - a stale
  verification must be re-derived from a fresh record.
- BOUNDED CAPABILITIES ARE HONEST: token bounds are positive
  integers, context windows are INCLUSIVE on both ends, and
  `maxOutputTokens` must live inside the window (an output cap the
  window cannot contain is unrepresentable). Modalities form a
  closed set; the admitted record carries them as a canonical
  ordered set (insertion order is not semantic).
- THE INF-006 SCOPE BOUNDARY: this family delivers descriptors,
  guards, the inclusive boundary predicate and serialization ONLY.
  The requirement -> provider/model MATCHING ENGINE (ranking,
  scoring, selection, substitution) is INF-006's item; nothing
  here does any of it.

## Modality-set reasoning (the closed four)

`text-in | text-out | image-in | tool-call` is the minimal honest
modality set for an inference fabric serving a coding assistant:
text in (prompts/code), text out (completions), image in (vision
input), tool-call (structured function invocation). Generation
modalities (image-out, audio, video) are out of scope for this
contract version; widening the set is a contract change requiring
a version bump. The empty modality subset is admitted as the
honest 'no modalities declared' state - a modality-less descriptor
is data; what to do with it is the INF-006 matcher's decision,
never silently guessed here.

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values. No
authority seam needs transcription before the gates run; both
suites are green as shipped.

## Future binder note (INF-003..009)

Updated from the semantics family's binder note: each binder now
consumes the catalog surfaces listed here IN ADDITION to the
semantics surfaces it already binds
(`build/flauz/inference/semantics/README.md`).

- INF-003 (per-user/direct provider adapters): consumes the
  semantics capacityDisclosure vocabulary (the quota/cooldown/
  reset/provenance states the adapters report; timestamps injected
  by the adapter runtime) plus the catalog
  `ProviderCatalogEntry` shape and `admitCatalogEntry` (the
  admission an adapter-registered entry must pass) and
  `PROVIDER_TERM_STATES` (the term state an adapter observes).
- INF-004 (optional per-user/local FreeLLMAPI-compatible
  sidecar/adapter): consumes the semantics snapshot + provenance
  vocabulary (the sidecar is replaceable technology, never an
  authority) plus the catalog entry vocabulary for the sidecar's
  advertised entry (`providerClass: 'user-owned-endpoint'`,
  `unknownCapacityEntry` as the honest starting state).
- INF-005 (health/quota/cooldown/retry/failover routing): consumes
  the semantics health/quota/cooldown vocabulary and inclusive
  boundary math plus the catalog `ProviderCatalogRecord` /
  `catalogIndexById` (the pure provider lookup a failover walk
  iterates) and the entry capacity snapshots (the observed state
  the router reads - disclosed, never guaranteed).
- INF-006 (context-window/capability matching): consumes the
  semantics provenance of the selected provider/model (match
  decisions are disclosed, never silently substituted) plus THIS
  family's capability matrix surfaces - `MODEL_MODALITIES`,
  `CapabilityDescriptor`, `contextWindowContains`,
  `admitCapabilityMatrix`'s no-dangling-ref binding. The matching
  engine itself is INF-006's item; this family delivers the
  descriptor vocabulary it matches over.
- INF-007 (credential isolation and provider-term eligibility):
  consumes the semantics capacityProvenance vocabulary and
  provider-metadata verification states plus the catalog
  `PROVIDER_TERM_STATES` / `termsState` (the eligibility guards
  build over the honest 'unknown' default - permission is never
  assumed) and `markEntryMetadataVerified` (the one-way promotion
  the eligibility receipt rides).
- INF-008 (provenance/capacity/reset UI): consumes the semantics
  disclosure projection as the primary binder plus the catalog
  `serializeCatalogEntry` / `serializeCatalogRecord` /
  `serializeCapabilityMatrixRecord` canonical bytes (the
  persistence/audit shapes the UI renders) and the entry
  `displayName` / honest-state fields (what a user is shown).
- INF-009 (live-provider acceptance and failure drills): consumes
  both semantics modules (the honest-promise guard + the
  disclosure projection as the acceptance vocabulary) plus both
  catalog modules (the admission guards as the acceptance
  vocabulary for catalog-shaped evidence; evidence labels upgrade
  there - `fixture` here proves vocabulary behavior only).

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - see
`build/flauz/dogfood/README.md`; pins: typescript 5.9.x, mocha@11,
the tsx loader - NodeNext `.js`-specifier suites need the loader;
plain `node --experimental-strip-types` does not remap `.js`
specifiers to `.ts` sources on node 24.x):

        ~/toolchain/node_modules/.bin/tsc -p build/flauz/inference/catalog/tsconfig.json \
                --typeRoots ~/toolchain/node_modules/@types
        NODE_OPTIONS="--import file://$HOME/toolchain/node_modules/tsx/dist/loader.mjs" \
                node ~/toolchain/node_modules/.bin/_mocha --ui tdd \
                build/flauz/inference/catalog/test/common/providerCatalog.test.ts
        NODE_OPTIONS="--import file://$HOME/toolchain/node_modules/tsx/dist/loader.mjs" \
                node ~/toolchain/node_modules/.bin/_mocha --ui tdd \
                build/flauz/inference/catalog/test/common/capabilityMatrix.test.ts
        grep -nE 'Date\.now|Math\.random|new Date\(' build/flauz/inference/catalog/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist.
