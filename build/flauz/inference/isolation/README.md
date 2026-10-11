# Flauz inference isolation contracts (INF-007, Free Inference Fabric)

Typed contract set for the Free Inference Fabric isolation family - the
seventh family: the closed **credential isolation + provider-term
eligibility** vocabulary and its deterministic kit. THE NO-SECRET LAW is
this family's charter, front and center: the vocabulary carries NO
credential material anywhere - no secret values, no key bytes, no token
strings, no env names - only TYPED REFERENCES (the landed INF-003
opaque `credentialHandle` id shape). A credential scope is the typed
reference triple `(id, adapterId, handleRef)` and NOTHING else: the
scope's `adapterId` resolves in the bound adapter record, the catalog
binding through the adapter's `providerEntryId` resolves in the bound
catalog record, and the scope's `handleRef` EQUALS the bound adapter
record's own `credentialHandle` - never caller-invented. On top of the
reference discipline the family carries the honest-unknown eligibility
fold: the bound provider's `ProviderTermState` (the landed INF-002
vocabulary) folds to the frozen verdicts `eligible` / `ineligible` /
`term-unknown`, and a provider term state of `'unknown'` is NEVER
auto-eligible - every eligibility check over an unknown term state is
the typed `'term-unknown'` verdict, disclosed, never silent, never
assumed permission. Like the landed INF-001..006 families, this family
is pure vocabulary over injected values: no network (live-provider
acceptance is INF-009, never here), no shared public Flauz gateway
pooling third-party free-tier keys, no clock reading, no randomness,
no second authority.

Contract set version: `INFERENCE_ISOLATION_VERSION = '1.0.0'` - declared
ONCE in `common/isolationContract.ts` (the single version declaration
law), re-carried by `common/isolationKit.ts` (re-exported; the test
suite pins both module copies equal). The kit stamps its records with
the re-carried copy while the contract module's guards check against
the contract's copy - a drift is unrepresentable by construction (one
binding), and every emitted decision is self-checked through the
contract guard before it reaches the caller or the ledger (the drift
fail-closed law: a mismatch is a fail-closed TypeError, never a
valid-looking record). The vocabulary INSIDE the records is the landed
families', bound verbatim and never re-implemented: provider term
states ride the INF-002 catalog family's `PROVIDER_TERM_STATES`
vocabulary, adapter bindings are the INF-003 family's
`ProviderAdapterRecord` entries, the opaque handle reference is that
family's `credentialHandle` id shape, and the derived provenance +
metadata verification states ride the INF-001 semantics family's
vocabulary. Those sub-records keep their own family version stamps;
the isolation stamp and the landed stamps are distinct roles pinned by
the suite.

## Module index (the six delivery paths)

