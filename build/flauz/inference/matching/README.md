# Flauz inference matching contracts (INF-006, Free Inference Fabric)

Typed contract set for the Free Inference Fabric matching family - the
sixth family: the closed **context-window/capability matching**
vocabulary and its deterministic kit. The family matches a
token/modalities/output-cap request against user-declared match
entries, through each entry's adapter binding and the adapter's
`providerEntryId` the bound capability matrix descriptors (the matrix
walk), ranking the admissible (entry, model) pairs deterministically
and disclosing every match decision - never silently substituted.
Like the landed INF-001..005 families, this family is pure matching
vocabulary over injected values: no network (live-provider acceptance
is INF-009, never here), no credential material in any match shape,
no clock reading, no randomness, no second authority.

Contract set version: `INFERENCE_MATCHING_VERSION = '1.0.0'` - declared
ONCE in `common/matchingContract.ts` (the single version declaration
law), re-carried by `common/matchingKit.ts` (re-exported; the test
suite pins both module copies equal). The kit stamps its records with
the re-carried copy while the contract module's guards check against
the contract's copy - a drift is unrepresentable by construction (one
binding), and every emitted decision is self-checked through the
contract guard before it reaches the caller or the ledger (the drift
fail-closed law: a mismatch is a fail-closed TypeError, never a
valid-looking record). The vocabulary INSIDE the records is the
landed families', bound verbatim and never re-implemented: modality
and context-window verdicts ride the INF-002 catalog family's
`MODEL_MODALITIES` / `contextWindowContains` discipline, adapter
bindings are the INF-003 family's `ProviderAdapterRecord` entries,
the substitution disclosure rides the INF-001 semantics family's
`SubstitutionState`, the derived provenance is built through the
landed `unverifiedProvenance` constructor, and the routing binding
rides the INF-005 family's `ROUTING_SELECTION_RULES`. Those
sub-records keep their own family version stamps; the matching stamp
and the landed stamps are distinct roles pinned by the suite.

## Module index (the six delivery paths)

- `common/matchingContract.ts` - the typed matching contract:
  `INFERENCE_MATCHING_VERSION` (the single declaration),
  `MATCHING_REJECTION_REASONS` (the frozen seventeen, in the exact
  check order - the three no-dangling-ref reasons
  `unresolved-adapter-binding` / `unresolved-catalog-entry` /
  `unresolved-capability-descriptor`, the within-matrix duplicate
  `duplicate-match-entry-id`, the request-shape reasons
  `invalid-context-tokens` / `invalid-request-modalities` /
  `invalid-output-cap` / `invalid-request-tag`, and the
  provenance-substitution reason `caller-supplied-provenance`:
  a caller-supplied provenance or substitution label is a typed
  rejection - provenance is DERIVED from the bound records),
  `MatchRequestDescriptor` (`{ contextTokens, modalities?,
  outputCapTokens?, requestTag? }` - NO credential material, no
  endpoints, no urls) + `admitMatchRequest` (the request walk;
  canonicalizes the modalities into the landed closed order) +
  `isMatchRequestDescriptor`,
  `MatchCandidateDescriptor` (`{ id, adapterId, declaredPriority?,
  contractVersion }` - a plain id reference into the INF-003 adapter
  record; the `fixture.` prefix convention for synthetic ids) +
  `MatchMatrixRecord` (the catalog-record shape) +
  `admitMatchCandidate` / `admitMatchMatrix` (the entry and matrix
  walks: shape first, then the full no-dangling-ref chain - the
  entry's adapter binding resolves in the bound adapter record, the
  catalog binding through the adapter's `providerEntryId` resolves in
  the bound catalog record, and the capability descriptor binding
  resolves in the bound capability matrix record; the bound records
  are taken as the landed admitted shapes, and the battery fires the
  dangling reasons with cross-inconsistent hand-built records),
  `MATCH_VERDICTS` (the frozen eight: `context-fits` /
  `context-too-small` / `context-too-large`, `modalities-covered` /
  `modalities-missing`, `output-cap-fits` / `output-cap-exceeded`,
  and the honest-unknown `capability-unknown`) with the three
  dimension vocabularies, `MatchCandidateVerdictRow` (the per-(entry,
  model) typed verdict row) + `MatchUnknownDescriptorRow` (the
  honest-unknown row - first-class, never silently dropped, never
  fabricated; unreachable through registration by the
  no-dangling-ref law, emitted defensively by the engine),
  `MatchRankedCandidate` / `MatchSelectedCandidate` /
  `MatchRoutingBinding` (the binder-map law: the selected candidate's
  adapterId plus the landed `ROUTING_SELECTION_RULES` selection rule
  the match ranks within or above), `MatchDecisionMatched` /
  `MatchDecisionNoMatch` / `MatchDecisionRecord` / `MatchOutcome`
  (the matched side carries the substitution disclosure riding the
  landed `SubstitutionState`, the derived `InferenceProvenance` and
  the routing binding; the no-match side is the typed
  `no-matching-candidate` refusal carrying the FULL honest rows -
  never an exception, never a fabricated match; the request rejection
  is the typed `request-rejected` outcome - a frozen-list reason,
  fail-closed, never an exception), `serializeMatchDecision` /
  `serializeMatchCandidate` (canonical fixed-key-order bytes; the
  provenance sub-record mirrors the landed canonical provenance key
  order; refuse non-admitted shapes fail-closed), and the shape
  guards `isMatchRequestDescriptor` / `isMatchCandidateDescriptor` /
  `isMatchDecisionRecord` (the matched side pins the internal
  consistency laws structurally: the selected candidate is a member
  of the ranked list, `'none'` exactly when the selected is the
  ranked top, the derived provenance names the ranked top as
  requested and the selected as actual with the same recording
  instant as the decision's own `decidedAtEpochMs` - one decision,
  one time - and the routing binding names the selected candidate's
  adapterId).
