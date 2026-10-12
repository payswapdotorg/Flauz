# Flauz inference acceptance contracts (INF-009, Free Inference Fabric)

Typed contract set for the Free Inference Fabric acceptance family -
the ninth family, closing the INF wave: the LIVE-PROVIDER ACCEPTANCE
and FAILURE DRILLS vocabulary over the landed inference fabric.
THE UPGRADE LAW is this family's charter, front and center: the
evidence labels are the frozen `'fixture' | 'local-real' |
'live-real'` list, DERIVED from the exchange class and never
caller-supplied - `'fixture'` proves vocabulary behavior only (the
injected fixture port), `'local-real'` proves real-filesystem
execution at caller-injected roots (the ledger surfaces, never an
exchange record), and `'live-real'` proves a REAL network exchange
with a REAL provider endpoint, claimed ONLY when a live exchange
actually happened, NEVER promoted (a live-real claim read over a
fixture-configured network port is the typed `no-live-port`
rejection - the law enforced at the read boundary, not just the
write boundary). THE HONEST-FAILURE LAW rides with it: a failed
live probe is RECORDED as live-real failure evidence with the
provider's refusal reason VERBATIM - never retried into success,
never silently dropped, never converted to fixture. THE SAFETY LAW
(the workstream's charter, enforced here finally): no shared public
Flauz gateway pooling third-party free-tier keys; NO credential
material anywhere in the vocabulary - credentials reach the drill
ONLY through the caller-INJECTED handle-shaped credential port (the
landed `CredentialScopeDescriptor` triple), and the shipped code
never names a secret, never reads env, never opens a socket outside
the injected network port. THE NEVER-RE-DERIVE LAW: every drill
record's payload is a PROJECTION of the landed canonical surfaces -
the landed presentation views, the landed eligibility verdict, the
landed serializers' own canonical bytes - cited through the landed
`serialize*` / `project*` / `admit*` functions, never re-implemented
(a caller-supplied evidence label or verdict is a typed rejection).
Like the landed INF-001..008 families, this family is pure
vocabulary over injected values plus the bounded ledger surfaces:
no clock reading (the injected clock only), no randomness, no
global fetch, no second authority.

Contract set version: `INFERENCE_ACCEPTANCE_VERSION = '1.0.0'` -
declared ONCE in `common/acceptanceContract.ts` (the single version
declaration law), re-carried by `common/acceptanceKit.ts`
(re-exported; the battery pins both module copies equal). Every
persisted record carries it, and every emitted record is
self-checked through the contract guards before it reaches the
caller or the ledger (the drift fail-closed law: a mismatch is a
fail-closed TypeError, never a valid-looking record). The vocabulary
INSIDE the records is the landed families', bound verbatim and
never re-implemented: the wire seam rides the INF-003 adapter
family's `AdapterObservation` shapes, the scope handle is the
INF-007 family's `CredentialScopeDescriptor` triple (admitted
through the landed `admitCredentialScope` / `admitCredentialScopeSet`
with the landed `HandleResolution` resolution shape), the payload
projections are the INF-008 family's `ProvenanceView` /
`CapacityView` / `ResetExpectationView` / `DecisionView` (projected
through the landed presentation kit and canonicalized through the
landed `serializePresentationRecord`), the eligibility verdict rides
the INF-007 family's `TERM_ELIGIBILITY_VERDICTS` folded through the
landed `verdictForTermState` and canonicalized through the landed
`serializeEligibilityDecision` / `serializeCredentialScope`; the
bound records ride the INF-002 catalog, INF-003 adapter and INF-007
credential-scope-set landed guards. Those landed sub-records keep
their own family version stamps; the acceptance stamp and the
landed stamps are distinct roles pinned by the battery.

## Module index (the seven delivery paths)

