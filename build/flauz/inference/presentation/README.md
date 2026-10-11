# Flauz inference presentation contracts (INF-008, Free Inference Fabric)

Typed contract set for the Free Inference Fabric presentation family -
the eighth family: the read-side PROVENANCE / CAPACITY / RESET
projection views over the landed canonical surfaces. THE
NEVER-RE-DERIVE LAW is this family's charter, front and center: every
view is a PROJECTION of the landed canonical surfaces - the ledger
lines parse through the landed `serialize*` canonical bytes (round-trip
byte-equal, cited, never re-derived); the provenance / verification /
substitution / health / capacity-state / reset-class vocabularies are
the landed ones verbatim; NO parallel display vocabulary exists
anywhere in this family. A caller-supplied provenance, substitution,
verification or scope label - any field beyond the landed canonical
shape, at any depth this family reads - is the typed
`caller-supplied-label` rejection: the view's labels are DERIVED from
the landed record, never supplied. THE NEVER-SILENT-EMPTY LAW rides
with it: the refused sides are shown - the unified decision view
carries the selected side AND the refused side with the landed typed
reasons verbatim (the `EligibilityRefused`-class and
`no-routable-candidate`-class refusals project to the "why" views); a
ledger stream projects every line exactly once - a malformed line is
the typed `malformed-ledger-line` refusal outcome, never a silent
drop; honest-unknown states project AS unknown (the stale
fixed-instant reset, the unknown capacity state, the `term-unknown`
verdict) - never fabricated healthy, eligible or future values. Like
the landed INF-001..007 families, this family is pure vocabulary over
injected values plus the two bounded ledger surfaces (the audit
append and the ledger read): no network (live-provider acceptance is
INF-009, never here), no shared public Flauz gateway pooling
third-party free-tier keys, no clock reading (the injected clock
only; a reset countdown view is a pure fold of (schedule, now) through
the landed `nextResetAt`), no randomness, no credential material in
any view, no second authority.

Contract set version: `INFERENCE_PRESENTATION_VERSION = '1.0.0'` -
declared ONCE in `common/presentationContract.ts` (the single version
declaration law), re-carried by `common/presentationKit.ts`
(re-exported; the battery pins both module copies equal). The kit
stamps its views with the re-carried copy while the contract module's
guards check against the contract's copy, and every emitted view is
self-checked through the contract guard before it reaches the caller
or the audit ledger (the drift fail-closed law: a mismatch is a
fail-closed TypeError, never a valid-looking view). The vocabulary
INSIDE the views is the landed families', bound verbatim and never
re-implemented: verification / substitution / health /
capacity-state / reset-class states ride the INF-001 semantics
family's vocabularies (the primary binder, exactly the user-facing
shapes its README names), the decision shapes ride the INF-005
routing family's `RoutingDecision` / `RoutingExhausted` records and
`serializeRoutingDecision` canonical bytes, the INF-006 matching
family's `MatchDecisionRecord` and `serializeMatchDecision` canonical
bytes, and the INF-007 isolation family's
`EligibilityDecisionRecord` and `serializeEligibilityDecision`
canonical bytes; the bound records ride the INF-002 catalog, INF-003
adapter and INF-007 credential-scope-set landed guards. Those landed
sub-records keep their own family version stamps; the presentation
stamp and the landed stamps are distinct roles pinned by the battery.

## Module index (the six delivery paths)

