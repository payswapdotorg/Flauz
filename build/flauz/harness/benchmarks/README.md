# DH-009 · the domain benchmark/simulation-worlds family (`build/flauz/harness/benchmarks/`)

SPEC-first charter (registry row DH-009, "domain benchmark /
simulation worlds"; ARCHITECTURE-LOCK 12.5: a harness may compose
"benchmark/simulation worlds" — a harness layer over the universal
Flauz core, never a fork; 12.6: the no-new-authority law — no second
scheduler, journal, permission broker, model router, resource
registry or persistence authority, and NO second simulation engine:
the REAL LAB-003 task-world registry is the world authority,
imported). A harness is domain-specific through its industry label
(DH-01), its onboarding record (DH-02), its named roles (DH-03), its
domain terms (DH-04), its task/workflow templates (DH-05), its
organization's default agent bodies (DH-06) and its default
capability packs (DH-007) — and through its **benchmarks**: the
named, testable, reproducible benchmark definitions the domain's
work is measured against. This family is the DOMAIN-SIDE BENCHMARK
LAYER: a typed, staged, deterministic `BenchmarksRecord` family
bound to a harness, composing benchmark entries (configuration
only) whose scenario references bind to the REAL LAB-003 task-world
registry, with the family's validation, serialization and
persistence laws. It composes over the landed families — the frozen
industry vocabulary, the harness-id alphabet, the staged-session
architecture and the PIN-2 persistence pattern are imported from
the real modules, never re-implemented (THE IMPORT LAW).

## THE CONTENT LAW (this wave's honesty)

**No comprehensive industry benchmark coverage is claimed.** This
family ships the benchmark/simulation **LAYER**, the machinery —
representative workload binding to the REAL LAB-003 task worlds
(currently the single `world-se-fixtures` software-engineering
fixture world and its three scenarios), not comprehensive domain
coverage. The domain benchmark content comes from the caller and
later waves; this family never invents it. An invented legal /
medical / finance benchmark vocabulary would be an unsourced fork
of domain truth.

## THE EVIDENCE-CEILING DISCLOSURE (this wave's honesty)

A benchmark **definition** in this family is labeled `'fixture'` or
`'simulated'` — nothing higher. The four higher rungs of the REAL
lab evidence ladder (`local-real` / `runtime-real` /
`live-provider` / `production-real`) are the typed
`evidence-promotion` refusal: a benchmark DEFINITION is never
runtime evidence, never overstated. The ladder itself is the REAL
imported `LabEvidenceLevel` union; evaluations inherit the
definition's rung (a claim above it is the typed refusal — runs are
never promoted above their definitions).

## The benchmark laws

- A benchmark entry is CONFIGURATION: exactly
  `{ benchmarkKey, summary, hypothesis, scenarioRefs, kpiDimensions,
  expectedOutcome, limitations, evidenceLevel }` (THE NO-FORK LAW —
  an extra key is the typed no-fork rejection; a benchmark grants
  NOTHING and EXECUTES NOTHING by itself).
- `benchmarkKey`: non-empty, at most 64 chars, no leading/trailing
  whitespace, no control characters; unique within the record.
- `summary`: non-empty, at most 200 chars, no control characters.
- `hypothesis` (THE TESTABLE-HYPOTHESIS LAW): non-empty, at most
  300 chars, no control characters — a statement a run can CONFIRM
  or REFUTE, never a marketing claim.
- `expectedOutcome`: non-empty, at most 300 chars — what the
  hypothesis predicts, stated so an evaluation can confirm or
  refute it.
- `limitations` (THE LIMITATIONS DISCLOSURE): non-empty, at most
  300 chars — the honest statement of what this benchmark does NOT
  cover; a benchmark without limitations text is a typed refusal.
- `scenarioRefs` (THE SCENARIO-BINDING LAW): a NON-EMPTY,
  duplicate-free string array, every member resolving against the
  **REAL imported** LAB-003 task-world registry through
  `getScenario` — never a transcribed id list, never a second
  registry. A fabricated scenario id is the typed
  `dangling-scenario-ref` refusal, proven at `addBenchmark` and
  RE-proven at the finalize boundary and in the ledger replay (the
  two-phase law). The empty-scenario floor fires at the ENTRY level
  (a benchmark with no scenario measures nothing) — this differs
  deliberately from the honest-gap empty-refs law of the earlier
  families: a benchmark entry naming zero scenarios is a typed
  refusal, never a legal gap.
- `kpiDimensions` (THE KPI-VOCABULARY LAW): a non-empty,
  duplicate-free array, every member a **REAL** `EvalDimension`
  (the imported evaluation vocabulary — success / quality /
  latency / cost); a benchmark measuring nothing is a typed
  refusal.
- At most `MAX_BENCHMARKS` (64) entries per record; at least one
  benchmark at finalize (the empty floor fires at the boundary,
  never the record shape).