- `common/acceptanceContract.ts` - the typed acceptance contract:
  `INFERENCE_ACCEPTANCE_VERSION` (the single declaration),
  `ACCEPTANCE_EVIDENCE_LABELS` (the frozen three, in THE UPGRADE
  LAW's own list order) + `isAcceptanceEvidenceLabel`,
  `ACCEPTANCE_REJECTION_REASONS` (the frozen eleven, in the exact
  list order - `not-an-object`, `caller-supplied-label` (THE
  UPGRADE LAW's own reason), `caller-supplied-verdict` (THE
  NEVER-RE-DERIVE LAW's own reason), `shape-law-violation` (the
  landed guards' rejections and the walk input-shape laws),
  `no-live-port` (THE UPGRADE LAW at the read boundary),
  `credential-shape` (THE SAFETY LAW), `unresolved-adapter-binding`,
  `unresolved-scope-binding`, `unresolved-decision-binding` (the
  NO-DANGLING-REF reasons), `unresolved-ledger-line`,
  `malformed-record`; each walk applies its applicable subset in
  the list order and the first failure is the verdict),
  `DRILL_CLASSES` (the frozen seven: the `acceptance-exchange` class
  first, then the six failure classes in the landed failure order) +
  `FAILURE_DRILL_CLASSES` (the six, never the acceptance class) +
  `isDrillClass` / `isFailureDrillClass`,
  `ACCEPTANCE_BYTE_SERIALIZERS` (the frozen citation vocabulary -
  the five LANDED serializer names the byte citations may name:
  `serializeCredentialScope`, `serializeAdapterReport`,
  `serializeCapacityDisclosure`, `serializePresentationRecord`,
  `serializeEligibilityDecision`), the wire seam types
  (`DrillWireRequest` / `DrillWireCompleted` / `DrillWireRefused` /
  `FixtureNetworkPort` / `LiveNetworkPort` /
  `AcceptanceCredentialPort` - the injected-port seam shapes, the
  ONLY exchange seam this family knows), `AcceptanceDrillRequest`
  and `FailureDrillScenario` (the frozen request / scenario shapes -
  nothing beyond them is representable), the evidence record types
  (`DrillRecord`: the completed-exchange record whose payload is the
  landed projection set (`DrillPayloadProjection`) with its
  `ByteCitation` list; `FailureEvidence`: the honest-failure record
  with the `FailureDisclosureProjection` - THE NEVER-SILENT-EMPTY
  LAW: the refused side is shown with its typed reasons verbatim,
  never empty), the outcome unions (`AcceptanceDrillOutcome`,
  `AcceptanceAuditOutcome`, `AcceptanceOutcome<TView>`,
  `AcceptanceLedgerLine` / `AcceptanceLedgerLineOutcome`),
  `serializeAcceptanceRecord` (the canonical fixed-key-order bytes
  per record kind, double-run byte-equal; the nested landed shapes
  embed the LANDED serializers' own canonical bytes, re-parsed to
  carry their fixed key order VERBATIM - the routing family's cited
  idiom; refuses non-records fail-closed), and the shape guards
  `isDrillRecord` / `isFailureEvidence` / `isDrillEvidence` /
  `isAcceptanceLedgerLine` (each pins the honest-evidence laws
  STRUCTURALLY: the exact own-field sets, the drill-class / record-
  kind agreement, the label membership AND the never-`local-real`
  pin, the landed vocabulary memberships, the handle-equality law,
  the decision-view decided-side pin with exactly the landed
  verdict, the no-dangling-attribution pins, the byte-citation
  serializer vocabulary, the never-negative-latency pin, the
  never-empty disclosure pin).
- `common/acceptanceKit.ts` - the deterministic injected-clock kit:
  `createAcceptanceKit(options)` (the fail-closed factory: the
  options shape, the bound catalog / adapter / scope-set records
  through the LANDED `admitCatalogRecord`,
  `admitProviderAdapterRecord`, `admitCredentialScopeSet` guards,
  the injected network port against the frozen port shapes - the
  fixture two-field form or the live three-field form, anything else
  a fail-closed TypeError, never a guessed seam - the OPTIONAL
  handle-shaped credential port validated through the LANDED
  `admitCredentialScope`, the caller-injected ledger root, and ONE
  validation read of the injected clock), `runAcceptanceDrill`
  (the acceptance fold: the request walk -> the credential binding
  walk -> the eligibility fold through the LANDED isolation kit ->
  the wire exchange over the injected port -> the landed
  report / disclosure folds -> the landed presentation projections
  -> the canonical DrillRecord with its eight landed byte citations,
  appended to the drill ledger), `runFailureDrill` (the six honest
  failure folds, each pinning its landed vocabulary verbatim: the
  quota exhaustion, the active cooldown's own reason, the stale
  fixed-instant reset's honest unknown, the landed eligibility
  refusal that never reaches the wire, the honest-unknown capacity
  with unverified metadata, and the network refusal carried
  VERBATIM), `readDrillLedger` / `projectDrillLedger` (the
  canonical-bytes ledger walk: a line parses ONLY through this
  family's own canonical form - the byte comparison IS the parse -
  and every binding resolves against the bound records or the line
  is a typed refusal, never a silent drop), `snapshot()` (the honest
  state fold: the counters, the sorted bound-surface disclosure,
  the network port kind - the evidence-label source), plus the
  disclosed constants `ACCEPTANCE_DRILLS_LEDGER_FILE`,
  `ACCEPTANCE_FAILURE_PROBE_SCOPE`, `ACCEPTANCE_DRILL_USAGE_CLASS`
  and the three disclosed fixture adapter ids
  (`FIXTURE_ACCEPTANCE_HEALTHY_ID` / `FIXTURE_ACCEPTANCE_REFUSED_ID`
  / `FIXTURE_ACCEPTANCE_UNKNOWN_ID`). The kit's evidence chain rides
  the LANDED isolation and presentation kits at the same root: the
  drill's eligibility decision lands in the landed
  `isolation-decisions.jsonl`, the projected views land in the
  landed `presentation-audits.jsonl`, and the drill evidence itself
  lands in `acceptance-drills.jsonl` - the full honest evidence
  chain, never re-serialized.
- `test/common/acceptanceContract.test.ts` - the contract battery
  (72 tests, mocha tdd style): the frozen lists and their orders,
  every guard's structural pin (each law fired through its own
  crafted malformed candidate), the canonical-bytes law (double-run
  determinism, deep-shuffle key-order independence, the landed
  serializers' embedded key orders, the round-trip), and the
  in-suite determinism greps (every `Date.now` / `Math.random` /
  `process.env` hit in the two shipped modules must be a law-comment
  line - the determinism law as a test).
- `test/common/acceptanceKit.test.ts` - the kit battery (108 tests,
  mocha tdd style): the fail-closed factory (every malformed option
  rejected at the boundary), the acceptance fold's happy path and
  every typed refusal (all eleven frozen rejection reasons fire
  across this battery - pinned by the battery's own receipt test),
  the honest-failure folds over the fixture ports, the
  derivation-switch tests (the LIVE-configured test-double port
  derives `live-real`; the read-boundary no-live-port law), the
  ledger walk (the canonical-bytes law at the read boundary: every
  malformed / dangling / cross-inconsistent line is a typed
  refusal, never a silent drop), the drift fail-closed law, and the
  in-suite determinism greps. The battery runs at caller-injected
  roots under `os.tmpdir()`, outside the repo tree, cleaned per
  suite run (`local-real` filesystem evidence; the record values
  themselves stay synthetic fixtures).
- `test/canary/live-provider-drill.drill.ts` - the env-activated
  LIVE-PROVIDER acceptance drill (the drift canary, the repo's
  real-endpoint drill precedent - see
  `docs/flauz/canaries/B-POLICY.md` and
  `extensions/flauz-browser/test/canaries/real-chromium-hardening.drill.ts`):
  the acceptance kit driven against a REAL provider endpoint over a
  REAL HTTP exchange - the verification class the fixture battery
  cannot provide. THE ENV CONTRACT
  (`FLAUZ_LIVE_PROVIDER_URL` + `FLAUZ_LIVE_PROVIDER_KEY_HANDLE`) is
  the station's activation surface and the ONLY sanctioned
  `process.env` reader in this family's tree; the handle value is
  the station-supplied opaque HANDLE REFERENCE (the typed reference
  only - safe-to-persist by contract; the raw secret, if the
  endpoint needs one, stays inside the station's endpoint contract,
  never in this file, never in any drill record the kit writes).
  Skip semantics (never fail a gate for lacking a provider): either
  env var unset or the endpoint unreachable (5s probe) -> clean
  SKIP, exit 0. Exit 1 ONLY when a REACHABLE provider exchange
  violates the acceptance kit's own honest-evidence laws - that is
  the drift-canary property. This is REAL-VERIFICATION code,
  clearly separated from the gated battery (the battery glob is
  `test/common/*.test.ts` only); it reads the REAL clock for the
  injected clock and the observation timestamps (REAL-VERIFICATION
  code is sanctioned to; the family code under `common/**` stays
  deterministic - the battery greps pin it).
- `tsconfig.json` - the scoped strict TypeScript config, byte-
  identical to every landed sibling family's (the sha256 parity
  receipt).
- `README.md` - this charter.

## Laws

- THE UPGRADE LAW (binding, this family's charter): the evidence
  labels are the frozen `'fixture' | 'local-real' | 'live-real'`
  list, in the exact list order. `'fixture'` proves vocabulary
  behavior only; `'local-real'` proves real-filesystem execution at
  caller-injected roots; `'live-real'` proves a real network
  exchange with a real provider endpoint - claimed ONLY when a live
  exchange actually happened, NEVER promoted. Evidence labels are
  DERIVED from the exchange class (the injected fixture port, the
  live port's real exchange), never caller-supplied - a
  caller-supplied label is the typed `caller-supplied-label`
  rejection; a live-real claim over a fixture-configured network
  port - a ledger line the kit reads - is the typed `no-live-port`
  rejection. No drill record is ever `'local-real'` (the guard pins
  it structurally).
- THE SAFETY LAW (binding, the workstream's charter, enforced here
  finally): no shared public Flauz gateway pooling third-party
  free-tier keys; NO credential material anywhere in the vocabulary
  (the landed no-secret shapes are the only representable ones);
  credentials reach the drill ONLY through a caller-INJECTED
  handle-shaped credential port; a drill without one is the typed
  `credential-shape` refusal, never a silent unauthenticated
  exchange; a secret-shaped port, a resolution beyond the typed
  reference, or a handle that does not equal the bound adapter
  record's own `credentialHandle` is the typed `credential-shape`
  rejection; the shipped code never names a secret, never reads
  env, never opens a socket outside the injected network port.
- THE HONEST-FAILURE LAW (binding): a failed live probe is RECORDED
  as live-real failure evidence (the typed failure record with the
  honest reason verbatim - a rate limit, a refusal, an unknown) -
  never retried into success, never silently dropped, never
  converted to fixture. The failure drill's counting-port tests pin
  the never-retried side (one port call per drill, never more).
- THE NEVER-RE-DERIVE LAW (binding): every drill record's evidence
  payload is a PROJECTION of the landed canonical surfaces - the
  report through the landed `reportAdapterSnapshot`, the disclosure
  through the landed `projectCapacityDisclosure`, the views through
  the landed presentation kit, the verdict through the landed
  isolation kit's eligibility fold; the byte citations name the
  landed serializers and are produced by them. A caller-supplied
  evidence label or verdict is a typed rejection (derived, never
  caller-supplied).
- THE NO-DANGLING-REF LAW (binding, extended to acceptance): every
  drill record's source binding (the adapter id, the scope handle,
  the decision verdict) resolves against the BOUND record surface -
  or the drill is a typed rejection, never a dangling ref; the
  ledger walk resolves every line's own bindings the same way.
- THE INJECTED-CLOCK LAW (binding): the kit never reads a clock.
  Every timestamp is a read of the caller-injected clock (drill
  start, completion, failure instant, snapshot fold). No
  `Date.now`, no `Math.random`, no `process.env` in the family code
  under `common/**` (law comments excepted) - the battery greps pin
  it.
- THE LEDGER LAW (binding): the kit appends
  `acceptance-drills.jsonl` under the injected root, one canonical
  line per recorded evidence record, append-only; the drill's
  eligibility decision and projected views ride the landed
  isolation and presentation kits' own ledgers at the same root
  (`isolation-decisions.jsonl`, `presentation-audits.jsonl`) - the
  full honest evidence chain.
- FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
  (binding): every drill / ledger rejection is a typed member of
  the frozen `ACCEPTANCE_REJECTION_REASONS` list, applied in the
  exact list order per walk; the first failing check is THE
  verdict, and every rejection names its reason.
- THE NEVER-SILENT-EMPTY LAW (binding): the refused sides are
  shown - a failure record's disclosure projection carries the
  refused side with its typed reasons verbatim (never empty); a
  drill ledger stream projects every line exactly once - a
  malformed line is the typed `malformed-record` refusal outcome,
  never a silent drop.
- THE CANARY LAW (binding, the drift-canary property): the
  live-provider drill never fails a gate for lacking a provider
  (clean SKIP, exit 0) and fails ONLY when a REACHABLE provider
  exchange violates the honest-evidence laws above - the canary is
  the acceptance family's own regression tripwire, run at the
  station's discretion per the repo's canary policy.

## The evidence-label derivation convention

The label is derived from the INJECTED PORT's own class at the
exchange fold: a drill over the fixture port derives `'fixture'`
(completed or refused), a drill over the live port derives
`'live-real'` (completed or refused - a failed live probe is
live-real FAILURE evidence, THE HONEST-FAILURE LAW). The derivation
switch is pinned by the battery's test-double live port (what is
pinned is the DERIVATION, never a real claim: a real `'live-real'`
claim belongs to the canary's real exchange over the env-activated
live port, never the battery). At the read boundary the same law
fires again: a ledger line claiming `'live-real'` read through a
fixture-configured kit is the typed `no-live-port` rejection -
live-real never promotes.

## Repo-side completion (before running the gates)

The family lands as a pure additive delta under
`build/flauz/inference/acceptance/` (the seventh inference family,
closing the INF wave): no tracked file is touched, no dependency is
added, no install is performed in the repo - the runner recipe is
the landed families' isolated one (mocha under bun, tooling outside
the repo tree, never a repo install - the dogfood discipline).

## Verification receipts (executed at the delivery commit)

| receipt | command | verdict |
| --- | --- | --- |
| scoped tsc | `bunx tsc -p build/flauz/inference/acceptance/tsconfig.json --noEmit` | EXIT 0 |
| contract battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/acceptance/test/common/acceptanceContract.test.ts'` | 72 passing / 0 failing / 0 pending |
| kit battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/acceptance/test/common/acceptanceKit.test.ts'` | 108 passing / 0 failing / 0 pending |
| whole battery | `bunx --bun mocha --ui tdd 'build/flauz/inference/acceptance/test/common/*.test.ts'` | 180 passing / 0 failing / 0 pending |
| canary (no env contract) | `bun build/flauz/inference/acceptance/test/canary/live-provider-drill.drill.ts` | clean SKIP, exit 0 (never fails a gate for lacking a provider) |
| isolation regression (the landed 121) | `bunx --bun mocha --ui tdd 'build/flauz/inference/isolation/test/common/*.test.ts'` | 121 passing / 0 failing |
| presentation regression (the landed 164) | `bunx --bun mocha --ui tdd 'build/flauz/inference/presentation/test/common/*.test.ts'` | 164 passing / 0 failing |
| determinism grep (shipped code) | `grep -n 'Date\.now\|Math\.random\|process\.env' common/*.ts` | 3 hit lines, all law-comments |
| determinism grep (whole subtree) | `grep -rn 'Date\.now\|Math\.random\|process\.env' build/flauz/inference/acceptance/` | 20 hits: the 3 law-comments in the shipped modules + the 4 in-suite grep-test titles + this README's 4 law-text lines + the canary's 9 documented lines (its 2 law-comments + its 7 sanctioned REAL call sites: the 2 env-contract reads and the 5 real-clock reads of the env-activated REAL-VERIFICATION drill) |
| additive proof | `git status --porcelain` + `git diff --stat` | only the new path `build/flauz/inference/acceptance/` untracked; the tracked tree untouched (0 insertions / 0 deletions outside the family) |
| tsconfig parity | `sha256sum` both copies | MATCH (byte-identical to the semantics family's - and to every landed sibling's) |
| fails-on-base | overlay ONLY the two test files onto a pristine `990a52c9` worktree, run the battery | FAILED as required (module not found: `../../common/acceptanceContract.js`, mocha exit 1) |

Evidence labels: the suites run on synthetic `fixture.` values (the
`fixture` class); the ledger and audit suites additionally execute
`local-real` filesystem operations at caller-injected roots under
`os.tmpdir()`, outside the repo tree, cleaned per suite run; the
`live-real` class is claimed ONLY by the env-activated canary's real
exchange, never the battery (the test-double live port pins the
DERIVATION switch only).

## How to run the checks

Run from the repo root, the isolated runner recipe (tooling lives
OUTSIDE the repo tree, never a repo install - the dogfood
discipline; mocha under bun is the verified runner: Node 24 dropped
the .js-specifier-to-.ts resolution the family test style relies
on):

        bunx tsc -p build/flauz/inference/acceptance/tsconfig.json --noEmit
        bunx --bun mocha --ui tdd 'build/flauz/inference/acceptance/test/common/*.test.ts'
        bun build/flauz/inference/acceptance/test/canary/live-provider-drill.drill.ts
        grep -rn 'Date\.now\|Math\.random\|process\.env' build/flauz/inference/acceptance/

The first two commands are the gated battery (180 tests). The third
is the env-activated canary: without the env contract it prints the
SKIP line and exits 0; with `FLAUZ_LIVE_PROVIDER_URL` and
`FLAUZ_LIVE_PROVIDER_KEY_HANDLE` set for a station-verified
PERMITTED provider it drills the real exchange and asserts the
honest-evidence laws with real observed evidence. The last grep
returns the documented hit classes ONLY: the law-comment lines that
quote the determinism ban, the suites' own grep-test titles, this
README's law text, and the canary's sanctioned env-contract and
real-clock reads; no call sites exist in the family code under
`common/**` (the suites also grep the sources in-process and pin
it).

The INF wave closes here: the nine landed families
(semantics / catalog / adapters / sidecar / routing / matching /
isolation / presentation / acceptance) form the complete Free
Inference Fabric, and the post-INF binders consume this family's
`acceptance-drills.jsonl` delivery-evidence stream (with the landed
`isolation-decisions.jsonl` and `presentation-audits.jsonl` at the
same root) as the honest evidence chain of every acceptance drill -
never an event authority.