- `common/presentationContract.ts` - the typed presentation contract:
  `INFERENCE_PRESENTATION_VERSION` (the single declaration),
  `PRESENTATION_REJECTION_REASONS` (the frozen eight, in the exact
  list order - `not-an-object`, `unknown-decision-family`,
  `caller-supplied-label` (THE NEVER-RE-DERIVE LAW's own reason),
  `shape-law-violation` (the landed guards' rejections and the walk
  input-shape laws), `unresolved-ledger-line`,
  `malformed-ledger-line`, `unresolved-decision-record`,
  `unresolved-adapter-binding` (the three NO-DANGLING-REF reasons);
  each projection walk applies its applicable subset in the list
  order and the first failure is the verdict),
  `PRESENTATION_DECISION_FAMILIES` (routing / matching / isolation -
  the landed landing order and the ledger admission order) +
  `DECISION_VIEW_SIDES` (selected / refused - the unified fold), the
  view types (`ProvenanceView`: the landed `InferenceProvenance`
  projected with the verification state, the substitution label and
  the scope label - the landed record's own actual model field
  carried VERBATIM, pinned structurally by the guard
  (`scopeLabel === actualModelId`), the landed probe-scope
  conventions (`ROUTING_PROBE_SCOPE` /
  `ISOLATION_ELIGIBILITY_PROBE_SCOPE`) ride exactly that field;
  `ResetExpectationView`: the pure fold of (the landed
  `ResetSchedule`, an injected now) - the landed `RESET_SCHEDULE_KINDS`
  class carried verbatim (the honest `'unknown'` class for a
  malformed or non-member schedule) plus the landed `nextResetAt`
  expectation fold with its inclusive boundary law and its
  stale-reset law (a fixed-instant reset in the past projects the
  honest `'unknown'` EXPECTATION - never a fabricated future);
  `CapacityView`: the landed `ProviderCapacityDisclosure` projected -
  health, quota, cooldown and reset over the landed vocabulary ONLY,
  the cooldown verdict being the landed disclosed capacity state's
  own `'cooldown'` membership (the inclusive-boundary fold happened
  upstream through the landed `projectCapacityDisclosure`, never
  re-computed here; the guard pins the fold structurally); the
  `DecisionView`: the unified read-side projection over the landed
  decision surfaces - the selected side AND the refused side with the
  typed reasons verbatim; `LedgerLineView`: the parsed projection of
  one ledger line - the canonical bytes parsed through the LANDED
  serializer's own shape) + the `PresentationOutcome` /
  `LedgerLineOutcome` unions (typed refusals, never exceptions),
  `serializePresentationRecord` (canonical fixed-key-order bytes per
  view kind, double-run byte-equal; refuses non-views fail-closed),
  and the shape guards `isProvenanceView` / `isCapacityView` /
  `isResetExpectationView` / `isDecisionView` / `isLedgerLineView`
  (each pins the projection laws STRUCTURALLY: the landed vocabulary
  memberships, the exact own-field sets (no parallel display
  vocabulary is representable), the scope-label derivation pin, the
  cooldown-fold pin, the landed known-expectation basis pins, the
  refused-side nothing-is-fabricated pins, the line/family agreement
  pin; `isProvenanceView` additionally pins the landed
  no-hidden-substitution law structurally). The module also exports
  the landed-field whitelists (`LANDED_PROVENANCE_FIELDS`,
  `LANDED_DISCLOSURE_FIELDS`, `LANDED_DECISION_FIELDS`) the
  caller-supplied-label walks ride.
- `common/presentationKit.ts` - the deterministic injected-clock kit:
  `createPresentationKit(options)` (the fail-closed factory: the
  options shape - `now` a function, the caller-injected `ledgerRoot`
  a non-empty string - the bound catalog through the LANDED
  `admitCatalogRecord`, the bound adapter record through the LANDED
  `admitProviderAdapterRecord` with the catalog, the bound credential
  scope set through the LANDED `admitCredentialScopeSet` with both
  (REQUIRED by the no-dangling-ref law's scope-binding resolution;
  the honest EMPTY set is a legal binding), the audit root an
  existing directory, and ONE clock validation read),
  `projectProvenance(record)` / `projectCapacity(disclosure)` (the
  pure folds through the landed guards - the landed `admitProvenance`
  / `isProviderCapacityDisclosure` the ONLY shape authorities, their
  rejections cited verbatim; zero clock reads),
  `projectReset(schedule)` (the pure fold of (schedule, the injected
  now) through the LANDED `nextResetAt` - one clock read per
  projection; the honest unknown everywhere a reset is not known),
  `projectDecision(decisionRecord)` (the unified decision walk: the
  landed kind/shape discrimination, the caller-supplied-label
  whitelist per discriminated shape, the landed guards - the routing
  exhausted outcome rides a cited mirror of the landed
  `RoutingExhausted` type over the LANDED attempt vocabularies, the
  landed family exporting no outcome guard - then the binding checks
  against the bound records; both sides, the reasons verbatim; zero
  clock reads), `readLedger(path, line)` (the canonical-bytes parse:
  the input shapes, the ledger surface resolution, then the LANDED
  serializer round-trip - the byte comparison IS the parse - then the
  decision projection's binding checks; zero clock reads),
  `projectLedger(lines)` (the full stream projection: every line
  exactly once, the malformed lines the typed refusal outcomes,
  never a silent drop), `snapshot()` (the kit state fold - the audit
  shape: the counters, the sorted bound-ids disclosure, one clock
  read), `recordViewAudit(view)` (THE LEDGER LAW: append-only JSONL
  at `{ledgerRoot}/presentation-audits.jsonl` - the constant
  `PRESENTATION_AUDITS_LEDGER_FILE`; canonical
  `serializePresentationRecord` bytes, one view per line, in call
  order; delivery evidence, never an event authority), and the
  disclosed fixture ids `FIXTURE_VIEW_HEALTHY_ID` /
  `FIXTURE_VIEW_REFUSED_ID` / `FIXTURE_VIEW_UNKNOWN_RESET_ID`
  (evidence label `fixture`; the kit does NOT pre-bind them - the
  battery binds the three fixture adapters at these ids against its
  fixture bound records).
- `test/common/presentationContract.test.ts` - mocha tdd suite (66
  tests): the version roles; every frozen vocabulary pinned exact
  (the rejection reasons, the families, the sides); every shape
  guard from both directions (the landed vocabulary memberships, the
  scope-label derivation pin, the no-parallel-vocabulary extra-field
  pins, the cooldown-fold pin, the landed known-expectation basis
  pins, the refused-side nothing-is-fabricated pins, the
  line/family agreement pin, the no-hidden-substitution pin); the
  canonical bytes (every view kind's exact byte string pinned,
  double-run byte-equality, key-insertion-order independence incl.
  the nested records, fail-closed refusal); the in-suite
  determinism greps (law comments only).
- `test/common/presentationKit.test.ts` - mocha tdd suite (98
  tests): the fail-closed factory (every landed guard citation, the
  empty-scope-set law, the ledger-root and clock laws incl. the
  counting-clock one-read pin); the provenance fold (every landed
  field verbatim, the probe-scope conventions, the
  caller-supplied-label rejections, the landed reason citations,
  purity, zero clock reads); the capacity fold (the inclusive
  cooldown boundaries END-TO-END through the landed
  `projectCapacityDisclosure` chain - exactly at `untilEpochMs`
  active, one past it not; the honest unknown quota; the
  caller-supplied labels at both depths; zero clock reads); the
  reset fold (the inclusive boundaries, the stale-reset unknown -
  never a fabricated future, the interval-aligned folds, the
  honest unknown classes for malformed schedules, one clock read
  per projection, the non-finite fails-closed probe); the unified
  decision fold (the landed routing / matching / isolation decision
  records produced END-TO-END through the LANDED kits over the same
  fixture records; every refusal side with its typed reasons
  verbatim - the honest empty reasons over zero admitted candidates
  included; every frozen reason firing incl. the
  caller-supplied-label on each refusal shape, the
  unknown-decision-family probes, the landed guard citations, the
  three dangling-binding rejections; zero clock reads); the
  ledger-line reader (the landed canonical bytes of all three
  families parsing to their family views, the round-trip law over a
  shuffled-key line, the malformed / unresolvable line probes, the
  dangling-binding lines, the input-shape law); the ledger stream
  fold (every line exactly once, the empty-line refusal outcome,
  the input-shape law); the kit state fold (the counters, the
  sorted bound ids, the clock laws); the append-only audit ledger
  (canonical bytes in call order, every view kind, the fail-closed
  refusal, the append-only pin); the fixture ids; the in-suite
  determinism greps.
- `tsconfig.json` - byte-for-byte copy of the semantics family's
  scoped strict noEmit shape (sha256-verified equal).
- `README.md` - this binder note.

Evidence label: `fixture` (the suites run on synthetic
`fixture.`-prefixed ids, synthetic provider ids, synthetic opaque
credential-handle reference ids and synthetic epoch constants only;
no authority values, no real providers, adapters, endpoints, URLs or
keys, no network, no credentials, no secret material anywhere - only
typed references). The ledger and audit tests additionally execute
REAL local filesystem operations at caller-injected roots under
`os.tmpdir()`, outside the repo tree, cleaned per suite run
(`local-real` filesystem evidence; the record values themselves stay
synthetic fixtures).

Owner item: INF-008 (TL-B, B2 lane - capability exchange + inference
fabric).

## Laws

Inherited from the landed families (binding, unchanged): THE
OBSERVABILITY LAW, THE NO-HIDDEN-SUBSTITUTION LAW (pinned
structurally in `isProvenanceView`), THE UNVERIFIED-DEFAULT LAW, THE
HONEST-UNKNOWN ELIGIBILITY LAW (surfaced verbatim: a `term-unknown`
verdict projects as decided, never fabricated eligible), THE
INJECTED-CLOCK LAW, THE DELEGATED BOUNDARY MATH (the reset and
cooldown boundary verdicts ride the landed `nextResetAt` /
`projectCapacityDisclosure` folds, never re-implemented), THE
DELEGATED PROMOTION (the landed `markProvenanceVerified` /
`markEntryMetadataVerified` one-way promotions are the callers'; this
family carries states verbatim and exposes no promotion surface),
CREDENTIAL REFERENCES ONLY, THE NO-DANGLING-REF LAW, NO SHARED PUBLIC
GATEWAY, determinism, vocabulary-only, `contractVersion` on every
persisted/audited view. New in this family:

- THE NEVER-RE-DERIVE LAW (this family's charter): every view is a
  PROJECTION of the landed canonical surfaces. The
  provenance/verification/substitution vocabularies are the landed
  ones verbatim; NO parallel display vocabulary exists (the shape
  guards pin the exact own-field sets - an extra display-label field
  is not a view, at the shape level, at the fold level and at the
  byte level). The provenance view's scope label IS the landed
  record's own actual model field carried verbatim (the landed
  probe-scope conventions ride exactly that field; the guard pins
  `scopeLabel === actualModelId` structurally). The capacity view's
  cooldown verdict is the landed disclosed capacity state's own
  `'cooldown'` membership - the inclusive-boundary fold happened
  upstream through the landed projection, never re-computed here
  (the guard pins the fold structurally). A caller-supplied
  provenance, substitution, verification or scope label - any field
  beyond the landed canonical shape, at any depth this family reads
  (a decision's nested provenance included) - is the typed
  `caller-supplied-label` rejection: derived, never caller-supplied.
- THE CANONICAL-BYTES LAW: a ledger line parses through the LANDED
  serializer's own canonical bytes. The parsed record must admit
  under a landed decision guard (`isRoutingDecision` /
  `isMatchDecisionRecord` / `isEligibilityDecisionRecord`, tried in
  the frozen family order) AND round-trip byte-equal through the
  landed `serializeRoutingDecision` / `serializeMatchDecision` /
  `serializeEligibilityDecision` - the byte comparison IS the parse,
  cited, never re-derived. A line that is not the landed canonical
  byte form (unparseable bytes, a record no landed guard admits, a
  shuffled-key record whose round-trip differs) is the typed
  `malformed-ledger-line` rejection - never a silent drop, never a
  re-serialized stand-in.
- THE NEVER-SILENT-EMPTY LAW: the refused sides are shown. The
  unified decision view carries the selected side AND the refused
  side; the `EligibilityRefused`-class and `no-routable-candidate`-
  class refusals project to the "why" views with their typed reasons
  verbatim (the routing attempt ledger's own reasons in ledger
  order, the matching verdict rows' own verdict values in row order,
  the isolation refusal's own typed detail) - honestly empty exactly
  when the landed refusal honestly carried nothing (a routing set
  with zero admitted candidates). A ledger stream projects every
  line exactly once: a malformed line is the typed refusal outcome
  included in the stream, never a silent drop. The refused side
  carries no provenance and no single selected adapter binding (the
  landed `'none'` absence marker) - nothing is fabricated - and the
  guard pins both pins structurally.
- THE STALE-RESET LAW (the INF-001 law, surfaced as the view): a
  fixed-instant reset in the past projects the honest `'unknown'`
  EXPECTATION through the landed `nextResetAt` - never a fabricated
  future. The reset class still names what the landed schedule IS
  (the kind carried verbatim); the expectation is the honest fold.
  A known expectation's basis is the schedule's own class and
  originates from a known-producing class only (`fixed-instant` /
  `interval-aligned`) - the landed fold laws pinned structurally by
  the guard.
- THE NO-DANGLING-REF LAW (extended to presentation): every view's
  source binding resolves against the BOUND record surface - a
  decision's adapter binding (its own, the selected candidate's, or
  a refused row's / ledger entry's `adapterId`) resolves in the
  bound adapter record; an isolation decision's scope binding
  resolves in the bound credential scope set AND agrees with the
  decision's adapter binding (a cross-inconsistent reference is a
  typed rejection); a ledger line index resolves in the bound ledger
  file - or projection is the typed `unresolved-*` rejection, never
  a silent dangling ref. The bound records arrive as unknown at the
  runtime boundary and are validated through the LANDED guards at
  creation (the landed binding laws cited verbatim in the
  TypeErrors, never re-implemented).
- THE LEDGER LAW: the append-only JSONL view-audit ledger at the
  caller-injected root (`presentation-audits.jsonl`) is the family's
  one bounded write surface. It is DELIVERY EVIDENCE, never an event
  authority: the kit never reads it back; views derive from the
  landed records and the injected clock, never from the audit
  ledger. Appends are canonical `serializePresentationRecord` bytes,
  one view per line, in call order (append-only: the file grows,
  earlier lines never change). `readLedger` is the family's one
  bounded read surface, over a caller-injected ledger file, parsed
  through the LANDED canonical bytes. No network I/O; no credential
  material ever reaches a view or a ledger.
- THE TYPED REFUSAL, NEVER AN EXCEPTION: the projection walks refuse
  through the frozen `PRESENTATION_REJECTION_REASONS` list, each
  walk's applicable subset walked in the list order, the first
  failure THE verdict. The only TypeErrors this family throws are
  the landed factory idiom's own (a malformed options shape, a
  non-finite injected clock read, a dishonest view at the audit /
  serialization boundary, a drift between the kit and contract
  version copies) - never a projection verdict.
- THE PURE FOLDS: `projectProvenance`, `projectCapacity`,
  `projectDecision`, `readLedger` and `projectLedger` read NO clock
  at all; `projectReset` reads exactly one per projection; the
  creation validation reads exactly one; `snapshot` reads exactly
  one per fold. The clock is INJECTED (`{ now }`) - a reset
  countdown view is a pure fold of (schedule, now), never a hidden
  clock read.
- Canonical bytes: `serializePresentationRecord` emits
  fixed-key-order deterministic bytes per view kind (double-run
  byte-equal, key-insertion-order independent, the nested records
  canonicalized, the reasons array the projection's own landed order
  preserved verbatim); every view carries `contractVersion`.
- Zero external dependencies: `node:path` / `node:fs` (the ledger
  law's bounded surfaces) and the landed sibling families only.

## The unified decision fold convention

`projectDecision(decisionRecord)` accepts the landed decision
surfaces: the routing `RoutingDecision` (the selected side - its
disclosed capacity state is the user-facing label) and
`RoutingExhausted` (the `no-routable-candidate`-class refusal - the
attempt ledger's own reasons in ledger order), the matching
`MatchDecisionRecord` both sides (the matched side's substitution
label; the no-match side's verdict-row values in row order), and the
isolation `EligibilityDecisionRecord` both sides (the decided side's
verdict - `eligible`, `ineligible` or the honest `term-unknown`, a
DECIDED disclosure carried verbatim whatever it is, never a
fabricated eligibility; the `no-eligible-binding` refusal's own
typed detail). The landed guards are the ONLY shape authorities; the
routing exhausted outcome rides a cited mirror of the landed type
over the LANDED attempt vocabularies (the landed family exports no
outcome guard). Every adapter binding the record carries resolves in
the bound adapter record; every isolation scope binding resolves in
the bound credential scope set and agrees with the decision's
adapter binding. The routing outcome wrappers (`RoutingSelected`,
`FailoverSucceeded`) are not decision records - the decision surface
is the decision itself; the exhausted refusal class is the
exception, being the no-routable-candidate disclosure a user must
see.

## The reset countdown convention

`projectReset(schedule)` reads the injected clock ONCE and folds the
landed `nextResetAt` over (schedule, now): the reset class is the
landed schedule's own kind through the landed `RESET_SCHEDULE_KINDS`
membership (the honest `'unknown'` class for a malformed or
non-member schedule - never a fabricated class); the expectation is
the landed fold with its INCLUSIVE boundary law (a probe exactly at
a reset instant names that instant) and its stale-reset law (a
fixed-instant reset in the past projects the honest `'unknown'`
EXPECTATION - never a fabricated future); a known expectation's
basis is the schedule's own class - the landed
`projectCapacityDisclosure` fold mirrored verbatim.

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values plus the
two bounded ledger surfaces. No authority seam needs transcription
before the gates run; both suites are green as shipped.

## Verification receipts (executed at the delivery commit)

| receipt | command | verdict |
| --- | --- | --- |
| scoped tsc | `bunx tsc -p build/flauz/inference/presentation/tsconfig.json --noEmit` | EXIT 0 |
| contract battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/presentation/test/common/presentationContract.test.ts'` | 66 passing / 0 failing / 0 pending |
| kit battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/presentation/test/common/presentationKit.test.ts'` | 98 passing / 0 failing / 0 pending |
| whole battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/presentation/test/common/*.test.ts'` | 164 passing / 0 failing / 0 pending |
| isolation regression (the landed 121) | `bunx --bun mocha --ui tdd 'build/flauz/inference/isolation/test/common/*.test.ts'` | 121 passing / 0 failing |
| matching regression (the landed 116) | `bunx --bun mocha --ui tdd 'build/flauz/inference/matching/test/common/*.test.ts'` | 116 passing / 0 failing |
| determinism grep (shipped code) | `grep -n 'Date\.now\|Math\.random\|process\.env' common/*.ts` | 3 hit lines, all law-comments |
| determinism grep (whole subtree) | `grep -rn 'Date\.now\|Math\.random\|process\.env' build/flauz/inference/presentation/` | 7 hits: the 3 law-comments + the 4 in-suite grep-test titles (the landed families' documented whole-tree pattern) |
| additive proof | `git status --porcelain` + `git diff --stat 2f4c39a6..HEAD` | only new paths under `build/flauz/inference/presentation/**`; 6 files, 4460 insertions, 0 deletions |
| tsconfig parity | `sha256sum` both copies | MATCH (byte-identical to the semantics family's) |
| fails-on-base | overlay ONLY the two test files onto a pristine `2f4c39a6` worktree, run the battery | FAILED as required (module not found, mocha exit 1) |

Evidence labels: the suites run on synthetic `fixture.` values; the
ledger / audit suites additionally execute `local-real` filesystem
operations at caller-injected roots under `os.tmpdir()`, outside the
repo tree, cleaned per suite run.

## Future binder note (INF-009)

Updated from the isolation family's binder note: the INF-009 binder
consumes the PRESENTATION surfaces listed here IN ADDITION to the
semantics surfaces (`build/flauz/inference/semantics/README.md`),
the catalog surfaces (`build/flauz/inference/catalog/README.md`),
the adapter surfaces (`build/flauz/inference/adapters/README.md`),
the sidecar surfaces (`build/flauz/inference/sidecar/README.md`),
the routing surfaces (`build/flauz/inference/routing/README.md`),
the matching surfaces (`build/flauz/inference/matching/README.md`)
and the isolation surfaces
(`build/flauz/inference/isolation/README.md`) it already binds.

- INF-009 (live-provider acceptance and failure drills): consumes
  the PRESENTATION surfaces as the read-side acceptance vocabulary -
  `ProvenanceView` / `CapacityView` / `ResetExpectationView` /
  `DecisionView` / `LedgerLineView` as the typed drill-evidence
  shapes for presentation-shaped evidence (the refused sides and
  the honest-unknown states included - a drill may honestly produce
  a refusal view or an unknown reset expectation), the frozen
  `PRESENTATION_REJECTION_REASONS` values as the typed
  drill-evidence refusal vocabulary, `PRESENTATION_DECISION_FAMILIES`
  + `DECISION_VIEW_SIDES` as the family/side discriminators of
  drill evidence, `serializePresentationRecord` as the canonical
  drill-evidence bytes (fixed key order, double-run byte-equal), the
  shape guards `isProvenanceView` / `isCapacityView` /
  `isResetExpectationView` / `isDecisionView` / `isLedgerLineView`
  as the acceptance vocabulary for view-shaped evidence, and the
  kit's `presentation-audits.jsonl` append surface as the
  delivery-evidence stream the drills may cite (never an event
  authority); evidence labels upgrade there - `fixture` here proves
  vocabulary behavior only. The live-provider network surface itself
  is INF-009's own item, never this family's.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood
discipline; mocha under bun is the verified runner: Node 24 dropped
the .js-specifier-to-.ts resolution the family test style relies
on):

        bunx tsc -p build/flauz/inference/presentation/tsconfig.json --noEmit
        bunx --bun mocha --ui tdd 'build/flauz/inference/presentation/test/common/*.test.ts'
        grep -rn 'Date\.now\|Math\.random\|process\.env' build/flauz/inference/presentation/

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it). The whole-tree variant additionally
hits the suites' own grep-test titles and this README's law text -
the same quoted-ban lines the landed families' trees show.
