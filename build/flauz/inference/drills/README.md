# Flauz inference drills (INF-009, Free Inference Fabric)

Typed contract set for the Free Inference Fabric drill family - the
ninth and TERMINAL family: the live-provider acceptance and failure-
drill harness over the eight landed families. THE DRILL HARNESS
CONTRACT is this family's charter, front and center: the
"live-provider acceptance" of the inference fabric is NOT a network
surface - it is THE DRILL HARNESS, typed failure-scenario definitions
plus deterministic drill runs over the LANDED family kits. There are
NO live provider calls anywhere in this family: no network, no fetch,
no provider surface, no credential material. Simulated provider
behavior only - the drills inject synthetic observations (a cooldown
the hold must trip, a failed attempt thunk the failover walk must
survive, an exhausted quota the boundary math must read honestly) and
fold the LANDED kits over them, then compare the observed verdict
against the expected verdict family. Every fixture is SYNTHETIC and
fixture-prefixed (`fixture.`) - THE FIXTURE-PREFIXED LAW: a fixture
naming a real or authority-looking id is the typed rejection, never a
silent pass-through; drill evidence is never confusable with authority
values. THE ACCEPTANCE-VIEW CITATION LAW (the v2 binder law) rides on
top: every drill receipt cites the drill's projected presentation
views verbatim - the view objects plus their canonical bytes through
the LANDED `serializePresentationRecord` - as the acceptance
vocabulary the INF-008 landing record's binder note demands. A receipt
whose citation is missing, or whose cited views fail their LANDED
shape guards, or whose bytes are not the LANDED canonical bytes, is
the typed rejection - never a valid receipt.

Contract set version: `INFERENCE_DRILLS_VERSION = '1.0.0'` - declared
ONCE in `common/drillsContract.ts` (the single version declaration
law), re-exported by `common/drillsKit.ts` (the battery pins both
paths equal). Like the landed INF-001..008 families, this family is
pure vocabulary over injected values plus the one bounded
fixture-ledger surface: no network, no clock reading (THE
INJECTED-CLOCK LAW: `createDrillsKit({ now })` - the kit never reads a
clock; every timestamp is the scenario's injected clock seed or a
single read through the LANDED kits' own injected clocks), no
randomness, no second authority. THE DETERMINISM BAN is total: no
Date.now, no Math.random, no process.env anywhere in the family (law
comments excepted) - same scenario + same injected clock produces
byte-equal receipts INCLUDING the acceptance-view citations and the
audit stream (drills are replayable acceptance evidence).

## The closed vocabularies (contract module)

- `DRILL_SCENARIO_KINDS` (frozen, six members) - the honest
  failure-scenario set: `cooldown-hold`, `retry-schedule`,
  `failover-walk`, `eligibility-denial`, `quota-exhaustion`,
  `substitution-disclosure`. One drill per kind; the binder map below
  says which LANDED family each drill accepts.
- `DRILL_VERDICT_FAMILIES` (frozen, fourteen members) - the honest
  observables the drills map their folds onto: the held member beside
  each kind's breach member (`cooldown-hold`/`cooldown-breach`,
  `retry-schedule-byte-equal`/`retry-schedule-diverged`,
  `failover-walk-exhausted`/`failover-walk-selected`,
  `eligibility-ineligible`/`eligibility-term-unknown`/
  `eligibility-eligible`, `quota-exhausted`/`quota-available`,
  `substitution-rejected`/`substitution-admitted`) plus the
  first-class `'unknown'` tail. THE HONEST-UNKNOWN LAW: an observed
  `'unknown'` is a first-class drill outcome - counted in the
  roll-up's honest-unknown column AND in the pass/fail columns exactly
  as the expected/observed comparison decides, never coerced to a
  pass, never laundered.
- `DRILL_FOLDS` (frozen, eleven members) - which LANDED fold each
  drill-log row exercised; the row's verdict carries the LANDED
  vocabulary member the fold produced VERBATIM (THE VERBATIM-
  VOCABULARY LAW: the LANDED rejection reasons / decision kinds /
  eligibility states / attempt outcomes / disclosed capacity states -
  cited, never re-worded, never silent).
- `DRILL_REJECTION_REASONS` (frozen, ten members, FIRST-FAILURE-IS-
  THE-VERDICT in the exact list order): `not-an-object`,
  `version-mismatch`, `scenario-malformed`, `scenario-kind-unrunnable`,
  `fixture-id-not-synthetic`, `scenario-inputs-rejected` (the LANDED
  admission guards over the fixture surfaces - the landed reasons
  cited verbatim in the detail), `scenario-target-malformed`,
  `receipt-malformed`, `receipt-citation-missing`,
  `receipt-citation-rejected`.