- `common/matchingKit.ts` - the deterministic injected-clock kit:
  `createMatchingKit(options)` (the fail-closed factory: the options
  shape, the bound catalog / adapter record / capability matrix
  through the LANDED guards - `admitCatalogRecord`,
  `admitProviderAdapterRecord` with the catalog,
  `admitCapabilityMatrix` with the catalog, the landed reasons cited
  verbatim in the TypeErrors - the caller-injected ledger root (an
  existing directory, never invented), and ONE clock validation
  read), `register` (through the contract's entry walk with the kit's
  bound records; the kit-local frozen list
  `MATCHING_KIT_REJECTION_REASONS` - the contract seventeen verbatim,
  in order, plus `matching-entry-duplicate` at the registered set;
  the contract guard runs first, a malformed duplicate reports the
  contract reason), `list()` / `find()` / `count()` (the lookups;
  list sorted by entry id, stable), `match(request)` (THE ENGINE:
  the request walk, then one clock read, then the per-(entry, model)
  verdict rows - the context-window verdict rides the landed
  `contextWindowContains` (INCLUSIVE boundaries; a boundary-exact
  request FITS, one off each side is the honest too-small /
  too-large verdict), the modality coverage verdict lists the missing
  modalities in the closed vocabulary's own order, the output-cap
  verdict compares the request's cap against the descriptor's max
  output tokens; the admissible pairs are ranked
  `declaredPriority` ascending (an undeclared priority rides the
  honest `0` default), ties by entry id ascending, then by model id
  ascending (the byte-stability tie-break when one entry's provider
  offers multiple fitting models); the selected candidate is the
  ranked top, or the tag preference when honored; the derived
  provenance is built ONLY through the landed `unverifiedProvenance`
  constructor - the substitution label derived by the landed
  constructor itself; every decision is self-checked through the
  contract guard, then appended to the ledger), `rankPreview(request)`
  (the same engine paths without the ledger append),
  `recordDecision(decision)` (THE LEDGER LAW: append-only JSONL at
  `{ledgerRoot}/matching-decisions.jsonl` (the constant
  `MATCHING_DECISIONS_LEDGER_FILE`); canonical `serializeMatchDecision` bytes, one
  decision per line, in call order; delivery evidence, never an
  event authority - the engine never reads it back), and the
  disclosed fixture ids `FIXTURE_MATCH_FITS_ID` /
  `FIXTURE_MATCH_TOO_SMALL_ID` / `FIXTURE_MATCH_MODALITY_MISSING_ID`
  (evidence label `fixture`; the kit does NOT pre-register them - a
  match entry binds the caller's bound records, which the kit cannot
  know at creation; the sidecar family's creation-time fixture
  registration does not carry over, and the battery registers the
  three disclosed fixture entries against its fixture bound
  records).
