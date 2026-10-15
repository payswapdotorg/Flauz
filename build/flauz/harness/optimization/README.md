# DH-012 · the Lab-driven harness optimization loop family (`build/flauz/harness/optimization/`)

SPEC-first charter (registry row DH-012, "Lab-driven harness
optimization"; ARCHITECTURE-LOCK §10 — the Engineering Lab, especially
10.3 Agent Body/model separation, 10.7 the real-task boundary and 10.8
safety; 12.5 the domain-harness law; 12.6 the no-new-authority law).
DH-012 connects the domain harness to the Engineering Lab's workload
profiling, organization search, model/capability selection, simulations
and evaluation, and demonstrates the loop

```
observe workload -> simulate candidate configurations -> compare
  outcomes -> recommend improvement -> obtain required approval ->
  execute through existing Flauz authorities -> measure result ->
  calibrate
```

as ONE typed, staged, deterministic instrument — the optimization loop
kit — that drives EVERY leg THROUGH THE REAL LAB MODULES and the REAL
landed families, never re-implementing any of them: the REAL LAB-002
`learnWorkloadProfile` (workload profiling under the governance gate),
the REAL LAB-005 `searchOrganizations` (organization search over the
fixture body catalog), the REAL LAB-006 `runLadder` over the REAL
deterministic task worlds (`TASK_WORLDS`, seeded and pinned), the REAL
LAB-008 `observeBridgeOutcome` / `buildCalibrationModel` /
`correctScores` (calibration), the REAL DH-11 activation journey
instrument (the execute leg's authority surface), and the REAL DH-09
benchmarks kit (the measure leg's evaluation surface). Everything is
imported by reference (THE IMPORT LAW): the TWELVE prior family
versions, the REAL `LAB_CONTRACTS_VERSION`, the evidence ladder, the
eval vocabulary, the workload / org / ladder / calibration shapes, the
six record families' entry validators and id alphabets, the journey
record links — never transcribed, never re-declared. The loop-stage
vocabulary, the delta vocabulary and the ledger line schema are THIS
family's own.

## THE NO-SECOND-ENGINE LAW (this family's first law)

**The Lab must not become a second scheduler or execution engine.**
The loop RECOMMENDS and RECORDS — it never schedules, never executes
work, never writes a second journal (beyond its own evidence mirror),
never becomes a model router, a capability authority or a persistence
authority. A Lab recommendation becomes a real change only through the
normal Flauz authorities (§10.7): the execute leg routes the approved
delta through the REAL DH-11 journey instrument (which itself drives
the REAL DH-02..DH-09 kits and the REAL DH-01 harness authority
through its own surfaces) and **STOPS at the `composed` stage** — the
proposal, the approval and the activation of the composed
configuration remain the USER's journey through the REAL DH-01
authority. The battery re-reads the REAL harness authority after the
execute leg and pins its state at `draft`: the loop never proposes,
approves or activates anything. The kit source carries the pin that
the execute leg never calls `proposeHarness` / `approveHarness` /
`activateHarness`.

## THE APPROVAL LAW

No recommendation reaches the `execute` stage without the recorded
caller approval decision. `obtainApproval` records the caller's own
decision as the EVIDENCE mirror (`{ approvedBy, note? }` — never
brokered, never an authority); an unapproved execute attempt at ANY
stage is the typed `approval-missing` refusal (the guard fires BEFORE
the walk's frontier check — no approval input, no execution, ever),
leaving the loop record byte-identical. The structural floor is the
frozen required-legs table (the execute op requires the approve leg);
the ledger replay re-proves it from the ledger alone.

## The loop leg map

The staged loop record advances forward-only through the eight frozen
stages (`observe -> simulate -> compare -> recommend -> approve ->
execute -> measure -> calibrate`; `calibrate` TERMINAL — a closed
loop; a new optimization is a NEW loop id, the append-only lineage
law), each leg typed with its own evidence:

| leg | op (the kit surface) | drives | stage |
| --- | --- | --- | --- |
| `observe` | `observeWorkload` | the REAL LAB-002 `learnWorkloadProfile` over the caller-supplied activity records (THE PRIVACY LAW: the raw records are a TRANSIENT input — only the derived `WorkloadLearningResult` ever persists; `optIn: false` refuses the leg) | observe |
| `simulate` | `simulateCandidates` | the REAL LAB-005 `searchOrganizations` over the observed profile (the derived request: the coupled scenario, the dominant task type, the budget/SLA-derived utility weights; THE COHERENCE LAW: no task-world coupling for the observed family refuses the leg) | simulate |
| `compare` | `compareOutcomes` | the REAL LAB-006 `runLadder` over the ranked candidates and the deterministic task worlds (THE REPRODUCIBILITY LAW: the seeds are caller-pinned; two or more seeds run the REAL multi-seed robustness rung) | compare |
| `recommend` | `recommendImprovement` | composes the typed `HarnessOptimizationRecommendation` (the audit / uncertainty / missing-capability / reversibility laws enforced at this boundary) + the REAL `LabRecommendation` minted for the calibration linkage | recommend |
| `approve` | `obtainApproval` | the caller's own approval decision, recorded as evidence | approve |
| `execute` | `executeThroughAuthorities` | the REAL DH-11 journey instrument (reopened over the SAME seams through the REAL `loadActivationKit`): `beginJourney -> selectIndustry -> composeCompany -> selectWorkTypes -> composeRoles -> composeRecords` — every real refusal carried verbatim; the walk STOPS at `composed` | execute |
| `measure` | `measureResult` | the caller-supplied measures through the REAL DH-09 evaluation surface (the REAL `loadBenchmarksKit` + `evaluateBenchmark`; the kit NEVER invents scores) + the caller-supplied REAL `TaskOutcome` | measure |
| `calibrate` | `calibrate` | the REAL LAB-008 `observeBridgeOutcome` / `buildCalibrationModel` / `correctScores` over the loop's OWN evidence (THE LINKAGE LAW: the recommendation, the winning evaluation, the observed outcome and the journey link must all agree) | calibrate |

## THE AUDIT LAW (the typed recommendation)

The `HarnessOptimizationRecommendation` carries its FULL evidence
trail, every leg's real outputs VERBATIM (the REAL
`WorkloadLearningResult`, `OrgSearchResult` and `LadderRunResult`
shapes, imported by reference), the winning evaluation's id and
expected gains (the REAL `BaselineComparison` rows), the REAL
`LabRecommendation` minted for the calibration linkage, the
recommended change (the typed `HarnessDelta`), the reversibility
classification, the uncertainty disclosure and the missing-capability
ledger. The battery pins the verbatim carry by RE-RUNNING the real
modules over the carried requests and asserting byte-identical
answers.

## THE UNCERTAINTY LAW (never a fabricated confidence)

The typed uncertainty disclosure names its evidence level (a REAL
`LabEvidenceLevel` member — **THE EVIDENCE-CEILING LAW: the loop's
ceiling is `simulated`**; a higher rung is the typed
`evidence-ceiling` refusal, never a promotion), its observation counts
(the retained workload records, the simulated candidates, the ladder
seeds) and its calibration state (the REAL `MIN_FACTORS_OBSERVATIONS`
floor: below the minimum the field SAYS SO — the first loop carries
`observationCount: 0`, `belowMinimum: true`, `model: null`; the second
loop carries the first loop's folded model with the honest counts).

## THE MISSING-CAPABILITY LEDGER (the honest-gap law)

The typed ledger carries every required capability the recommended
organization does NOT cover (the REAL `capabilityCoverage` rows over
the winning candidate vs the REAL `FIXTURE_REQUIRED_CAPABILITIES`
table). A gap is REPORTED, never silently dropped; a zero-entry ledger
is the green path (pinned in the battery through a steering scorer
that seats the implementer body, covering every required capability).

## THE REVERSIBILITY LAW (the reversible-first law)

A reversible delta carries its typed rollback path — which family
records to remove/restore, routed through the REAL DH-11 journey
instrument (a rollback is a RECOMPOSITION, never a direct mutation).
An irreversible delta is REFUSED at the recommend boundary
(`irreversible-refused`) unless the caller explicitly acknowledges
irreversibility (`acknowledgedBy`).

## THE MEASURE-CALIBRATE LAWS (the honest-measure law)

The measure leg carries the caller-supplied measures (EvalScore-shaped
rows routed through the REAL DH-09 evaluation surface, which validates
them against the benchmark's declared KPI dimensions — the loop NEVER
invents scores) and the caller-supplied REAL `TaskOutcome`. The
calibrate leg routes through the REAL LAB-008 surfaces and records
what they answered (the minted `CalibrationRecord` rows, the folded
`CalibrationModelResult`, the corrected prediction scores — carried
verbatim).

## The typed refusals (the frozen 19-station walk order)

`disposed`, `unknown-loop`, `malformed-record`, `version-mismatch`,
`premature-stage`, `stale-stage`, `learning-opt-out`,
`scenario-unresolvable`, `search-refused`, `ladder-refused`,
`record-refused`, `evidence-ceiling`, `irreversible-refused`,
`approval-missing`, `malformed-catalog`, `unsafe-delta`,
`journey-refused`, `measure-refused`, `calibration-refused` — every
fail-closed condition typed and named after the REAL law it enforces,
plus the kit-layer extras (`E_LEDGER_TORN`, `E_ENVELOPE_MISMATCH`,
`OPTIMIZATION_IO`, `CORRUPT_SEAM`, `UNKNOWN_FILTER`). Every refused op
leaves the loop record byte-identical (THE RECORD-UNCHANGED LAW,
pinned after every refusal). The unsafe-delta refusals (a delta naming
a non-composed record, a dangling termRef/roleRef/bodyRef) are routed
through the REAL DH-11 journey's own fail-closed laws with the real
refusals carried verbatim.

## The persistence mirror (the PIN-2 pattern)

The loop evidence mirror lands under the same `.flauz/harness` subtree
at its own distinct files: the append-only ops ledger
`.flauz/harness/optimization-ops.jsonl` (one canonical JSON line per
applied op; the seq equals the line number; each line's payload
carries that op's OWN evidence — the observe line carries ONLY the
derived `WorkloadLearningResult`, never the raw activity) and the
envelope `.flauz/harness/optimization-loops.json` (`{
contractVersion, seq, loops }`). The ledger is authoritative;
`loadOptimizationKit` replays it and re-proves the loop laws FROM THE
LEDGER ALONE (the frozen eleven-key line schema, the op<->leg table,
the stage chain through the contract's own machine, THE FORWARD-ONLY
LAW's frontier discipline, THE APPROVAL LAW's structural floor, the
payload walks through the REAL validators, the full record walk after
every applied line), cross-checks the envelope byte-for-byte
(`E_LEDGER_TORN` / `E_ENVELOPE_MISMATCH` — never silently rebuilt).
Lazy persistence; a fresh kit never appends over an existing
non-empty optimization ledger; restart-deterministic. The execute and
measure legs REOPEN the REAL DH-11 / DH-09 kits over their own
persisted ledgers at every call (THE EVIDENCE-NOT-AUTHORITY LAW: no
cached real-kit handle, ever).

## THE CONTENT LAW (this wave's honesty)

**No per-industry loop content is shipped.** This family is the
INSTRUMENT, not content: the caller supplies the activity records,
the delta's domain content (the six record families' entries, the
composition context) and the measures. The evidence level is
fixture/simulated and **never promoted**: the loop's frozen ceiling is
`simulated` (a response model labeled above the ceiling refuses the
recommendation rather than promote); the battery drives the REAL
modules with fixture inputs — claim exactly that. No env is read, no
secrets, no live authorities, no evidence promotion.

## The battery

| suite | file | passing |
| --- | --- | --- |
| optimization contract | `test/common/optimizationContract.test.ts` | 109 |
| optimization kit | `test/common/optimizationKit.test.ts` | 64 |
| **family total** | `test/common/*.test.ts` | **173** |

The crown: THE COMPLETE LOOP HAPPY PATH — observe (the REAL LAB-002
learner over fixture activity records) -> simulate (the REAL LAB-005
search, 117 candidates at the frozen `LOOP_SEARCH_MAX_AGENTS` 2) ->
compare (the REAL LAB-006 ladder, seeded and pinned, the verbatim
carry re-proven by re-running the real module) -> recommend (the typed
recommendation carrying every real output verbatim, the honest
below-minimum uncertainty, the honest missing-capability gap) ->
approve -> execute (the REAL DH-11 journey landing at `composed`, the
REAL DH-01 authority re-read at `draft`) -> measure (the caller's
measures through the REAL DH-09 surface) -> calibrate (the REAL LAB-008
surfaces, re-proven by re-running them) — everything through the real
modules end-to-end. Every fail-closed branch is pinned (the tables
above), the record-unchanged law byte-identical after every refusal,
the privacy pin (the raw activity never persists), the persistence
mirror (write / reload / replay / torn / tampered / drifted-seq /
unknown-op / foreign-version lines / the approval structural floor /
the payload walks / the envelope cross-checks / the fresh-kit guard /
the envelope-rewrite disclosure / the IO refusals / restart
determinism), the serialization round-trip + fail-closed parse, the
determinism greps (law-comment lines only), and THE IMPORT LAW's
source pins (the real modules imported by reference; the execute leg
never calls the proposal / approval / activation ops).

Run recipes (the landed family recipe; the toolchain is preinstalled
— `tsc` at `~/toolchain/node_modules/.bin/tsc`, mocha via
`bunx --bun mocha`):

```sh
~/toolchain/node_modules/.bin/tsc -p build/flauz/harness/optimization/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/harness/optimization/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/harness/optimization/common/*.ts   # law-comment lines only
```