- `common/isolationContract.ts` - the typed isolation contract:
  `INFERENCE_ISOLATION_VERSION` (the single declaration),
  `ISOLATION_REJECTION_REASONS` (the frozen thirteen, in the exact
  check order - the set-walk shape reasons `invalid-scope-set-id` /
  `invalid-scopes` / `invalid-scope`, THE NO-SECRET LAW's
  `secret-shaped-scope` (checked FIRST in the scope walk, so a
  secret-bearing candidate is always named as the secret shape, never
  downgraded to a generic shape rejection), the scope shape reasons
  `invalid-scope-id` / `invalid-adapter-id` / `invalid-handle-ref`,
  the two no-dangling-ref reasons `unresolved-adapter-binding` /
  `unresolved-catalog-entry`, THE HANDLE-EQUALITY LAW's
  `credential-handle-mismatch`, and the within-set duplicate
  `duplicate-scope-id`), `CredentialScopeDescriptor` (`{ id,
  adapterId, handleRef }` - the typed triple ONLY; NO other fields
  representable in the type, not even a `contractVersion`: the typed
  reference is so minimal that even the family stamp is beyond it,
  and the enclosing audit shapes carry the stamps; the `fixture.`
  prefix convention for synthetic ids) + `admitCredentialScope` (the
  scope walk: the no-secret check first, then the triple's shape,
  then the no-dangling-ref chain, then the handle-equality law - the
  bound records are taken as the landed admitted shapes, and the
  battery fires the dangling reasons with cross-inconsistent
  hand-built records) + `admitCredentialScopeSet` (the set walk over
  `CredentialScopeSetRecord` - the catalog-record shape; every scope
  passes the scope walk against the SAME bound records with its own
  rejection cited verbatim, and scope ids are unique inside a record)
  + `isCredentialScopeDescriptor` (the shape-level guard WITHOUT the
  bound records - the no-extra-keys no-secret check and the
  non-empty triple, mirroring the landed `isMatchCandidateDescriptor`
  scope note), `USAGE_CLASSES` (the frozen four: `product-inference`
  / `routing-failover` / `matching-selection` / `sidecar-report` -
  the classes the landed families' surfaces already name in their
  binder maps; widening is a versioned decision) +
  `isUsageClass`, `TERM_ELIGIBILITY_VERDICTS` (the frozen verdicts
  `eligible` / `ineligible` / `term-unknown`) + `verdictForTermState`
  (the total deterministic fold over the landed term states - THE
  HONEST-UNKNOWN ELIGIBILITY LAW: `'unknown'` is never auto-eligible),
  `ISOLATION_ELIGIBILITY_PROBE_SCOPE` (the provenance scope-label
  convention `isolation.eligibility-probe` - a scope label, never a
  model claim, mirroring the routing family's `ROUTING_PROBE_SCOPE`),
  `ISOLATION_RESOLUTION_REASONS` (the frozen one-member resolution
  failure vocabulary `unknown-scope`) + the `HandleResolution` union
  (`HandleResolved` carries the typed reference ONLY - scope id,
  adapter id, the bound adapter record's own opaque
  `credentialHandle`; never secret material: the vocabulary cannot
  name a secret and the kit cannot return one), the
  `EligibilityDecisionRecord` union (`EligibilityDecided`: the
  binding chain, the usage class, the bound provider's
  `ProviderTermState` VERBATIM, the verdict, the metadata
  verification state riding the landed `ProviderMetadataVerification`
  vocabulary carried verbatim from the bound catalog entry, and the
  DERIVED `InferenceProvenance` built through the landed
  `unverifiedProvenance` constructor with the probe scope label -
  one decision, one time; `EligibilityRefused`: the typed
  `'no-eligible-binding'` refusal - never an exception, never a
  fabricated eligibility), `serializeEligibilityDecision` /
  `serializeCredentialScope` (canonical fixed-key-order bytes; the
  provenance sub-record mirrors the landed canonical provenance key
  order; refuse non-admitted shapes fail-closed), and
  `isEligibilityDecisionRecord` (the decision guard pinning the
  internal consistency laws structurally: the verdict is the total
  fold of the term state - an `'unknown'` term state can never carry
  an `'eligible'` verdict - and the derived provenance names the
  bound provider on both sides with the probe scope label and the
  recording instant equal to the decision instant).
- `common/isolationKit.ts` - the deterministic injected-clock kit:
  `createIsolationKit(options)` (the fail-closed factory: the options
  shape - `now` must be a function, the caller-injected `ledgerRoot`
  a non-empty string - the bound catalog through the LANDED
  `admitCatalogRecord`, the bound adapter record through the LANDED
  `admitProviderAdapterRecord` with the catalog (the landed
  direct-adapter law is the eligibility guard's provenance
  precondition, enforced there, never re-implemented here), the
  ledger root an existing directory, and ONE clock validation read),
  `register` (through the contract's scope walk with the kit's bound
  records; the kit-local frozen list `ISOLATION_KIT_REJECTION_REASONS`
  - the contract thirteen verbatim, in order, plus
  `isolation-scope-duplicate` at the registered set; the contract
  guard runs first, a malformed duplicate reports the contract
  reason), `list()` / `find()` / `count()` (the lookups; list sorted
  by scope id, stable), `resolveHandle(scopeId)` (THE TYPED
  RESOLUTION: the scope -> the bound adapter record -> its own
  `credentialHandle`; the result is the typed reference +
  resolution verdict ONLY - the frozen `unknown-scope` refusal side
  for a scope that resolves to nothing; zero clock reads),
  `checkEligibility(scopeId, usageClass)` (THE ELIGIBILITY FOLD: one
  clock read per decision, the usage-class membership check, the
  scope resolution, then the bound catalog entry's `termsState` ->
  the frozen verdict through the contract's `verdictForTermState`
  (the honest-unknown law end-to-end: `'unknown'` -> `'term-unknown'`
  with the disclosure, NEVER eligible), the derived provenance
  through the landed `unverifiedProvenance` constructor, the
  `metadataVerification` carried verbatim from the bound catalog
  entry, the one-way verification promotions DELEGATED to the landed
  folds (the kit exposes no promotion surface; a kit bound over a
  `markEntryMetadataVerified`-promoted catalog emits `'verified'`,
  never re-stamped; the caller's `markProvenanceVerified` on the
  returned decision still admits), the self-check through the
  contract guard, and the typed `'no-eligible-binding'` refusal for
  an unknown scope or a non-member usage class - never an exception,
  never a fabricated eligibility), `recordDecision(decision)` (THE
  LEDGER LAW: append-only JSONL at
  `{ledgerRoot}/isolation-decisions.jsonl` (the constant
  `ISOLATION_DECISIONS_LEDGER_FILE`); canonical
  `serializeEligibilityDecision` bytes, one decision per line, in
  call order; delivery evidence, never an event authority - the kit
  never reads it back), `eligibleScopes(usageClass)` (the PURE fold
  listing the eligible scopes with ZERO clock reads - empty is
  honest, never fabricated; no usage class outside the frozen
  vocabulary can make anything eligible), and the disclosed fixture
  ids `FIXTURE_SCOPE_PERMITTED_ID` / `FIXTURE_SCOPE_UNKNOWN_TERM_ID`
  / `FIXTURE_SCOPE_PROHIBITED_ID` (evidence label `fixture`; the kit
  does NOT pre-register them - a credential scope binds the caller's
  bound records, which the kit cannot know at creation; the battery
  registers the three disclosed fixture scopes against its fixture
  bound records).
- `test/common/isolationContract.test.ts` - mocha tdd suite (63
  tests): the version roles; every frozen vocabulary pinned exact
  (contents, order, uniqueness - the rejection reasons, the usage
  classes, the verdicts, the resolution reasons, the probe scope
  label, the verdict fold); the scope walk from both directions (the
  no-secret law first - a secret-only candidate is the secret shape,
  never `invalid-scope-id`; extra `apiKey` / `token` / `env` fields
  and even the family version stamp rejected; the JSON-parsed
  runtime-boundary probe; every shape and dangling reason firing -
  the catalog-dangling direction via cross-inconsistent hand-built
  records; the caller-invented handle; purity); the set walk (the
  cited scope walk in the detail, the within-set duplicate, the
  honest empty set); the shape guard both directions INCLUDING the
  compile-time pin (an `@ts-expect-error` directive proves a field
  beyond the typed triple is unrepresentable - the scoped tsc gate
  fails if the error ever disappears); the canonical scope bytes
  (double-run byte-equality, key-insertion-order independence, the
  exact triple bytes, no field beyond the triple at the byte level,
  fail-closed refusal); the decision guard from both directions (all
  three verdict fixtures, the refusal fixture, the caller-promoted
  decision, every vocabulary violation, the structural
  honest-unknown law - `unknown`+`eligible`, `permitted`+
  `term-unknown`, `prohibited`+`eligible`, `unknown`+`ineligible`
  all rejected - the provenance consistency laws, one-decision-
  one-time); the canonical decision bytes (double-run byte-equality,
  key-insertion-order independence, the exact decided and refusal
  byte strings, the landed provenance key order, fail-closed
  refusal); the in-suite determinism greps (law comments only).
- `test/common/isolationKit.test.ts` - mocha tdd suite (58 tests):
  the fail-closed factory (every landed guard citation, the ledger
  root laws incl. the not-a-directory probe, the clock laws incl.
  one-read-per-decision and the non-finite fails-closed probe);
  register (the contract reasons verbatim, the kit duplicate,
  contract-first ordering, the no-secret and handle-mismatch
  rejections through register, purity); the lookups; the typed
  resolution (the scope -> adapter -> own handle chain, the
  handle-equality law end-to-end, the typed `unknown-scope`
  verdict, the own-keys pin - the resolved side carries the typed
  reference only, zero clock reads); the honest-unknown eligibility
  fold end-to-end (all three fixture verdicts, all four usage
  classes, the unknown NEVER eligible, the binding chain, the
  derived provenance and one-decision-one-time, the metadata
  verification verbatim, both delegated one-way promotions, the
  typed refusals, double-run byte-stability, the counting-clock
  read pins); the pure eligible-scopes fold (sorted, empty is
  honest, the invalid usage class, zero clock reads, no ledger
  append); the append-only ledger (canonical bytes in call order,
  the file grows only, foreign-shaped decisions recorded, malformed
  refused, the disclosed file-name constant); the fixture ids; the
  in-suite determinism greps.
- `tsconfig.json` - byte-for-byte copy of the semantics family's
  scoped strict noEmit shape (sha256-verified equal).
- `README.md` - this binder note.

Evidence label: `fixture` (the suites run on synthetic
`fixture.`-prefixed ids, synthetic provider ids, synthetic opaque
credential-handle reference ids and synthetic epoch constants only; no
authority values, no real providers, adapters, endpoints, URLs or
keys, no network, no credentials, no secret material anywhere - only
typed references; the ledger tests run at a caller-injected root
under `os.tmpdir()`, outside the repo tree, cleaned per suite run).

Owner item: INF-007 (TL-B, B2 lane - capability exchange + inference
fabric).

## Laws

Inherited from the landed families (binding, unchanged): THE
OBSERVABILITY LAW, THE NO-HIDDEN-SUBSTITUTION LAW, THE
UNVERIFIED-DEFAULT LAW, HONEST STATES ARE DEFAULTS, THE
DIRECT-ADAPTER LAW, CREDENTIAL REFERENCES ONLY, THE NO-DANGLING-REF
LAW, NO SHARED PUBLIC GATEWAY, determinism, vocabulary-only,
`contractVersion` on every persisted/audited record. New in this
family:

- THE NO-SECRET LAW (this family's charter): the vocabulary carries
  NO credential material anywhere - no secret values, no key bytes,
  no token strings, no env names - only TYPED REFERENCES (the landed
  opaque `credentialHandle` id shape). A credential scope is the
  typed triple `(id, adapterId, handleRef)` and NOTHING else: any
  field beyond the typed reference shape is the typed
  `secret-shaped-scope` rejection, checked FIRST in the scope walk so
  a secret-bearing candidate is always named as the secret shape,
  never downgraded to a generic shape rejection. Unrepresentable AND
  rejected: the type admits no extra field (the battery's
  `@ts-expect-error` compile-time pin), the shape guard rejects any
  extra own key, and the canonical bytes carry exactly the triple.
  The scope triple is so minimal it carries no `contractVersion` of
  its own - even the family stamp is beyond the typed reference
  shape; the enclosing audit shapes (the set record, the decision
  records) carry the stamps.
- THE HANDLE-EQUALITY LAW: a scope's `handleRef` EQUALS the bound
  adapter record's own `credentialHandle` - never caller-invented. A
  caller-invented handle reference is the typed
  `credential-handle-mismatch` rejection. THE TYPED RESOLUTION
  (`resolveHandle`) walks the same chain - the scope -> the bound
  adapter record -> its own `credentialHandle` - and returns the
  typed reference + resolution verdict ONLY: the vocabulary cannot
  name a secret and the kit cannot return one.
- THE NO-DANGLING-REF LAW (extended to isolation): every scope's
  `adapterId` resolves in the bound adapter record; through the
  bound adapter's `providerEntryId` every catalog binding resolves in
  the bound catalog record - or admission is a typed rejection, never
  a silent dangling ref. At kit creation the bound records arrive as
  unknown at the runtime boundary and are validated through the
  LANDED guards (`admitCatalogRecord`, `admitProviderAdapterRecord`
  with the catalog); the landed direct-adapter law (a per-user/direct
  adapter is never `'flauz-provisioned'`) is the eligibility guard's
  provenance precondition, enforced there, never re-implemented here.
- THE HONEST-UNKNOWN ELIGIBILITY LAW (the INF-002 catalog's own law,
  re-enforced at the eligibility seam): a provider term state of
  `'unknown'` is NEVER auto-eligible. Every eligibility check over an
  unknown term state is the typed `'term-unknown'` verdict -
  disclosed (the term state rides the decision verbatim), never
  silent, never assumed permission. The verdict is the total
  deterministic fold of the term state (`verdictForTermState`), and
  the decision guard pins the fold STRUCTURALLY: an `'unknown'` term
  state can never carry an `'eligible'` verdict in any well-formed
  record.
- THE PROVENANCE-DERIVATION LAW: an eligibility decision's provenance
  is DERIVED from the bound records at decision time through the
  landed `unverifiedProvenance` constructor (unverified by
  construction; the model fields name the probe scope label - a
  scope label, never a model claim), never caller-supplied, never
  hand-built. The decision guard pins the derivation structurally:
  the provenance names the bound provider on both sides with the
  `'none'` substitution (no substitution is representable - the
  eligibility decision is about one provider) and the same recording
  instant as the decision's own `decidedAtEpochMs` (one decision,
  one time).
- THE DELEGATED PROMOTION: the landed one-way verification promotions
  (`markProvenanceVerified` / `markEntryMetadataVerified`) are
  delegated, never re-implemented; the landed
  `ProviderMetadataVerification` states are the disclosure
  vocabulary. The kit exposes NO promotion surface at all: the
  `metadataVerification` field is carried verbatim from the bound
  catalog entry (a kit bound over a promoted catalog emits
  `'verified'`, never re-stamped), and promotion of the returned
  decision's provenance is the caller's one-way copy.
- THE TYPED REFUSAL: an unknown scope id or a usage class outside the
  frozen vocabulary is the typed `'no-eligible-binding'` refusal -
  never an exception, never a fabricated eligibility. Nothing is
  decided on the refusal side: no provenance is derived, no verdict
  is invented; the detail names the miss.
- THE DUPLICATE LAW: at the set fold a repeated scope id inside a
  candidate scope set record is `duplicate-scope-id`; at the
  registered set a repeated id is the kit-local
  `isolation-scope-duplicate` - never a silent overwrite. The
  contract guard runs first: a candidate that is both malformed and
  a duplicate reports the contract reason, never the duplicate.
- THE LEDGER LAW: the append-only JSONL decision ledger at the
  caller-injected root (`isolation-decisions.jsonl`) is the family's
  one bounded local-IO surface, ordered by the work item. It is
  DELIVERY EVIDENCE, never an event authority: the kit never reads
  it back; decisions derive from the bound records and the injected
  clock, never from the ledger. Appends are canonical
  `serializeEligibilityDecision` bytes, one decision per line, in
  call order (append-only: the file grows, earlier lines never
  change). No network I/O; no credential material ever reaches the
  ledger.
- THE DRIFT FAIL-CLOSED LAW: every decision the kit emits is
  self-checked through the CONTRACT module's
  `isEligibilityDecisionRecord` guard before it reaches the caller -
  a mismatch fails closed as a TypeError, never as a valid-looking
  record.
- THE PURE FOLDS: `resolveHandle`, `eligibleScopes` and the
  register/list/find/count lookups read NO clock at all;
  `checkEligibility` reads exactly one per decision. `eligibleScopes`
  lists the eligible scopes for a usage class - empty is honest,
  never fabricated.
- Canonical bytes: fixed-key-order serialization, double-run
  byte-equal; the provenance sub-record mirrors the landed canonical
  provenance key order.
- Zero external dependencies: `node:path` / `node:fs` (the ledger
  law's bounded surface) and the landed sibling families only.

## The typed resolution convention

`resolveHandle(scopeId)` is the isolation runtime's ONLY handle
surface: the registered scope -> the bound adapter record -> that
adapter's own opaque `credentialHandle`. The INF-005 routing decision
names an `adapterId`; the isolation runtime resolves the handle FOR
that adapter id through this fold (the scope's `adapterId` binding),
and the result carries the typed reference only - scope id, adapter
id, credential handle - never secret material. The frozen
one-member `ISOLATION_RESOLUTION_REASONS` vocabulary (`unknown-scope`)
is the refusal side: a scope id that resolves to no registered scope
has no typed reference to resolve.

## The eligibility fold convention

`checkEligibility(scopeId, usageClass)` reads the bound catalog entry
ONE hop behind the scope (scope -> adapter -> provider entry) and
folds its `termsState` verbatim: `'permitted'` -> `'eligible'`,
`'prohibited'` -> `'ineligible'`, `'unknown'` -> `'term-unknown'`
(THE HONEST-UNKNOWN ELIGIBILITY LAW - never auto-eligible). The usage
class is the disclosed CONTEXT of the question (which landed surface
asks), not a modifier of the verdict: the landed `ProviderTermState`
is one state per provider entry, and this family invents no
per-usage-class term matrix (that would be re-implementing the
catalog's vocabulary). The decision carries the usage class, the term
state verbatim, the verdict, the bound entry's metadata verification
state verbatim, and the derived provenance; the caller records it in
the ledger through `recordDecision` (the fold itself appends
nothing).

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values plus the
one bounded ledger surface. No authority seam needs transcription
before the gates run; both suites are green as shipped.

## Future binder note (INF-008/009)

Updated from the matching family's binder note: each binder consumes
the isolation surfaces listed here IN ADDITION to the semantics
surfaces (`build/flauz/inference/semantics/README.md`), the catalog
surfaces (`build/flauz/inference/catalog/README.md`), the adapter
surfaces (`build/flauz/inference/adapters/README.md`), the sidecar
surfaces (`build/flauz/inference/sidecar/README.md`), the routing
surfaces (`build/flauz/inference/routing/README.md`) and the matching
surfaces (`build/flauz/inference/matching/README.md`) it already
binds.

- INF-008 (provenance/capacity/reset UI): consumes the ELIGIBILITY
  DECISION's provenance/verification vocabulary - the derived
  `InferenceProvenance` riding every decided record (with the probe
  scope label convention), the `ProviderTermState` disclosure carried
  verbatim next to its verdict, the metadata verification state
  riding the landed `ProviderMetadataVerification` vocabulary, the
  `serializeEligibilityDecision` canonical bytes as the
  persistence/audit shape the UI renders, and the ledger lines at
  `{ledgerRoot}/isolation-decisions.jsonl` as the delivery-evidence
  stream (the `EligibilityRefused` side included - what a user is
  shown for why nothing was eligible, never a silent empty).
- INF-009 (live-provider acceptance and failure drills): consumes the
  ELIGIBILITY VERDICTS + THE TYPED RESOLUTION as the acceptance
  vocabulary - the frozen `TERM_ELIGIBILITY_VERDICTS` values as the
  typed drill-evidence vocabulary for eligibility-shaped evidence
  (`'term-unknown'` the honest-unknown member a drill may honestly
  produce), `admitCredentialScope` / `admitCredentialScopeSet` /
  `isCredentialScopeDescriptor` as the acceptance vocabulary for
  scope-shaped evidence, `HandleResolution` as the typed
  resolution-shaped evidence vocabulary, and
  `serializeEligibilityDecision` / `serializeCredentialScope` as the
  canonical drill-evidence bytes; evidence labels upgrade there -
  `fixture` here proves vocabulary behavior only. The live-provider
  network surface itself is INF-009's own item, never this family's.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood
discipline; mocha under bun is the verified runner: Node 24 dropped
the .js-specifier-to-.ts resolution the family test style relies
on):

	bunx tsc -p build/flauz/inference/isolation/tsconfig.json --noEmit
	bunx --bun mocha --ui tdd 'build/flauz/inference/isolation/test/common/*.test.ts'
	grep -rn 'Date\.now\|Math\.random\|process\.env' build/flauz/inference/isolation/

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it). The whole-tree variant additionally
hits the suites' own grep-test titles and this README's law text -
the same quoted-ban lines the landed families' trees show.