- `test/common/matchingContract.test.ts` - mocha tdd suite (62
  tests): the version roles; every frozen vocabulary pinned exact
  (contents, order, uniqueness); the request walk from both
  directions (every request reason firing, the canonicalization, the
  caller-supplied-provenance rejection, purity); the entry and matrix
  walks (every entry reason firing incl. the three no-dangling-ref
  directions via cross-inconsistent hand-bound records, the duplicate
  at the matrix fold, purity); the serialization idioms (double-run
  byte-equality, key-insertion-order independence, the fixed key
  orders, the landed provenance key order, fail-closed refusal); the
  decision guard from both directions (the honest-unknown row shape,
  the structural no-hidden-substitution law, the requested/actual
  consistency, one-decision-one-time, the routing binding); the
  in-suite determinism greps (law comments only).
- `test/common/matchingKit.test.ts` - mocha tdd suite (54 tests): the
  fail-closed factory (every landed guard citation, the ledger root
  laws, the clock laws incl. one-read-per-decision); register (the
  contract reasons verbatim, the kit duplicate, contract-first
  ordering, purity); the lookups; the request validation (every
  reason as the typed `request-rejected` outcome, never appended to
  the ledger); the per-candidate verdict rows (the three fixture
  entries demonstrating their names, the output-cap verdict, honest
  inadmissible rows); the inclusive-boundary law pinned at every
  boundary (exactly-on at min and max FITS, one off each side
  disclosed, the landed `contextWindowContains` cited as the
  authority); the disclosed ranking (priority over entry id, the
  honest 0 default, the entry-id and model-id tie-breaks,
  byte-stability); the substitution-disclosure law (the tag
  preference: a honored non-top preference IS a disclosed
  substitution - requested = the ranked top, actual = the selected;
  unknown or inadmissible tags honestly ignored; the delegated
  promotion - the kit never self-promotes); the routing binding; the
  no-match typed refusal (the FULL rows, never a fabricated match);
  rankPreview (identical to match at the same clock, no append); the
  append-only ledger (canonical bytes in call order, the file grows
  only, foreign-shaped decisions recorded, malformed refused); the
  version pins across both module copies; the in-suite determinism
  greps.
- `tsconfig.json` - byte-for-byte copy of the semantics family's
  scoped strict noEmit shape (sha256-verified equal).
- `README.md` - this binder note.

Evidence label: `fixture` (the suites run on synthetic
`fixture.`-prefixed ids, synthetic provider ids and synthetic epoch
constants only; no authority values, no real providers, models,
endpoints, URLs or keys, no network, no credentials; the ledger tests
run at a caller-injected root under `os.tmpdir()`, outside the repo
tree, cleaned per suite run).

Owner item: INF-006 (TL-B, B2 lane - capability exchange + inference
fabric).

## Laws

Inherited from the landed families (binding, unchanged): THE
OBSERVABILITY LAW, THE NO-HIDDEN-SUBSTITUTION LAW, THE
UNVERIFIED-DEFAULT LAW, HONEST STATES ARE DEFAULTS, THE
DIRECT-ADAPTER LAW, CREDENTIAL REFERENCES ONLY, THE NO-DANGLING-REF
LAW, NO SHARED PUBLIC GATEWAY, determinism, vocabulary-only,
`contractVersion` on every persisted/audited record. New in this
family:

- THE DISCLOSURE LAW (this family's own): match decisions are
  DISCLOSED, never silently substituted. A fallback selection IS a
  substitution and carries the landed `SubstitutionState` vocabulary;
  the matched state is disclosed THROUGH the landed projection
  vocabulary (the derived `InferenceProvenance`, built by the landed
  `unverifiedProvenance` constructor and admitted by the landed
  `admitProvenance`), never a parallel shape. THE TAG-PREFERENCE LAW
  is this kit's reading of it: the request tag, when it names a
  REGISTERED entry, doubles as the caller's DISCLOSED preference -
  honored only when the named entry has an admissible (entry, model)
  pair, and a honored preference that is not the ranked top IS a
  disclosed substitution (`'disclosed'`; requested = the ranked top,
  actual = the selected), never silent. An unknown or inadmissible
  tag is honestly ignored - the pure ranking stands.
- THE PROVENANCE-DERIVATION LAW: provenance is DERIVED from the bound
  records at decision time, never caller-supplied. A caller-supplied
  provenance or substitution label on a match request is the typed
  `caller-supplied-provenance` rejection. Promotion is ONLY the
  landed `markProvenanceVerified` one-way law, exercised BY THE
  CALLER on the returned decision - the kit deliberately exposes no
  promotion mutator and never re-implements the promotion.
- THE INCLUSIVE-BOUNDARY LAW: context-window bounds are INCLUSIVE on
  both ends through the landed `contextWindowContains` (the INF-002
  discipline) - never re-implemented, never widened. A
  boundary-exact request FITS; one off each side is the honest
  too-small / too-large verdict.
- THE DELEGATED BOUNDARY MATH and THE DELEGATED PROVENANCE (as
  above); the kit's only boundary arithmetic is the honest direction
  comparison when the landed predicate says NOT-FITS.
- THE HONEST-UNKNOWN LAW: an entry whose capability descriptor is
  absent/unresolvable is disclosed as the `capability-unknown` row -
  never silently dropped, never fabricated. Unreachable through
  registration (the no-dangling-ref law admits only entries whose
  descriptor resolves); the engine emits it defensively rather than
  dropping an entry.
- THE NO-MATCH TYPED REFUSAL: zero admissible candidates is the typed
  `no-matching-candidate` decision carrying the FULL honest rows -
  never an exception, never a fabricated match (no selection, no
  provenance, no routing binding on the refusal side). A malformed
  request is the typed `request-rejected` outcome (a frozen-list
  reason; fail-closed, never an exception, never appended - a
  rejection is not a decision).
- THE DUPLICATE LAW: at the matrix fold a repeated entry id inside a
  candidate matrix record is `duplicate-match-entry-id`; at the
  registered set a repeated id is the kit-local
  `matching-entry-duplicate` - never a silent overwrite. The contract
  guard runs first: a candidate that is both malformed and a
  duplicate reports the contract reason, never the duplicate.
- THE LEDGER LAW: the append-only JSONL decision ledger at the
  caller-injected root (`matching-decisions.jsonl`) is the family's
  one bounded local-IO surface, ordered by the work item. It is
  DELIVERY EVIDENCE, never an event authority: the engine never
  reads it back; decisions derive from the bound records and the
  injected clock, never from the ledger. Appends are canonical
  `serializeMatchDecision` bytes, one decision per line, in call
  order (append-only: the file grows, earlier lines never change). No
  network I/O; no credential material ever reaches the ledger.
- THE DRIFT FAIL-CLOSED LAW: every decision the engine emits is
  self-checked through the CONTRACT module's `isMatchDecisionRecord`
  guard before it reaches the caller or the ledger - a mismatch fails
  closed as a TypeError, never as a valid-looking record.
- Canonical bytes: fixed-key-order serialization, double-run
  byte-equal; the provenance sub-record mirrors the landed canonical
  provenance key order.
- Zero external dependencies: `node:path` / `node:fs` (the ledger
  law's bounded surface) and the landed sibling families only.

## The deterministic ranking rule

`declaredPriority` ascending, ties by entry id ascending, then by
model id ascending. LOWER priorities rank FIRST (they win); an
undeclared priority rides the honest `0` default (the neutral weight:
undeclared entries rank before entries declaring positive weights and
after entries declaring negative weights). The model-id tie-break is
the byte-stability addition the work item's two named keys require
when one entry's provider offers multiple fitting models. There is
deliberately no quality ranking: ranking candidates by fabricated
weights would be a verdict the bound records never made - the honest
engine ranks deterministically among whatever the verdicts admit, in
the one order every observer can reproduce.

## The substitution-disclosure convention

The provenance's requested side names the ranked top (the selection
the pure capability ranking would serve); the actual side names the
selected candidate. The landed `unverifiedProvenance` constructor
derives the label itself (`'none'` iff the actual selection equals
the requested selection, `'disclosed'` otherwise), and the landed
`admitProvenance` enforces the no-hidden-substitution law on the
result; the contract's decision guard pins the same law structurally
(`'none'` exactly when the selected candidate is the ranked top).
When no tag preference is expressed - or the tag names an unknown or
inadmissible entry - the selection IS the ranked top and the
substitution is `'none'`, never silent.

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values plus the
one bounded ledger surface. No authority seam needs transcription
before the gates run; both suites are green as shipped.

## Future binder note (INF-007..009)

Updated from the routing family's binder note: each binder consumes
the matching surfaces listed here IN ADDITION to the semantics
surfaces (`build/flauz/inference/semantics/README.md`), the catalog
surfaces (`build/flauz/inference/catalog/README.md`), the adapter
surfaces (`build/flauz/inference/adapters/README.md`), the sidecar
surfaces (`build/flauz/inference/sidecar/README.md`) and the routing
surfaces (`build/flauz/inference/routing/README.md`) it already binds.

- INF-007 (credential isolation and provider-term eligibility):
  consumes the MATCH ENTRY's no-credential shape -
  `MatchCandidateDescriptor` carries only `id` / `adapterId` /
  `declaredPriority?` / `contractVersion`: a plain id reference, NO
  credential material, no endpoint, no url. The isolation runtime
  resolves the landed opaque `credentialHandle` THROUGH the entry's
  adapter binding (the `adapterId` the entry names, resolved in the
  bound adapter record) - the matching vocabulary itself binds
  nothing secret, so a match record or ledger line binds nothing
  secret either.
- INF-008 (provenance/capacity/reset UI): consumes the MATCH-DECISION
  LEDGER's provenance/substitution vocabulary - the derived
  `InferenceProvenance` with its landed `SubstitutionState` label
  riding every matched decision, the `serializeMatchDecision`
  canonical bytes as the persistence/audit shape the UI renders, and
  the per-(entry, model) verdict rows (what a user is shown for why a
  candidate did or did not fit: the honest too-small / too-large /
  missing-modality / exceeded-cap verdicts, never a silent drop).
- INF-009 (live-provider acceptance and failure drills): consumes the
  MATCH VERDICT ROWS as the acceptance vocabulary - the frozen
  `MATCH_VERDICTS` values as the typed drill-evidence vocabulary for
  capability-shaped evidence, `admitMatchRequest` /
  `admitMatchCandidate` / `admitMatchMatrix` as the acceptance
  vocabulary for match-shaped evidence, and `serializeMatchDecision`
  as the canonical drill-evidence bytes; evidence labels upgrade
  there - `fixture` here proves vocabulary behavior only.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood
discipline; mocha under bun is the verified runner: Node 24 dropped
the .js-specifier-to-.ts resolution the family test style relies
on):

        bun node_modules/.bin/tsc -p build/flauz/inference/matching/tsconfig.json --noEmit
        bunx --bun mocha --ui tdd 'build/flauz/inference/matching/test/common/*.test.ts'
        grep -nE 'Date\.now|Math\.random|process\.env' build/flauz/inference/matching/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it). The whole-tree variant
(`grep -rn ... build/flauz/inference/matching/`) additionally hits
the suites' own grep-test titles and this README's law text - the
same quoted-ban lines the landed families' trees show.
