# Flauz inference optional sidecar contracts (INF-004, Free Inference Fabric)

Typed contract set for the Free Inference Fabric sidecar family - the
fourth family: the typed **optional** per-user/local
FreeLLMAPI-compatible sidecar contracts - the closed vocabulary for
what a sidecar IS and MAY claim, the fail-closed admission guard, and
the deterministic registration/reporting kit. THE MASTER SAFETY LAW
(verbatim from the roadmap): "Use the tactics demonstrated by
tashfeenahmed/freellmapi as a reference/optional integration
path... FreeLLMAPI is reference/optional adapter technology, not an
authority or required dependency." This family enforces that law IN
THE TYPES: the sidecar is optional, replaceable and never an
authority - nothing in Flauz may ever require it, and its claims
never outweigh Flauz's own honest-promise vocabulary. Like the landed
INF-001 semantics, INF-002 catalog and INF-003 adapter families, this
family is PURE VOCABULARY over injected values: no network, no
process management, no sidecar binary, no FreeLLMAPI code ('freellmapi-compatible'
names a compatibility SHAPE, never a package, never a dependency,
never an endpoint), no shared public Flauz gateway pooling
third-party free-tier keys, no second authority.

Contract set version: `INFERENCE_SIDECAR_VERSION = '1.0.0'` -
declared in `common/sidecarContract.ts` and independently
re-declared in `common/sidecarKit.ts` (the COMMAND_FACADE
zero-dependency idiom; the test suite pins both copies equal). The
vocabulary INSIDE the records is the landed INF-001 semantics
family's, bound verbatim from `common/capacityDisclosure.js` and
never re-implemented: `ProviderMetadataVerification` /
`PROVIDER_METADATA_VERIFICATIONS`, `ProviderCapacitySnapshot`,
`InferenceProvenance`, `unknownSnapshot`, `unverifiedProvenance`,
`markProvenanceVerified`, `isProviderCapacitySnapshot`. Those
sub-records keep their own `INFERENCE_SEMANTICS_CONTRACTS_VERSION`
stamp; the sidecar stamp and the semantics stamp are distinct roles
(the suite pins both).

## Module index

- `common/sidecarContract.ts` - the typed optional sidecar contract:
  `SIDECAR_INTERFACE_PROFILES` (the closed ONE-member set:
  `'freellmapi-compatible'` - the minimal honest set today; widening
  is a separately versioned contract decision, never silent),
  `SidecarRecord` (with `optional: true` and `replaceable: true` as
  LITERAL-true-only fields - the required-dependency lie and the
  authority lie are unrepresentable in the types AND rejected at the
  runtime boundary), `SIDECAR_REJECTION_REASONS` (the frozen nine, in
  the exact check order), `admitSidecar` (the FAIL-CLOSED admission
  guard: first failure per the list order is the verdict; every
  rejection names its reason), `isSidecarRecord` (shape predicate),
  `serializeSidecarRecord` (canonical fixed-key-order bytes,
  double-run byte-equal; refuses non-admitted records fail-closed),
  `INFERENCE_SIDECAR_VERSION`.
- `common/sidecarKit.ts` - the deterministic kit:
  `createSidecarKit(options)` (THE INJECTED-CLOCK LAW - the kit
  never reads a clock; every timestamp comes from the injected
  `now()`; a `now()` that cannot produce an admittable registration
  time fails kit creation closed), `SidecarKit.register` (through the
  contract guard FIRST, then THE DUPLICATE LAW: a repeated
  sidecarId is the typed `'sidecar-id-duplicate'` rejection - ADDED
  to the frozen list as `SIDECAR_KIT_REJECTION_REASONS`, the
  documented ten-reason kit vocabulary), `list()` (sorted by
  sidecarId, stable, fresh copies), `find` / `count`,
  `reportSnapshot` (THE HONEST-DEFAULT LAW: unknown id -> undefined;
  no attached state source -> the landed `unknownSnapshot`, UNKNOWN
  first-class, never fabricated healthy; a malformed or
  misattributed attached state fails closed with a TypeError),
  `provenanceOf` (THE DELEGATED-PROVENANCE LAW: the landed
  `unverifiedProvenance` derivation - unverified by construction,
  naming the sidecar's provider with no substitution; promotion is
  ONLY the caller's one-way `markProvenanceVerified` copy - the kit
  exposes no promotion mutator and never re-implements the
  promotion), `attachFixtureState` (attaches a pure
  probe-time state source; last attach wins; unknown id -> false;
  non-function source -> TypeError), the three DISCLOSED fixture
  sidecars (`fixture.sidecar.known-quota` - a freellmapi-compatible
  local sidecar with a deterministic known-quota state: healthy, 42
  of 100 inside a rolling window bracketing the probe, an
  interval-aligned hourly reset from the epoch anchor;
  `fixture.sidecar.active-cooldown` - a deterministic active
  `rate-limited` cooldown bracketing the probe, quota honestly
  unknown; `fixture.sidecar.no-state` - NO attached state,
  demonstrating the honest-default law), `SIDECAR_CAPACITY_REPORT_SCOPE`
  (the documented scope-label convention below),
  `INFERENCE_SIDECAR_VERSION` (the re-declared copy).