- The typed shapes: `DrillScenario` (the pure scenario definition -
  kind, synthetic fixture inputs, injected clock seed, expected
  verdict family, eligibility-denial target), `DrillLogEntry`
  (fold + verbatim verdict), `DrillCitedView` (the view object + its
  LANDED canonical bytes), `DrillReceipt` (expected vs observed, the
  disclosed drill log, THE ACCEPTANCE-VIEW CITATION, the disclosed
  audit-ledger path; `passed` is STRUCTURAL - it equals
  `(expected === observed)`, pinned by the guard).
- The guards and the serializer: `admitDrillScenario` (the scenario
  walk), `admitDrillReceipt` (the receipt walk - the acceptance-view
  citation is part of the guarded shape), `isDrillReceipt`,
  `serializeDrillReceipt` (the fixed-key-order canonical bytes; the
  cited views ride the LANDED serializer's own key order, re-parsed -
  the routing serializer's cited idiom).

## The drill engine (kit module)

- `createDrillsKit({ now })` - the fail-closed factory (the options
  shape, one validation clock read, the fixture ledger root created
  under `os.tmpdir()` at the fixed fixture name
  `flauz-drills-audit-fixture` - the presentation kit's
  `presentation-audits.jsonl` audit ledger lives inside it).
- `runDrill(scenario)` - the six drills (each instantiating the
  LANDED kits over the scenario's fixture surfaces and the LANDED
  presentation kit as the acceptance fold), the receipt assembly with
  the audit-stream append, and the drift fail-closed self-check
  (`isDrillReceipt` over the kit's own receipt; a projection refusal
  over the admitted fixture surfaces is a fail-closed TypeError
  carrying the LANDED `PRESENTATION_REJECTION_REASONS` member
  verbatim).
- `drillSummary(receipts)` - the acceptance roll-up (pass/fail per
  receipt + the honest-unknown count; the empty batch is honestly
  not-all-passed).
- `auditLedgerPath()` - the disclosed delivery-evidence stream path.

## The audit-stream law (v2)

Each `runDrill` appends the projected views to the presentation kit's
delivery-evidence stream (`recordViewAudit` under the kit's fixture
ledgerRoot - the `presentation-audits.jsonl` ledger, the LANDED
`PRESENTATION_AUDITS_LEDGER_FILE` name); the receipt discloses the
ledger path; the audit lines ARE the LANDED
`serializePresentationRecord` bytes. The stream is append-only and
delta-assertable: two runs of the same scenario over one injected
clock append byte-identical line sequences (the determinism receipt).

## Surface inventory

- `common/drillsContract.ts` - the failure-scenario vocabulary: the
  version stamp, the four closed frozen lists, the typed shapes, the
  two guard walks, the canonical receipt serializer.
- `common/drillsKit.ts` - the injected-clock drill engine: the
  fail-closed factory, the six drill folds, the acceptance-view
  citation assembly, the audit-stream append, the summary roll-up.
- `test/common/drillsContract.test.ts` - the contract battery (the
  frozen vocabularies, both guard walks, the check-order pins, the
  fixture-prefixed law, the citation law, the canonical bytes, the
  in-suite determinism grep).
- `test/common/drillsKit.test.ts` - the engine battery (the fail-
  closed factory, all six drills end-to-end with their verbatim
  citations, the eligibility-denial law, the retry byte-equality law,
  the honest-unknown roll-up, the dishonest-promise rejection, the
  stale-reset projection, the audit stream, the determinism receipt).
- `tsconfig.json` - byte-identical to the sidecar family's (itself
  the semantics family's shape).
- `README.md` - this binder note.

## The binder map (which drill accepts which family)

- THE COOLDOWN-HOLD DRILL accepts the INF-005 ROUTING family's hold
  path: the LANDED routing kit's `route` over candidates under active
  cooldown trips the landed `skipped-cooldown` outcome (the LANDED
  `ROUTING_ATTEMPT_OUTCOMES` member verbatim) and walks to the
  exhausted terminal; the drill cites its `DecisionView` (the refused
  side, the cooldown reason `rate-limited` verbatim in the typed
  reasons).
- THE RETRY-SCHEDULE DRILL accepts the INF-005 ROUTING family's
  bounded retry engine: two `runWithFailover` runs over fresh kits
  with ONE injected clock and a failed attempt thunk must be
  byte-equal (deterministic scheduling over the injected
  `RetryPolicy` backoff schedule); the drill cites the first run's
  `DecisionView` (the refused side, the attempt reasons verbatim in
  ledger order).
- THE FAILOVER-WALK DRILL accepts the INF-005 ROUTING family's
  failover terminal: the ordered alternates walk to the no-route
  terminal with every ledger outcome a LANDED
  `ROUTING_ATTEMPT_OUTCOMES` member (cited verbatim); the drill cites
  its `DecisionView` (the refused side, the full ledger reasons
  verbatim, honestly empty exactly when nothing was admitted).
- THE ELIGIBILITY-DENIAL DRILL accepts the INF-007 ISOLATION family's
  honest-unknown eligibility fold: the LANDED `checkEligibility` over
  the prohibited fixture scope is `ineligible` and over the
  unknown-term fixture scope is `term-unknown` - never a silent pass,
  never assumed permission; the drill cites its `DecisionView` (the
  decided disclosure's verdict verbatim, the landed eligibility probe
  scope riding the derived provenance).
- THE QUOTA-EXHAUSTION DRILL accepts the INF-001 SEMANTICS family's
  boundary math: the LANDED `quotaWindowContains` (inclusive) and
  `cooldownActive` folds at the exhausted edge, the LANDED
  `projectCapacityDisclosure` fold (the disclosed `exhausted` state;
  an unknown quota maps AS `'unknown'` - never a fabricated state);
  the drill cites its `CapacityView` and the snapshot reset
  schedule's `ResetExpectationView` (the stale-reset `'unknown'`
  projection carried AS unknown, never coerced - the INF-001 law).
