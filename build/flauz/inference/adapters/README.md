# Flauz inference per-user/direct provider adapter contracts (INF-003, Free Inference Fabric)

Typed contract set for the Free Inference Fabric adapter family -
the third family: the typed per-user/direct **provider adapter
contracts**, the vocabulary a per-user adapter uses to REPORT what it
observes about a provider (quota, cooldown, reset, provenance)
through the capacity-disclosure vocabulary, with every timestamp
INJECTED by the adapter runtime. Like the landed INF-001 semantics
family and INF-002 catalog family, this family is PURE VOCABULARY
over injected values: no network, no fetch, no real credentials, no
credential storage, no runtime loop, no router, no retry engine, no
failover engine (INF-005's items), no sidecar (INF-004's item - this
family delivers the transport-SHAPE vocabulary only), no credential
isolation (INF-007's item), no second authority, and no shared
public Flauz gateway pooling third-party free-tier keys.

Contract set version: `INFERENCE_ADAPTER_VERSION = '1.0.0'` (this
family's own constant, declared once in
`common/providerAdapter.ts`, carried by every adapter-family
persisted record and pinned by the test suite). The vocabulary
INSIDE the records is the landed families', bound verbatim and never
re-implemented: capacity snapshots are `ProviderCapacitySnapshot`s,
provenance is `InferenceProvenance` (both INF-001 semantics,
admitted by the landed guards), and the bound catalog is a
`ProviderCatalogRecord` (INF-002, admitted by the landed
`admitCatalogRecord`, resolved through the landed
`catalogIndexById`). Those sub-records keep their own family version
stamps (`INFERENCE_SEMANTICS_CONTRACTS_VERSION` /
`INFERENCE_CATALOG_VERSION`); the adapter stamp and the
semantics/catalog stamps are distinct roles (the suite pins all
three).

## Module index

- `common/providerAdapter.ts` - the typed per-user/direct adapter
  contracts: `ADAPTER_TRANSPORT_KINDS` (the closed frozen transport
  vocabulary - transport SHAPES, never endpoints, never URLs, never
  credentials: `http-openai-compatible`, `http-anthropic-compatible`,
  `http-generic-json`, `local-sidecar`), `ProviderAdapterDescriptor`
  (the per-adapter persistence shape binding a catalog entry through
  `providerEntryId`), `admitProviderAdapter` (the FAIL-CLOSED
  descriptor guard: unknown transport kinds rejected; a
  `'flauz-provisioned'` capacity provenance REJECTED with the
  dedicated `'flauz-provisioned-adapter'` reason - the
  direct-adapter law; non-string/empty ids rejected; a
  credentialHandle carrying secret-looking material REJECTED - the
  conservative shape rule documented below),
  `ProviderAdapterRecord` / `admitProviderAdapterRecord`
  (ADAPTER-ID UNIQUENESS + THE NO-DANGLING-REF LAW EXTENDED: every
  adapter's `providerEntryId` must resolve in the bound catalog
  record or the admission is a typed rejection, never a silent
  dangling ref; the catalog family's own rejection reasons surface
  verbatim, cited, never re-worded), `AdapterObservation` (the
  injected observation input - ALL fields required, the caller
  injects everything, the contract never reads a clock),
  `reportAdapterSnapshot` (the PURE report fold: builds the
  `ProviderCapacitySnapshot` from the injected observation riding
  `unknownSnapshot` defaults where the observation is honestly
  unknown; carries the adapter's provenance through an
  `unverifiedProvenance`-shaped input unless the caller supplies a
  verified `InferenceProvenance` record, which is carried verbatim -
  NEVER fabricates verification; a misattributed provenance is
  fail-closed), `markReportVerified` (the ONE-WAY 'unverified' ->
  'verified' promotion riding the landed `markProvenanceVerified`),
  `serializeAdapterReport` (canonical deterministic bytes, fixed key
  order), `isProviderAdapterDescriptor` / `isProviderAdapterRecord`
  / `isAdapterHealthReport` (shape guards),
  `INFERENCE_ADAPTER_VERSION`.
- `test/common/providerAdapter.test.ts` - mocha tdd suite: every
  `admitProviderAdapter` rejection path, the direct-adapter law
  (also per transport kind - no provisioning escape hatch), the
  credential-handle shape guard in both directions (the 40-character
  boundary inclusive both ways, the `=`/`:`/`/` delimiter rule,
  honest handles admitted verbatim), adapter-id uniqueness
  (position-independent, content-independent), the no-dangling-ref
  catalog binding in both directions (resolving and dangling, plus
  the invalid-catalog cross-family citation), the report fold over
  every honest-unknown combination (16 known/unknown combos + the
  all-unknown deep-equal against `unknownSnapshot`), the
  never-fabricate-verification law (unverified default, verified
  carried verbatim, only the one-way promotion flips), canonical
  byte-determinism (double fold, key-insertion-order independence,
  every difference changes the bytes), version stamping (all three
  stamps), shape guards, and in-suite determinism greps over the
  common module source (law comments only).
- `tsconfig.json` - the scoped strict noEmit shape copied verbatim
  from the catalog family (ES2022, NodeNext, verbatimModuleSyntax,
  types node+mocha).

Evidence label: `fixture` (the suite runs on synthetic
`fixture.`-prefixed ids and synthetic epoch constants only; no
authority values, no real providers, models, endpoints, URLs or
keys, no network, no storage, no credentials).

Owner item: INF-003 (TL-B, B2 lane - capability exchange +
inference fabric).

## Laws

Inherited from the semantics and catalog families (binding,
unchanged):

- THE PROMISE-SPLIT LAW and the honest-promise guard: the adapter
  vocabulary never speaks for provider capacity beyond what the
  landed semantics vocabulary permits; capacity is always
  provider-dependent and disclosed, never guaranteed.
- HONEST STATES ARE DEFAULTS (the unverified-default law): unknown
  health/quota/cooldown/reset ride the disclosure vocabulary's own
  honest states through `unknownSnapshot` - never silent nulls,
  never guessed states. A missing or malformed observation field is
  a fail-closed TypeError, never a silent default.
- THE NO-HIDDEN-SUBSTITUTION LAW: the report fold's provenance rides
  the landed `unverifiedProvenance` / `admitProvenance` guards; a
  differing actual selection is labeled 'disclosed' at construction,
  and a hidden substitution in a caller-supplied provenance record
  is a fail-closed rejection, never silently repaired.
- NO SHARED PUBLIC GATEWAY: nothing in this family models or
  permits a public Flauz gateway pooling third-party free-tier
  provider keys; third-party-free-tier adapter capacity is disclosed
  capacity, never a Flauz guarantee.
- Determinism: no clock reads and no randomness inside `common/**`;
  all timestamps are injected epoch-ms numbers and all ids are
  injected strings. Serialization is canonical with fixed key order.
- Vocabulary only: no runtime, no router, no engine, no scheduler,
  no key pool, no network, no storage, no credentials, no second
  authority.
- Every persisted record carries `contractVersion`; the adapter
  stamp and the semantics/catalog stamps are distinct roles.

New in this family:

- THE DIRECT-ADAPTER LAW: a per-user/direct adapter never carries
  the `'flauz-provisioned'` capacity provenance - Flauz does not
  provision what it does not own. `admitProviderAdapter` rejects it
  with the dedicated typed reason `'flauz-provisioned-adapter'`,
  never a silent admission, and the law holds for every transport
  kind (no escape hatch).
- CREDENTIAL REFERENCES ONLY: `credentialHandle` names WHERE an
  isolated runtime would look a credential up - an opaque typed
  reference, never a secret value, never embedded material. The
  admission guard applies the conservative shape rule below; it is
  vocabulary-level honesty, NOT a security boundary - INF-007 owns
  the real credential isolation (binding scope boundary).
- THE ADAPTER-RUNTIME INJECTION LAW: the contract never reads a
  clock - every timestamp is a caller-injected epoch-ms number
  (`AdapterObservation.observedAtEpochMs` on the fold, the
  provenance's `recordedAtEpochMs` on the provenance input). No
  `Date.now`, no `Math.random`, no `new Date(`, no `process.env` in
  `common/**` (law comments excepted; the suite greps the source and
  pins it).
- THE NO-DANGLING-REF LAW, EXTENDED: every adapter's
  `providerEntryId` resolves in the bound catalog record.
  `admitProviderAdapterRecord` rejects a dangling reference
  (`'unknown-provider-entry'`) - an adapter set referencing a
  provider the catalog does not carry never enters the record. The
  bound catalog must itself satisfy the landed `admitCatalogRecord`
  (its own rejection reasons surface verbatim in the detail, cited,
  never re-worded).
- ADAPTER-ID UNIQUENESS: an adapter id is unique inside an adapter
  set record; a duplicate is a typed rejection
  (`'duplicate-adapter-id'`), never a silent overwrite. Two
  adapters MAY bind the same provider entry (uniqueness is on
  adapter id, not on entry id).
- NEVER FABRICATE VERIFICATION: an unverified adapter reports
  unverified. The report fold derives its provenance through the
  landed `unverifiedProvenance` constructor ('unverified' by
  construction) unless the caller supplies a verified
  `InferenceProvenance` record - which is carried verbatim, never
  re-stamped, never demoted. Only the ONE-WAY `markReportVerified`
  promotion (riding the landed `markProvenanceVerified`) flips a
  report to verified; there is deliberately NO demotion - a stale
  verification must be re-derived from a fresh report. The
  snapshot's verification state rides the injected provenance's
  verification: the caller's receipt is the only fold-time source of
  `'verified'`.
- NO DANGLING ATTRIBUTION: the report's provenance actual provider
  must name the adapter's provider entry; a misattributed capacity
  report is a fail-closed TypeError (mirroring the semantics
  family's provider-mismatch law), and `isAdapterHealthReport`
  rejects a report whose provenance names a different actual
  provider than its snapshot. One observation, one time: the
  report's `observedAtEpochMs` and its snapshot's must agree.

## The transport-kind vocabulary (the closed four)

`http-openai-compatible | http-anthropic-compatible |
http-generic-json | local-sidecar` is the minimal honest transport
vocabulary for per-user/direct adapters: the first two name the
OpenAI- and Anthropic-compatible JSON-over-HTTP dialect SHAPES, the
third names a generic JSON-over-HTTP shape (no named dialect), and
the fourth names a local sidecar process shape (the shape INF-004's
optional FreeLLMAPI-compatible sidecar rides). These are transport
SHAPES, never endpoints, never URLs, never credentials - the suite
pins structurally that no kind carries a URL scheme, a port or key
delimiter, a userinfo shape, secret material or whitespace. Widening
the set is a contract change requiring a version bump. INF-004 owns
the sidecar itself; this family delivers the shape vocabulary only
(binding scope boundary).

## The credential-handle shape rule (the exact conservative check)

`admitProviderAdapter` rejects a `credentialHandle` that:

1. is not a string, is empty, or is whitespace-only (reason
   `'invalid-credential-handle'` - a whitespace-only handle is not
   a reference);
2. has any whitespace-separated run longer than 40 characters, or
   contains any of the characters `'='`, `':'` or `'/'` (reason
   `'secret-bearing-credential-handle'` - the characteristic shapes
   of key material: long high-entropy runs, base64 payloads,
   key:value secret pairs, URLs/paths; a plain identifier carries
   none of them).

The boundary is inclusive both ways: a 40-character run is admitted,
a 41-character run is rejected; the run-length rule is per
whitespace-separated run, not per handle. The rule is deliberately
CONSERVATIVE - it catches the obvious secret-looking shapes only
(short opaque material without delimiters passes, and the suite
documents that honestly). This is a vocabulary-level honesty check,
not a security boundary: INF-007 owns the real credential isolation
guards and they are a binding scope boundary here.

## The report fold's provenance input

`reportAdapterSnapshot(adapter, observation, provenance)` takes the
provenance as an explicit caller-injected input (the adapter runtime
knows the requested/actual selection; the fold never invents model
ids). The input is either:

- an `unverifiedProvenance`-shaped input (the honest default): the
  raw requested/actual provider+model selection plus an injected
  `recordedAtEpochMs`, folded through the landed
  `unverifiedProvenance` constructor - `'unverified'` by
  construction, with the substitution label derived honestly; or
- a full `InferenceProvenance` record the caller supplies: if it
  satisfies the landed `admitProvenance` it is carried VERBATIM (a
  verified one never demoted, an unverified one never stamped up);
  if it is provenance-record-shaped but FAILS that guard, the fold
  is a fail-closed TypeError - a hidden substitution is never
  silently repaired by re-derivation.

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values. No
authority seam needs transcription before the gates run; the suite
is green as shipped.

## Future binder note (INF-004..009)

Updated from the catalog family's binder note: each binder now
consumes the ADAPTER surfaces listed here IN ADDITION to the
semantics surfaces (`build/flauz/inference/semantics/README.md`)
and the catalog surfaces (`build/flauz/inference/catalog/README.md`)
it already binds.

- INF-004 (optional per-user/local FreeLLMAPI-compatible
  sidecar/adapter): consumes the semantics snapshot + provenance
  vocabulary (the sidecar is replaceable technology, never an
  authority) plus the catalog entry vocabulary for the sidecar's
  advertised entry (`unknownCapacityEntry` as the honest starting
  state) plus THIS family's `ADAPTER_TRANSPORT_KINDS` (the
  `'local-sidecar'` and HTTP dialect shapes the sidecar speaks -
  shapes only, the sidecar itself is INF-004's item),
  `ProviderAdapterDescriptor` / `admitProviderAdapter` (the
  admission a sidecar-registered adapter must pass) and
  `reportAdapterSnapshot` (the fold the sidecar's own capacity
  reports ride).
- INF-005 (health/quota/cooldown/retry/failover routing): consumes
  the semantics health/quota/cooldown vocabulary and inclusive
  boundary math plus the catalog `ProviderCatalogRecord` /
  `catalogIndexById` plus THIS family's
  `ProviderAdapterHealthReport` and `reportAdapterSnapshot` folds
  (the observed state the router reads - disclosed, never
  guaranteed) and `markReportVerified` receipts (the verification
  state a routing decision may cite). The router, retry loop and
  failover engine are INF-005's items; this family delivers the
  report fold only.
- INF-006 (context-window/capability matching): consumes the
  semantics provenance of the selected provider/model plus the
  catalog capability matrix surfaces plus THIS family's report
  provenance (match decisions are disclosed, never silently
  substituted) and the descriptor `providerEntryId` binding (the
  entry whose matrix the matcher walks). The matching engine itself
  is INF-006's item.
- INF-007 (credential isolation and provider-term eligibility):
  consumes the semantics capacityProvenance vocabulary and
  provider-metadata verification states plus the catalog
  `PROVIDER_TERM_STATES` / `termsState` / `markEntryMetadataVerified`
  plus THIS family's `credentialHandle` typed reference (the opaque
  id the isolation runtime resolves - never the material itself),
  the direct-adapter law's capacityProvenance restriction (the
  eligibility guard's provenance precondition) and the
  `'secret-bearing-credential-handle'` admission reason (the
  vocabulary-level pre-check the real isolation guards build over).
- INF-008 (provenance/capacity/reset UI): consumes the semantics
  disclosure projection as the primary binder plus the catalog
  canonical bytes and entry display fields plus THIS family's
  `serializeAdapterReport` canonical bytes (the adapter-report
  persistence/audit shape the UI renders) and the report's snapshot
  + provenance honest states (what a user is shown for their own
  adapters).
- INF-009 (live-provider acceptance and failure drills): consumes
  both semantics modules (the honest-promise guard + the disclosure
  projection as the acceptance vocabulary) plus both catalog modules
  (the admission guards as the acceptance vocabulary for
  catalog-shaped evidence) plus THIS family's
  `admitProviderAdapter` / `admitProviderAdapterRecord` /
  `isAdapterHealthReport` guards (the acceptance vocabulary for
  adapter-shaped evidence) and `serializeAdapterReport` (the
  canonical drill-evidence bytes); evidence labels upgrade there -
  `fixture` here proves vocabulary behavior only.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - see
`build/flauz/dogfood/README.md`; pins: typescript, mocha@11; the
inference-family suites run under bun, which resolves the NodeNext
`.js`-specifiers to `.ts` sources natively - plain
`node --experimental-strip-types` does not remap them on node 24.x):

	~/toolchain/node_modules/.bin/tsc -p build/flauz/inference/adapters/tsconfig.json \
		--typeRoots ~/toolchain/node_modules/@types
	bun ~/toolchain/node_modules/.bin/_mocha --ui tdd \
		build/flauz/inference/adapters/test/common/providerAdapter.test.ts
	grep -nE 'Date\.now|Math\.random|new Date\(' build/flauz/inference/adapters/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suite also greps the
source in-process and pins it).