- `test/common/sidecarContract.test.ts` - mocha tdd suite: every
  frozen rejection reason fires; the optional/replaceable
  literal-true laws pinned from BOTH sides (true admits; false,
  absent and the string 'true' all reject); the check-order pins;
  admissions incl. the 0 and MAX_SAFE_INTEGER registration-time
  boundaries; the serialization round trip; canonical-byte
  double-run equality, key-insertion-order independence and
  every-free-field-differs coverage; version stamping; the in-suite
  determinism grep (law comments only).
- `test/common/sidecarKit.test.ts` - mocha tdd suite: the fail-closed
  factory (both malformed-options paths); the three disclosed
  fixtures (ordinary admitted records, clock-stamped, unverified);
  register verbatim through the guard, the duplicate law (id-keyed,
  count-preserving, contract-first ordering), lookups incl.
  empty/miss, the honest-default law pinned end-to-end (the
  no-state fixture deep-equals the landed `unknownSnapshot`), the
  deterministic fixture states (inclusive boundary math through the
  landed `quotaWindowContains` / `cooldownActive`), attached-state
  fail-closed paths (malformed, misattributed, non-function),
  the delegated provenance laws (unverified default, landed-guard
  admission, the one-way promotion pinned end-to-end incl. the
  never-self-promotes pin), the COMMAND_FACADE version pins across
  both module copies, canonical bytes over kit state (double-run,
  two kits on the same fixed clock byte-equal), and the in-suite
  determinism greps (law comments only).
- `tsconfig.json` - byte-for-byte copy of the semantics family's
  scoped strict noEmit shape (`cp build/flauz/inference/semantics/tsconfig.json`).

Evidence label: `fixture` (the suites run on synthetic
`fixture.`-prefixed ids, synthetic provider ids and synthetic epoch
constants only; no authority values, no real providers, models,
endpoints, URLs or keys, no network, no storage, no credentials).

Owner item: INF-004 (TL-B, B2 lane - capability exchange + inference
fabric).

## Laws

Inherited from the semantics family (binding, unchanged):
THE PROMISE-SPLIT LAW, THE NO-HIDDEN-SUBSTITUTION LAW, HONEST STATES
ARE DEFAULTS, NO SHARED PUBLIC GATEWAY, determinism, vocabulary-only,
`contractVersion` on every persisted record. New in this family:

- THE OPTIONAL LAW: the sidecar is never a required dependency.
  `optional: true` is the only representable value; the admission
  guard rejects `optional !== true` (false, absent, the string
  'true', anything) with the dedicated `'sidecar-not-optional'`
  reason - the required-dependency lie is banned in the types AND at
  the boundary.
- THE REPLACEABLE LAW: the sidecar is replaceable technology, never
  an authority. `replaceable: true` is the only representable value;
  `replaceable !== true` is the typed `'sidecar-not-replaceable'`
  rejection (the authority lie). No sidecar record carries authority
  semantics; its claims route THROUGH the landed INF-001 disclosure
  vocabulary (snapshots, provenance, verification states), never
  around it.
- THE INJECTED-CLOCK LAW: no `Date.now`, no `Math.random`, no
  `process.env` in `common/**` (law comments excepted; the suites
  grep the sources in-process and pin it). Every timestamp - fixture
  registration, snapshot observation times, provenance recording
  times - comes from the single injected `now()`.
- Fail-closed admission: typed guards at every boundary; check
  order = the reason list order; every rejection names its reason.
