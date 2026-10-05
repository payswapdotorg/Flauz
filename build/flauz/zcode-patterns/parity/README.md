# ZC-010 -- ZCode Parity and Quality Gate (Phase C)

The typed contract set that makes the Phase C parity comparison documented
and the completion verdict machine-checkable. One versioned,
zero-dependency set: `ZCODE_PARITY_CONTRACTS_VERSION = '1.0.0'`, exported
in lockstep by all four `common/` modules and pinned equal by every suite.

This is a CONTRACT SET, not a runner: no test execution, no comparison
execution, no digest computation at runtime. Surface digests are injected
plain strings; observed outcomes are injected record values; the set
validates, derives verdicts, and aggregates. It fails closed on everything
it cannot measure.

## Layout

| path | role |
| --- | --- |
| `common/matrix.ts` | the ten-domain comparison matrix; verdict vocabulary; `verdictFor()` |
| `common/evidence.ts` | evidence-label vocabulary (the authority); `labelFor()`; `labelBacksVerdict()` |
| `common/gate.ts` | the gate-check table; `aggregateVerdict()`; the Phase C verdict record |
| `common/discovery.ts` | the discovery/a11y check table; `discoveryStatusFor()`; `discoveryStatusTable()` |
| `test/common/matrix.test.ts` | pin suite -- 41 tests |
| `test/common/evidence.test.ts` | pin suite -- 48 tests |
| `test/common/gate.test.ts` | pin suite -- 80 tests |
| `test/common/discovery.test.ts` | pin suite -- 35 tests |
| `tsconfig.json` | the gate-1 compiler options (strict, noEmit, ES2022, NodeNext, verbatimModuleSyntax, types [node, mocha]) |

204 tests total.

## The ten capability domains

`PARITY_DOMAINS` (matrix.ts; frozen; pinned verbatim by matrix.test.ts,
in this order):

1. coding
2. exploration
3. background-delegation
4. plan-execute
5. browser-computer-use
6. memory
7. hooks
8. workflow-monitoring
9. replay-recovery
10. capability-discovery

## The sibling surfaces the matrix compares

Columns 2 and 3 are PROPOSALS derived from the order's read-list wording;
the exact per-domain assignment and both surface digests are SEAM
`ZC010-SEAM-1` (see SEAMS below). This lane is text-only and could not
read the merged sibling trees; no digest values are fabricated here.

| domain | ZCode-side surface (proposed) | journey authority (proposed) |
| --- | --- | --- |
| coding | `build/flauz/zcode-patterns/common/**` (ZC-001, one of the six projection families) | `extensions/flauz-agent/src/types.ts`, `extensions/flauz-execution/src/contracts.ts` |
| exploration | `build/flauz/zcode-patterns/common/**` (ZC-001 family) | `extensions/flauz-agent/src/types.ts` |
| background-delegation | `build/flauz/capabilities/background-agent/**` (ZC-002) | `extensions/flauz-agent/src/types.ts`, `extensions/flauz-isolation/` |
| plan-execute | `build/flauz/capabilities/commands/**` (ZC-008) + the ZC-001 family for this domain | `extensions/flauz-execution/src/contracts.ts` |
| browser-computer-use | `build/flauz/zcode-patterns/common/**` (ZC-001 family) | `extensions/flauz-agent/src/types.ts` |
| memory | `build/flauz/zcode-patterns/memory/**` (ZC-005) | `extensions/flauz-agent/src/types.ts`, `build/flauz/lab/` |
| hooks | `build/flauz/zcode-patterns/hook-bus/**` (ZC-003) | `extensions/flauz-agent/src/types.ts` |
| workflow-monitoring | `build/flauz/zcode-patterns/observatory/**` (ZC-004) | `extensions/flauz-execution/src/contracts.ts`, `build/flauz/lab/` |
| replay-recovery | ZC-004 observatory and/or ZC-009 `cli/**` -- assignment is part of SEAM-1 | `extensions/flauz-execution/src/contracts.ts` |
| capability-discovery | `build/flauz/capabilities/packs/**` (ZC-006), `build/flauz/capabilities/sources/**` (ZC-007) | `extensions/flauz-isolation/`, `build/flauz/lab/` |