- THE SUBSTITUTION-DISCLOSURE DRILL accepts the INF-001 SEMANTICS
  family's honest-promise guard: the LANDED `admitHonestPromise`
  rejects the dishonest fixture (the unlimited-provider-capacity lie)
  with the landed rejection reason verbatim; the drill cites its
  `ProvenanceView` (the substitution label derived by the LANDED
  `unverifiedProvenance` constructor, never caller-supplied).
- The INF-008 PRESENTATION family is the acceptance READ-SIDE of all
  six drills: every observed verdict additionally projects through
  the LANDED presentation kit (instantiated over the drill's
  synthetic fixture surfaces at the kit's fixture ledgerRoot), the
  five LANDED shape guards admit every cited view, and the LANDED
  `serializePresentationRecord` bytes ARE the citation. The LANDED
  `PRESENTATION_REJECTION_REASONS` members surface verbatim in the
  drift fail-closed TypeErrors - never re-worded, never silent.
- The INF-002 CATALOG family (the entry/descriptor admission guards)
  and the INF-003 ADAPTER family (the report fold over the drill's
  synthetic observations) are the fixture construction surfaces the
  scenario walk validates through; the INF-006 MATCHING family's
  match-outcome fixture constants remain OPTIONAL drill inputs (a
  match-outcome drill citing them is welcome, never required - the
  six-kind set above is the honest closed scope of this version).

## TERMINAL binder note (INF-001..009 complete)

With this family the Free Inference Fabric's contract families are
closed: semantics (INF-001), catalog (INF-002), adapters (INF-003),
sidecar (INF-004), routing (INF-005), matching (INF-006), isolation
(INF-007), presentation (INF-008), and these drills (INF-009). The
drills are the workstream's acceptance harness: the failure-scenario
vocabulary names the honest provider-dependent world (the cooldown,
the retry, the failover terminal, the denied terms, the exhausted
quota, the disclosed substitution), the LANDED kits fold it, the
LANDED presentation projections cite it, and the receipts replay
byte-equal. Every landed family's README binder note names this
family as its INF-009 consumer; the map above is the reciprocal
record. Widening the drill set (new scenario kinds, new verdict
families, new folds) is a versioned contract decision requiring a
version bump - the closed sets are the honesty.

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood discipline;
pins: typescript 5.9.3, mocha@11, the tsx loader):

        npx -y -p typescript@5.9.3 tsc -p build/flauz/inference/drills/tsconfig.json
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/drills/test/common/*.test.ts'
        grep -nE 'Date\.now|Math\.random|process\.env' build/flauz/inference/drills/common/*.ts

The last grep returns ONLY law-comment lines that quote the
determinism ban; no call sites exist (the suites also grep the
sources in-process and pin it). The EIGHT landed sibling suites must
ALL hold green - this family's change is additive:

        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/semantics/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/catalog/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/adapters/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/sidecar/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/routing/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/matching/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/isolation/test/common/*.test.ts'
        NODE_OPTIONS='--import tsx' npx -y mocha@11 --ui tdd 'build/flauz/inference/presentation/test/common/*.test.ts'

Evidence labels: the suites run on synthetic `fixture.` values; the
audit-stream suites additionally execute `local-real` filesystem
appends/reads at the kit's fixed fixture root under `os.tmpdir()`,
outside the repo tree, delta-asserted (pre-existing ledger lines
never break a run; the append-only stream is the evidence).