## The harness binding

The record binds to a harness through the REAL DH-01 harness-id
alphabet (`flauz:hrn:<16-hex>`, imported by reference — the FORM
law, enforced at `beginBenchmarks` and in the record walk). The
EXISTENCE binding is the caller's wiring, never this layer's; the
cross-kit integration pins bind it end-to-end through the real
DH-01 kit.

## The deterministic evaluation surface

Over the frozen COMPOSED record only (a composing record's scenario
set may still change):

- **`instantiateBenchmark(benchmarksId, benchmarkKey, seed, count)`**
  (THE REPRODUCIBILITY LAW): delegates to the REAL imported
  `generateInstances(scenarioId, seed, count)` for each scenarioRef,
  in entry order. Same seed → byte-identical instances (the battery
  pins two seeds); a pure read — no clock, no rng, no ledger line.
- **`evaluateBenchmark(benchmarksId, benchmarkKey, measures,
  evidenceLevelClaim?)`** (THE HONEST-MEASURE LAW): composes typed
  `EvalScore` rows over the REAL `EvalScore` shape — the caller
  supplies the raw measure values and the kit NEVER invents scores
  (a declared KPI dimension without a caller row is the typed
  `missing-measure` refusal, never a zero-filled invention; a row
  outside the declared KPIs is `undeclared-dimension`; a non-REAL
  dimension is `unknown-dimension`; a non-finite value is
  `malformed-measure-value`; two rows for one dimension is
  `duplicate-measure`). The typed benchmark-result record carries
  its `evidenceLevel` — never above `'simulated'`: an absent claim
  inherits the benchmark's own rung, a claim at or below it is
  carried verbatim, a claim above it is the typed
  `evidence-promotion` refusal.
- **`reportCapabilityGaps(benchmarksId, inventory)`** (THE
  CAPABILITY-GAP HONESTY LAW): the typed gap ledger
  `{ benchmarkKey, missing }` naming every benchmark scenario
  requirement (each `scenarioRef`) and every capability requirement
  (each resolved scenario's REAL `taskTypeId`, through the imported
  `getScenario`) NOT present in the CALLER-SUPPLIED inventory —
  honestly, never silently dropped, never invented. A benchmark
  with nothing missing carries no gap row; a zero-gap ledger is the
  green path. A malformed inventory is the typed
  `malformed-inventory` refusal.

## The staged model + the append-only lineage law

`composing -> composed`; `composed` is TERMINAL (THE APPEND-ONLY
LINEAGE LAW — a changed benchmark is a NEW benchmark, never a
mutation of a composed one; every mutating op on a composed record
refuses with the typed stale-stage refusal). A benchmark's key is
its identity (THE REMOVE+RE-ADD LAW): `replaceBenchmarkSummary`
replaces only the summary; a changed benchmarkKey is a new
benchmark (remove, then re-add); removing the last benchmark is
legal while composing. `emitEvidenceRef` emits the composed
record's id as the evidenceRef string — a pure read, only from a
COMPOSED record. The emitted reference rides the DH-02 review
composition's `evidenceRefs` family (a string, duplicate-free),
pinned end-to-end through the REAL
`validateOnboardingReviewComposition`.

## The persistence model (the PIN-2 mirror)

The append-only ops ledger `.flauz/harness/benchmarks-ops.jsonl`
(one canonical JSON line per applied op; the seq equals the line
number) and the envelope `.flauz/harness/benchmarks-records.json`
(`{ contractVersion, seq, records }`). The ledger is authoritative;
the finalize line carries a NULL payload — this wave's honest
deviation from the DH-006/DH-007 finalize-payload precedent: the
boundary authority is the REAL imported task-world registry (code,
never a caller-supplied record), so nothing caller-supplied is
ledger-carried; the replay re-proves the boundary laws (the
scenario binding, the vocabulary legs, the empty floor) from the
ledger's own payloads through the imported registry.
`loadBenchmarksKit` replays the ledger and cross-checks the
envelope byte-for-byte (`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` —
never silently rebuilt; a version-bearing surface carrying another
contract version is the typed version-mismatch — the six-key record
carries no version field). Lazy persistence; a fresh kit never
appends over a non-empty ledger; restart-deterministic.

## The battery

| suite | file | passing |
| --- | --- | --- |
| benchmarks contract | `test/common/benchmarksContract.test.ts` | 79 |
| benchmarks kit | `test/common/benchmarksKit.test.ts` | 79 |
| **family total** | `test/common/*.test.ts` | **158** |

Run recipes (the landed family recipe; the toolchain is preinstalled —
`tsc` at `~/toolchain/node_modules/.bin/tsc`, mocha via `bunx --bun mocha`):

```sh
~/toolchain/node_modules/.bin/tsc -p build/flauz/harness/benchmarks/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/benchmarks/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/benchmarks/common/*.ts   # law-comment lines only
```