- Honest states first-class: `unknownSnapshot` / `unverifiedProvenance`
  are the kit's defaults; the one-way verification promotion is
  delegated to the landed `markProvenanceVerified` (never
  re-implemented, never a kit-side mutator).
- Canonical bytes: fixed-key-order serialization, double-run
  byte-equal; every record carries `contractVersion`.
- THE DUPLICATE LAW (the documented addition): registering a
  sidecarId the kit already carries is the typed
  `'sidecar-id-duplicate'` rejection - the tenth member of
  `SIDECAR_KIT_REJECTION_REASONS` (the contract's nine verbatim,
  in order, plus this one). The contract guard runs first: a
  candidate that is both malformed and a duplicate reports the
  contract reason, never the duplicate.
- Zero external dependencies: `node:` builtins, the contract module
  and the landed sibling `capacityDisclosure.js` only; tooling lives
  OUTSIDE the repo tree.

## The interface-profile vocabulary (the closed one)

`freellmapi-compatible` is the minimal honest set today: ONE
profile, the reference shape demonstrated by
tashfeenahmed/freellmapi. A profile names the compatibility SHAPE a
sidecar speaks - never a package, never a dependency, never an
endpoint, never a credential. Collapsing below one member leaves no
vocabulary at all; widening (new profiles) is a separately versioned
contract decision, never a silent addition.

## The provenance scope-label convention

The sidecar record is provider-scoped and carries no model ids, but
the landed `InferenceProvenance` requires requested/actual model
fields. `provenanceOf` therefore names the disclosed scope label
`SIDECAR_CAPACITY_REPORT_SCOPE = 'sidecar.capacity-report'` in the
model fields: the provenance of a capacity REPORT names the report
scope - a scope label, never a model claim. The requested and actual
provider both name the sidecar's own provider (the sidecar serves
exactly its provider; the substitution label derives 'none'
honestly by construction).

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values. No
authority seam needs transcription before the gates run; both suites
are green as shipped.

## Future binder note (INF-005..009)

Updated from the adapter family's binder note: each binder consumes
the sidecar surfaces listed here IN ADDITION to the semantics
surfaces (`build/flauz/inference/semantics/README.md`), the catalog
surfaces (`build/flauz/inference/catalog/README.md`) and the adapter
surfaces (`build/flauz/inference/adapters/README.md`) it already
binds.

- INF-005 (health/quota/cooldown/retry/failover routing): consumes
  the kit's `reportSnapshot` folds (the observed state a router MAY
  read from an OPTIONAL sidecar - never a required input) and the
  honest-default `unknownSnapshot` fallback (what the router sees
  when a sidecar carries no state). The router, retry loop and
  failover engine are INF-005's items; this family delivers the
  report vocabulary only.
- INF-006 (context-window/capability matching): consumes
  `provenanceOf`'s landed `InferenceProvenance` (match decisions are
  disclosed, never silently substituted) and the `SidecarRecord`
  provider binding. The matching engine itself is INF-006's item.
- INF-007 (credential isolation and provider-term eligibility):
  consumes the sidecar record's NO-credential shape - the
  `SidecarRecord` vocabulary deliberately carries no credential
  field, so a sidecar binds nothing secret (the isolation runtime's
  real guards are a binding scope boundary here) - plus the landed
  metadata verification states.
- INF-008 (provenance/capacity/reset UI): consumes
  `serializeSidecarRecord` canonical bytes (the persistence/audit
  shape the UI renders) and the landed disclosure projection over
  `reportSnapshot` output (the honest states a user is shown for
  their own optional sidecars).
- INF-009 (live-provider acceptance and failure drills): consumes
  `admitSidecar` / `isSidecarRecord` as the acceptance vocabulary
  for sidecar-shaped evidence and the kit's deterministic fixtures
  as drill inputs; evidence labels upgrade there - `fixture` here
  proves vocabulary behavior only.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - see
`build/flauz/dogfood/README.md`; pins: typescript 5.9.3, mocha@11,
the tsx loader):

	npx -y -p typescript@5.9.3 tsc -p build/flauz/inference/sidecar/tsconfig.json
	NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/sidecar/test/common/*.test.ts'
	grep -nE 'Date\.now|Math\.random|process\.env' build/flauz/inference/sidecar/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it).