ZC-009 (`build/flauz/zcode-patterns/cli/**`, PR #151) and ZC-008
(`build/flauz/capabilities/commands/**`, PR #152) are in the order's
read-list; where the ZC-009 surface belongs is part of the SEAM-1
confirmation.

## Vocabularies (all frozen, all pinned verbatim by the suites)

- Parity verdicts (matrix.ts, the authority): `parity-confirmed`,
  `parity-partial`, `parity-divergent`, `parity-unmeasured`.
- Evidence labels (evidence.ts, the authority): `test-suite-green`,
  `contract-pinned`, `authority-mirrored`, `documented-comparison`, `none`.
- Gate checks (gate.ts): `targeted-tests`, `evidence-labels`,
  `discovery-a11y`, `existing-gates`.
- Gate-check statuses (gate.ts): `green`, `red`, `unmeasured`.
- Discovery checks (discovery.ts): `surface-indexed`,
  `contract-discoverable`, `journey-documented`, `a11y-law-annotated`.
- Discovery outcomes (discovery.ts): `pass`, `fail`.
- Overall verdict (gate.ts): `phase-c-complete`, `phase-c-incomplete`.

`verdictFor(domain, zcodeDigest, serviceDigest, evidence)`: digest
equality -> `parity-confirmed`; both present and different ->
`parity-divergent`; one present -> `parity-partial`; neither ->
`parity-unmeasured`; label `none` -> `parity-unmeasured` regardless of
digests; unknown inputs -> `parity-unmeasured` (fail closed).

`labelFor(facts)` (strongest evidence wins): a green tdd suite pinned to
the authority -> `test-suite-green`; a structural mirror pinned by tests
-> `contract-pinned`; a structural mirror present -> `authority-mirrored`;
a prose comparison only -> `documented-comparison`; nothing -> `none`.

## The fail-closed completion law

`aggregateVerdict(scope, domainRecords, checkRecords)` (gate.ts) rules
`phase-c-complete` ONLY when every one of the ten domains is present
exactly once with a qualifying verdict (`parity-confirmed` or
`parity-partial`) AND every one of the four frozen checks is present
exactly once with status `green` AND no input record was malformed.
Every other configuration is `phase-c-incomplete`, and the record names
every failure mode: `missingDomains`, `duplicateDomains`,
`failingDomains`, `missingChecks`, `duplicateChecks`, `failingChecks`,
and the `malformedDomainRecords` / `malformedCheckRecords` counts.

- A check with status `unmeasured` -- or with no record at all -- fails
  closed. The aggregate may never fabricate a green check.
- Absence is derived, never guessed: a domain with no valid record
  reports `parity-unmeasured` (exactly
  `verdictFor(undefined, undefined, 'none')`) and is named in
  `missingDomains`; a check with no valid record reports `unmeasured`
  and is named in `missingChecks`.
- `isPhaseCVerdictRecord` re-derives the completion equivalence from the
  record's own failure lists: a record may not fabricate completion, and
  may not claim incompleteness without a named cause.

## The honesty law

Evidence must back every confirmed verdict.
`labelBacksVerdict(label, verdict)`: label `none` backs
`parity-unmeasured` ONLY -- the pair (`none`, `parity-confirmed`) is
unrepresentable. It is rejected by the matrix record guard (the
derivation law: verdict must equal `verdictFor()` over the record's own
fields), rejected by the gate summary reader (the honesty clause), and
proven unreachable by the exhaustive `verdictFor` x `labelBacksVerdict`
coherence grid in evidence.test.ts. On `EvidenceRecord`: label `none`
carries NO artifactRef; every other label cites a non-empty artifactRef
(a repo path or a test-suite name).

## Repo-side usage (the harvester)

1. Per domain, observe the evidence facts and derive the label with
   `labelFor(facts)`; capture the artifact ref into an `EvidenceRecord`.
2. Per domain, obtain the two surface digests (SEAM `ZC010-SEAM-1`) and
   derive the verdict with `verdictFor(...)` -- never hand-set the
   verdict; the matrix guard re-checks the derivation.
3. Observe the discovery checks as `DiscoveryCheckRecord` values; project
   with `discoveryStatusTable(records)`. The `discovery-a11y` gate check
   is green only when all four entries are green; any red or unmeasured
   entry makes it non-green (fail closed).
4. Build the remaining `GateCheckRecord` values (`targeted-tests`,
   `evidence-labels`, `existing-gates`) from the gate runs, each with a
   non-empty `detailDigest`.
5. Call `aggregateVerdict(scope, domainRows, checkRecords)`; read
   `overall` and the named failure lists. Phase C is complete only on
   full evidence-backed green.

## Gates (the TL runs these repo-side)

```
npx tsc -p build/flauz/zcode-patterns/parity/tsconfig.json
npx mocha --ui tdd build/flauz/zcode-patterns/parity/test/common/*.test.ts
grep -rn "Math\.random\|Date\.now\|new Date(" build/flauz/zcode-patterns/parity/common/
```

Gate 3 must show only law-comment lines. Gate 4 (no import statements in
`common/` contract modules) and gate 5 (placement: only
`build/flauz/zcode-patterns/parity/**` in the diff) hold by construction.

## SEAMS (repo-side transcription -- this lane could not read these values)

**ZC010-SEAM-1 -- per-domain surface assignments + digests.** For each of
the ten domains: (a) confirm the ZCode-side sub-surface and the
journey-authority sub-surface (the table above is the proposal derived
from the order's read-list; correct it where the merged trees say
otherwise); (b) compute/record the surface digest for each side per the
harvester's digest convention; (c) build the `DomainComparisonRecord`
rows with `verdictFor(...)`-derived verdicts and `labelFor(...)`-derived
evidence labels. This lane is text-only, and the contract-set law forbids
runtime digest computation -- no digest values are fabricated here.

## Design decisions beyond the order's shorthand

- `aggregateVerdict(scope, domainRecords, checkRecords)`: the leading
  asserted `ParityScope` elaborates the order's two-argument shorthand
  (documented in the gate.ts header); scope-mismatched inputs are counted
  malformed, never silently mixed.
- `authority-mirrored` sits on the third rung of the `labelFor` ladder
  (a structural mirror present but not test-pinned); the order's prose
  pins the other four rungs.
- `labelBacksVerdict()` is the honesty law as a pure relation.
- `DomainComparisonSummary` (gate.ts) is the aggregation reader --
  intentionally weaker than the matrix record guard, which owns the
  derivation law.
- `DiscoveryCheckRecord.observedOutcome` (`pass` | `fail`) keeps a
  definitively failed check distinct from an unestablished one; both
  outcomes require a non-empty `artifactRef` (evidence both ways).
- `discoveryStatusTable()` is the bridge from discovery observations to
  the `discovery-a11y` gate check.
- gate.ts carries the third verbatim copy of the domain / verdict /
  label vocabularies under the zero-dependency law; every duplication is
  pinned deep-equal, and the duplicated guards behaviorally via shared
  batteries, by the suites.
- `tsconfig.json` is the tenth file: gate 1 invokes it and the order's
  nine-file list did not name it; `parity/**` is wholly owned by this
  wave, so it ships here.

## Conventions

Tabs; ASCII only; MIT headers (the repo-canonical box header) on every
file; `.js` import suffixes in tests; mocha tdd `suite`/`test` with
`node:assert/strict`; the determinism law comment in every `common/`
file header.
