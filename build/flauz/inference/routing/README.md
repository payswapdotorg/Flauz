# Flauz inference routing contracts (INF-005, Free Inference Fabric)

Typed contract set for the Free Inference Fabric routing family - the
fifth family: the closed **health/quota/cooldown/retry/failover
routing** vocabulary and its deterministic kit. The family routes
among ADMITTED candidates by adapter id and observed capacity state
ONLY (capability/context-window matching is INF-006's item - the
INF-006 scope boundary is a binding law here): the fail-closed kit
factory over the bound adapter record, candidate admission through
the frozen rejection walk, the deterministic disclosed selection with
the honest attempt ledger, the optional-sidecar state resolution, the
honest no-observation candidate fold, the kit state fold with its
canonical bytes, and the bounded retry/failover engine over
caller-injected effect thunks (the engine never performs IO). Like
the landed INF-001..004 families, this family is PURE VOCABULARY over
injected values: no network, no fetch, no storage, no credential
material, no clock reading, no randomness, no second authority.

Contract set version: `INFERENCE_ROUTING_VERSION = '1.0.0'` - declared
ONCE in `common/routingContract.ts`, re-carried by
`common/routingKit.ts` (re-exported + the independent literal copy
`ROUTING_KIT_VERSION`, the COMMAND_FACADE zero-dependency idiom; the
test suite pins all copies equal). The kit stamps ITS records with
the kit's literal copy while the contract module's guards check
against the contract's copy - a drift fails closed inside the kit
(route's isRoutingDecision self-check; serializeRoutingRecord's
refusal), never at a caller's boundary. The vocabulary INSIDE the
records is the landed families', bound verbatim and never
re-implemented: capacity disclosures are the INF-001 semantics
family's `ProviderCapacityDisclosure` (THROUGH the landed
`projectCapacityDisclosure` projection), reports are the INF-003
adapter family's `ProviderAdapterHealthReport` (admitted through the
landed `isAdapterHealthReport`), the adapter-record binding rides the
landed `admitProviderAdapterRecord` (which validates the INF-002
catalog binding and every provider-entry resolution), and the
optional sidecar is the INF-004 family's `SidecarKit`
`reportSnapshot` fold (type-only import - never a required input).
Those sub-records keep their own family version stamps; the routing
stamp and the semantics/adapter stamps are distinct roles pinned by
the suite.

## Module index (the six delivery paths)

- `common/routingContract.ts` - the typed routing contract:
  `INFERENCE_ROUTING_VERSION`, `RoutingCandidate` (`{ adapterId,
  report }` - the report is a landed `ProviderAdapterHealthReport` or
  the honest all-unknown fold; a report naming another adapter is
  misattributed and never well-formed), `ROUTING_REJECTION_REASONS`
  (the frozen six, in the exact check order: `not-an-object`,
  `adapter-id-empty`, `adapter-report-malformed`,
  `routing-unknown-adapter`, `adapter-report-misattributed`,
  `routing-candidate-duplicate`), `RoutingAdmitted` /
  `RoutingRejected` / `RoutingAdmission`,
  `ROUTING_SELECTION_RULES` (the closed one-member set:
  `'stable-adapter-id-order'`), `RoutingDecision` (the chosen
  candidate + the DISCLOSED state riding the landed
  `ProviderCapacityDisclosure` verbatim; decidedAtEpochMs must equal
  the disclosure's generatedAtEpochMs - one decision, one time),
  `serializeRoutingDecision` (canonical fixed-key-order bytes; the
  disclosure sub-record is the LANDED
  `serializeCapacityDisclosure` output embedded verbatim - this
  family never re-implements the disclosure's key order; refuses
  non-admitted decisions fail-closed), `isRoutingCandidate` /
  `isRoutingDecision` (the shape guards, both directions),
  `ROUTING_ATTEMPT_OUTCOMES` (the frozen six ledger outcomes) +
  `ROUTING_ATTEMPT_REASONS` (`'none'`, the landed `COOLDOWN_REASONS`
  verbatim, `'attempt-failed'`) + `RoutingAttempt` (the four-field
  honest ledger line: candidate, injected ts, outcome, reason),
  `RoutingSelected` / `RoutingExhausted` / `RoutingOutcome`,
  `ATTEMPT_OUTCOME_KINDS` (`'succeeded' | 'failed'` - the thunk
  verdict), `RetryPolicy` (per-candidate `maxAttempts` + the
  caller-injected `backoffScheduleMs` of exactly maxAttempts-1 finite
  non-negative delays), `FAILOVER_REJECTION_REASONS` (the frozen
  four, in the validation order) and the `FailoverOutcome` union
  (`'succeeded' | 'exhausted' | 'rejected'`; exhausted carries the
  full attempt ledger with the per-candidate reasons).
- `common/routingKit.ts` - the deterministic kit (with the
  retry/failover engine FOLDED IN, the prompt's documented fold that
  keeps the family at six paths): `createRoutingKit(options)` (the
  fail-closed factory: options shape, the adapter record through the
  LANDED `admitProviderAdapterRecord` with the bound catalog - the
  landed reasons cited verbatim in the TypeError - the optional
  sidecar's structural shape, and ONE clock validation read),
  `addCandidate` (the frozen admission walk: shape checks first, then
  the no-dangling-ref resolution, then the provider attribution, then
  the duplicate - THE DUPLICATE LAW, never a silent overwrite),
  `route({ at })` (the disclosed deterministic selection at an
  injected instant; cooldown-active candidates are skipped and
  recorded honestly in the attempt ledger - never silently; zero
  eligible candidates is the typed `RoutingExhausted` carrying the
  FULL ledger), `runWithFailover({ attempt, policy, at })` (the
  bounded retry/failover engine over the caller-injected effect
  thunk), `reportSnapshot()` (the kit's own state fold - what the
  INF-008 UI layer reads), `unknownCandidate(adapterId)` (THE
  NO-FABRICATION fold: the landed `reportAdapterSnapshot` over an
  all-unknown observation riding the landed `unknownSnapshot`
  defaults with an unverified scope-labeled provenance),
  `serializeRoutingRecord` (canonical fixed-key-order bytes for the
  kit's audit record; the snapshot sub-records mirror the landed
  adapter family's canonical key order - cited, never re-derived),
  `count()` / `list()` (sorted, stable, verbatim reports),
  `ROUTING_PROBE_SCOPE` (the scope-label convention below),
  `ROUTING_KIT_VERSION` + the `INFERENCE_ROUTING_VERSION` re-export
  (the COMMAND_FACADE copies).
- `test/common/routingContract.test.ts` - mocha tdd suite (36 tests):
  the version roles; every frozen vocabulary pinned exact (contents,
  order, uniqueness); both shape guards from BOTH directions
  (well-formed admits incl. the honest all-unknown report;
  non-objects, empty ids, malformed/misattributed reports, version
  mismatches, the one-decision-one-time pin);
  `serializeRoutingDecision` canonical bytes (double-run equality,
  key-insertion-order independence, the disclosure sub-record equal
  to the LANDED serializer's output, the fixed key order, the
  honest-unknown bytes, fail-closed refusal); the in-suite
  determinism greps (law comments only).
- `test/common/routingKit.test.ts` - mocha tdd suite (76 tests): the
  fail-closed factory (malformed options/clock/adapter record/catalog
  with the landed reasons cited, dangling refs, malformed sidecar);
  every frozen rejection reason firing from BOTH sides (valid admits
  / invalid rejects, contract-first ordering, no mutation on
  rejection); route's disclosed selection (the projection equality,
  NO-FABRICATION end-to-end, stable-adapter-id-order regardless of
  insertion order, the ledger shapes); the cooldown/quota gates with
  the INCLUSIVE boundary math pinned at the boundaries (exactly-on at
  since/until/windowStart/windowEnd, exactly-off one past each; the
  landed `cooldownActive` / `quotaWindowContains` cited as the
  authority); the honest exhaustion legs (the FULL ledger, the honest
  empty ledger); the optional-sidecar law end-to-end (never required;
  serving-provider override; the no-state unknownSnapshot; unserved
  providers; the malformed-state fail-closed propagation);
  `unknownCandidate` (the landed folds, the delegated promotion
  pinned literally against the landed `markReportVerified` /
  `markProvenanceVerified`, the kit never self-promotes);
  `runWithFailover` (every frozen rejection reason; the deterministic
  retry arithmetic, per-candidate budgets, immediate failover, the
  cooldown re-gate on retries, zero-eligible exhaustion with the
  thunk never called, double-run determinism); `reportSnapshot` (the
  honest rows, the sidecar-served rows, fail-closed malformed
  states); `serializeRoutingRecord` canonical bytes; count/list; the
  COMMAND_FACADE version pins; the in-suite determinism greps.
- `tsconfig.json` - byte-for-byte copy of the semantics family's
  scoped strict noEmit shape (sha256-verified equal).
- `README.md` - this binder note.

Evidence label: `fixture` (the suites run on synthetic
`fixture.`-prefixed ids, synthetic provider ids and synthetic epoch
constants only; no authority values, no real providers, models,
endpoints, URLs or keys, no network, no storage, no credentials).

Owner item: INF-005 (TL-B, B2 lane - capability exchange + inference
fabric).

## Laws

Inherited from the landed families (binding, unchanged): THE
OBSERVABILITY LAW, THE NO-HIDDEN-SUBSTITUTION LAW, THE
UNVERIFIED-DEFAULT LAW, HONEST STATES ARE DEFAULTS, THE
DIRECT-ADAPTER LAW, CREDENTIAL REFERENCES ONLY, THE
NO-DANGLING-REF LAW, NO SHARED PUBLIC GATEWAY, determinism,
vocabulary-only, `contractVersion` on every persisted/audited record.
New in this family:

- THE INJECTED-CLOCK LAW: no `Date.now`, no `Math.random`, no
  `process.env` in `common/**` (law comments excepted; the suites
  grep the sources in-process and pin it). Every timestamp comes from
  the injected `now()` (folds) or the caller-injected probe instants
  (route at, failover at); the factory validates the clock with one
  creation read.
- THE NO-FABRICATION LAW: a candidate with no observation rides the
  landed `unknownSnapshot` honest defaults through
  `unknownCandidate` - health `unknown`, quota `unknown`, never a
  silently fabricated `healthy` state. UNKNOWN is first-class and
  ELIGIBLE: an unknown candidate routes and its decision DISCLOSES
  the honest-unknown states. Symmetrically, the router never
  fabricates a BAD verdict from stale data (a zero remaining outside
  its window is disclosed as-is, not gated).
- DISCLOSURE THROUGH THE PROJECTION: routing decisions disclose
  THROUGH the landed `ProviderCapacityDisclosure` projection -
  never around it, never a parallel disclosure shape. The serializer
  embeds the landed disclosure bytes verbatim.
- FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT: every
  admission/decision rejection is a typed member of a frozen closed
  list in the exact check order (`ROUTING_REJECTION_REASONS`,
  `FAILOVER_REJECTION_REASONS`); every rejection names its reason.
- THE DELEGATED BOUNDARY MATH: the cooldown gate rides the landed
  `cooldownActive` and the quota gate the landed
  `quotaWindowContains`, INCLUSIVE boundaries verbatim - never
  re-implemented. The cooldown gate is the authority on ACTIVE (a
  stale `cooldown` health label with no active interval does not
  gate); the quota gate trips only on a KNOWN quota at zero
  remaining INSIDE its inclusive window.
- THE DELEGATED PROMOTION: one-way verification promotion belongs to
  the landed `markProvenanceVerified` / `markReportVerified` - the
  routing family exposes NO promotion surface; the caller exercises
  the landed promotions on the candidate's report.
- THE OPTIONAL-SIDECAR LAW: the router MAY read an OPTIONAL sidecar's
  `reportSnapshot` fold; a sidecar is never a required input. When a
  bound sidecar SERVES a candidate's provider, its fold IS the
  effective observed state (its no-state default is the landed
  `unknownSnapshot` - the router sees unknown); when no sidecar
  record serves the provider, the candidate's own report drives. The
  sidecar is read ONCE per routing call; its fail-closed folds
  (malformed/misattributed attached state) propagate as TypeError -
  never swallowed.
- THE DUPLICATE LAW: a repeated adapterId is the typed
  `routing-candidate-duplicate` rejection; the shape checks run
  first (a malformed duplicate reports the shape reason); never a
  silent overwrite.
- THE HONEST LEDGER: every candidate appears exactly once in the
  scan ledger (eligible/selected/skipped-cooldown/skipped-quota);
  `RoutingExhausted` carries the FULL ledger; the failover engine
  adds one line per thunk call and per re-gate trip. Never a silent
  skip, never a silent empty.
- Canonical bytes: fixed-key-order serialization, double-run
  byte-equal; every audit shape carries `contractVersion`; nested
  ledger lines are stamped by their enclosing outcome (the landed
  nested-record idiom).
- Zero external dependencies: node: builtins and the landed sibling
  families only (semantics, adapters, sidecar - the sidecar
  type-only).

## The deterministic selection rule

`stable-adapter-id-order`: among eligible candidates, the first in
ascending adapterId (lexicographic) order is selected. The rule is
DISCLOSED on every decision (`selectionRule`) and in its canonical
bytes. There is deliberately no quality ranking: ranking candidates
by fabricated weights would be a verdict the observations never made
- the honest router selects deterministically among whatever the
gates admit, in the one order every observer can reproduce.

## The provenance scope-label convention

The routing candidate is adapter/provider-scoped; the honest
no-observation fold carries no model ids, so `unknownCandidate`'s
folded provenance names the disclosed scope label
`ROUTING_PROBE_SCOPE = 'routing.capacity-probe'` in the model fields
(a scope label, never a model claim - mirroring the sidecar family's
`SIDECAR_CAPACITY_REPORT_SCOPE` convention). Candidates built from
real observations carry the report's own provenance verbatim.

## The retry/failover engine semantics

`maxAttempts` is the PER-CANDIDATE attempt bound; `backoffScheduleMs`
is the caller's injected schedule of exactly maxAttempts-1 finite
non-negative delays (the engine performs no hidden exponential
arithmetic). The first attempt of the first eligible candidate
happens at the injected `at`; after failure i the engine's time
advances by delay i and the retry is RE-GATED (cooldown/quota, the
landed boundary math) at that computed instant - a gate trip ends
the candidate's budget with an honest skip line and fails over
IMMEDIATELY (the schedule spaces retries, not failovers; the engine
never defers a candidate for later reconsideration). The engine
never performs IO: the caller-injected effect thunk is the only thing
that attempts; its `'succeeded' | 'failed'` verdict is the router's
only knowledge of the attempt (the `'attempt-failed'` ledger reason
is the honest extent of that knowledge).

## Repo-side completion (before running the gates)

None: this family is pure vocabulary over injected values. No
authority seam needs transcription before the gates run; both suites
are green as shipped.

## Future binder note (INF-006..009)

Updated from the sidecar family's binder note: each binder consumes
the routing surfaces listed here IN ADDITION to the semantics
surfaces (`build/flauz/inference/semantics/README.md`), the catalog
surfaces (`build/flauz/inference/catalog/README.md`), the adapter
surfaces (`build/flauz/inference/adapters/README.md`) and the sidecar
surfaces (`build/flauz/inference/sidecar/README.md`) it already
binds.

- INF-006 (context-window/capability matching): consumes the DECISION
  and DISCLOSED vocabulary - `RoutingDecision` / `ProviderCapacityDisclosure`
  riding it (match decisions are disclosed, never silently
  substituted), `ROUTING_SELECTION_RULES` (the disclosed selection
  its matcher ranks within or above) and the decision's `adapterId`
  (the candidate whose capability matrix the matcher walks through
  the adapter's `providerEntryId` binding). The matching engine
  itself is INF-006's item; this family routes by adapter id and
  observed capacity state only.
- INF-007 (credential isolation and provider-term eligibility):
  consumes the decision's `adapterId` (the id the isolation runtime
  resolves the landed opaque `credentialHandle` for - the routing
  vocabulary itself carries NO credential field, so a routing record
  binds nothing secret) plus the landed metadata verification states
  the disclosure rides.
- INF-008 (provenance/capacity/reset UI): consumes
  `serializeRoutingDecision` canonical bytes and `reportSnapshot` /
  `serializeRoutingRecord` (the honest per-candidate states and the
  persistence/audit shape the UI renders), with the landed disclosure
  projection already embedded in both.
- INF-009 (live-provider acceptance and failure drills): consumes
  the FAILOVER DRILLS surface - `runWithFailover` over
  caller-injected effect thunks, the `RetryPolicy` vocabulary, the
  `RoutingAttempt` ledger lines as drill evidence, and
  `FAILOVER_REJECTION_REASONS` as the typed drill-input verdicts;
  evidence labels upgrade there - `fixture` here proves vocabulary
  behavior only.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood
discipline; mocha under bun is the verified runner: Node 24 dropped
the .js-specifier-to-.ts resolution the family test style relies
on):

        bun node_modules/.bin/tsc -p build/flauz/inference/routing/tsconfig.json --noEmit
        bunx --bun mocha --ui tdd 'build/flauz/inference/routing/test/common/*.test.ts'
        grep -nE 'Date\.now|Math\.random|process\.env' build/flauz/inference/routing/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it). The whole-tree variant
(`grep -rn ... build/flauz/inference/routing/`) additionally hits the
suites' own grep-test titles and this README's law text - the same
quoted-ban lines the landed families' trees show.
