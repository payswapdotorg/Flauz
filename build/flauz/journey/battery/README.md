---------------------------------------------------------------------------------------------
 Copyright (c) Flauz contributors. All rights reserved.
 Licensed under the MIT License. See LICENSE in the repository root for license information.
---------------------------------------------------------------------------------------------

# the journey battery (CR-011, wave 1)

The seven canonical Phase C-R journeys as a runnable harness with
HONEST per-step statuses: `runnable-now` (executes against real seams
today) vs `pending-wiring` (a typed record naming the owning CR --
never faked, never reported as passing).

Sibling index: `../simulation/` -- CR-012, the large-scale cross-industry
simulation + gap-closure ledger over the same real seams
(`industries.ts` / `simulate.ts` / `gapClosure.ts` / `simulation.test.ts`).

## The journeys

| id | steps | runnable | pending | labels |
|---|---|---|---|---|
| journey-1-coding | 8 | 8 | 0 | 8 simulated (driver: agent-delegation) |
| journey-2-research | 8 | 7 | 1 (CR-005, memory) | 7 simulated (driver: tools-exploration) |
| journey-3-multi-agent | 7 | 7 | 0 | 7 simulated (driver: agent-delegation) |
| journey-4-capability | 9 | 0 | 9 (CR-006 x5, CR-007 x1, CR-008 x3) | -- |
| journey-5-recovery | 7 | 7 | 0 | 7 local-real (the reload drill + the CR-004 cold-replay drill) |
| journey-6-cli | 8 | 8 | 0 | 8 local-real (the in-process CLI legs) |
| journey-7-unsafe-capability | 5 | 0 | 5 (CR-008) | -- |

Totals: 52 steps -- 36 runnable-now (22 simulated, 14 local-real),
16 pending-wiring.

## The evidence-label law

Driver-exercised legs are `simulated` (the fake model lane over REAL
seams -- never promoted). The J5 reload drill and the J6 CLI legs are
`local-real`. Pending steps carry NO label, only the pendingOwner.

## The runner

`runBattery({ root, runId?, driverRunner?, clock? })` executes the
runnable-now journeys: the J1/J2/J3 legs invoke THE EXISTING dogfood
driver as a child process (the full run -- the driver's usage header
documents no per-exercise selection flag, so receipts are selected
from its output; the order's pre-authorized fallback), the J5 reload
drill and the J6 CLI legs run in-process through the CLI's real
service-context port. Receipts are deterministic: two runs over the
same root with the same inputs are byte-identical modulo the runId.
The battery writes NOTHING outside its given root (the driver child
gets --out and TMPDIR inside the root and a sanitized environment
with no live-provider contract present).

## The CR fill-in plan

- CR-002/003 (approvals live surface): flips approval.list/respond
  and the J6 approval leg from typed refusal to wired.
- CR-004 (cold replay): flips replay.* and the J5 replay step.
- CR-005 (memory runtime): flips the J2 persist-memory step.
- CR-006/007/008 (capability registry/verify/safety): flip J4 (all
  nine steps), J7 (all five), capability-discovery.*.

## Tests

        NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/journey/battery/battery.test.ts
CR-012 — THE LARGE-SCALE CROSS-INDUSTRY SIMULATION + GAP-CLOSURE LEDGER
Branch: flauz-tlb/cr012-large-scale-simulation (one commit, no merges, no rebases)
Base:   51a95088575e2afdeedd183ad208c42c151e9e2b (main, station rev-parse'd)
Delivery: SIX files, all additive — five new files under build/flauz/journey/simulation/
plus exactly ONE index row added to build/flauz/journey/battery/README.md. Zero edits
elsewhere. Text-only lane: the fenced blocks above are the authoritative bytes.

FILES (line counts approximate as delivered; char counts are station-verifiable via
wc -c — not machine-verified in this lane):
  1. build/flauz/journey/simulation/industries.ts       ~330 lines (fixture profiles, zero imports)
  2. build/flauz/journey/simulation/simulate.ts         ~820 lines (the harness over the real seams)
  3. build/flauz/journey/simulation/gapClosure.ts       ~300 lines (the pure closure ledger)
  4. build/flauz/journey/simulation/simulation.test.ts  ~660 lines (56 mocha tdd tests)
  5. build/flauz/journey/simulation/tsconfig.json       22 lines (verbatim copy of the battery's)
  6. build/flauz/journey/battery/README.md              battery README + 1 index row (the only edit)

One-line delivery statement: the large-scale cross-industry simulation now exists as a
measurement instrument over the real registry/store/CLI/lab/battery seams, and every
activation WiringMap entry carries an evidence-labeled gap-closure verdict.
# CR-012 REPORT — THE LARGE-SCALE CROSS-INDUSTRY SIMULATION + GAP-CLOSURE LEDGER

## FILES
1. industries.ts — six frozen cross-industry profiles (fixture-labeled, pure data, zero imports).
   Parameters over existing surfaces only: real battery stepIds, the lab's frozen scenario/
   task-type vocabularies, the J4-validated single capability shape, per-profile density.
2. simulate.ts — runSimulation({root, industries, scale, batteryDriver}): real registry +
   real OrchestrationStore (via the CR-002 bgAgent binding) + read-shaped real CLI legs +
   real lab engine + one battery baseline, per profile × run, with typed per-leg receipts,
   injected-clock step measurements, growth series, and simulation-report.json (canonical
   JSON, root-independent). Manual-lane entry (direct-run guarded): --scale large.
3. gapClosure.ts — buildGapLedger({simulationReceipts, wiringEntries}): the pure closure
   ledger over the real WIRING map; frozen leg→surface map; verbatim owner/note carry;
   closed / exercised-still-gap / unexercised-still-gap verdicts; never mutates, never promotes.
4. simulation.test.ts — 56 tdd tests (target was 35+).
5. tsconfig.json — verbatim copy of the battery's scoped strict config.
6. battery/README.md — +1 sibling index row (the ONLY edit outside the new subtree).

## GATES — NOT EXECUTED IN THIS TEXT-ONLY DELIVERY (no outputs fabricated; the station runs and pastes)
1. npx tsc --noEmit -p build/flauz/journey/simulation/tsconfig.json  → expected EXIT 0.
   Known sole compile bet (D4): the static lab imports transitively typecheck labContracts.ts /
   agentBodies.ts (unseen bytes; landed, tested lab lane). Fallback if red: the context.ts
   non-literal dynamic-import discipline for runEngine/orgSearch — a small disclosed patch.
2. NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/journey/simulation/simulation.test.ts
   → expected 56/56 green. Heavy tests carry 120s–600s timeouts (the suite runs the modest lane
   twice for the byte-determinism double-run; the battery's own real-driver test already sets
   the 600s precedent). Two tests are seam-behavior bets, disclosed: the workflow.view-over-a-
   real-graph outcome (asserted ≠ not-found — a genuine cross-instance activation proof) and
   the store runnerId (the binding's resolved vocabulary.from). A red there is an honest finding.
3. Determinism grep (Date.now|Math.random|new Date\() over the six files → expected ZERO hits
   (self-audited while authoring: the modules read no clock anywhere; the manual lane is timed
   externally by its invoker).
4. git diff --stat → expected EXACTLY the six files (5 new + the README row).
5. Manual large lane (disclosed, NOT run here — never claim scale you did not run):
   time node --import tsx build/flauz/journey/simulation/simulate.ts --scale large --root <fresh-dir>
   → the timing printed by `time` is the honest wall-clock measurement (the harness itself reads
   no clock). PREDICTED summary counts (station-verifiable): 6 profiles × 16 runs = 96 runs;
   304 registry entries / 1,520 registry journal lines; 384 graphs / 25,120 store journal rows;
   864 lab/CLI/roster/query legs, 1,632 store legs, 1,520 registry legs (~4,000 receipts total);
   ledger 0/4/6 of 10.

## DEVIATIONS (all pre-declared, all disclosed in-code and in-report)
D1  state.mjs never pasted → the one-shape capability lane: every registry leg uses the J4-validated
    artifact shape (community-project / cli / linux-x64 / MIT / 1.0.0 / [read-files]); profiles vary
    density (entryShare 2–6), never kind; the permissionTier query leg is struck (RISK_TIERS unknown).
D2  orchestration.mjs never pasted → runnerId = the binding's own resolved vocabulary.from; actor =
    vocabulary.actor; step ids held to the drill-validated two-digit form (≤32 steps/graph);
    intermediate registry states and graph statuses are banked verbatim, never predicted.
D3  bgAgent.mjs has no confirmed on-disk declaration → bound via non-literal dynamic import +
    structural validation + local mirrors (the cli/runtime/context.ts discipline).
D4  labContracts.ts / agentBodies.ts never pasted → static import of runEngine/orgSearch (in-repo
    TypeScript); organization candidates obtained ONLY from the real searchOrganizations, never
    hand-built (this is also why the D4 compile bet is contained).
D5  Decision 1 default implemented: lab legs = local-real executions with the engine's own
    evidence level (fixture) banked verbatim and never promoted.
D6  Decision 2-A default implemented: runBattery once per simulation over battery-baseline/ with an
    injected STUB driver (deterministic record); the real driver lane remains the battery suite's
    own real-driver test. journey-7's red verdict is pending-by-design, not a failure.
    Battery drill digests/runIds/paths excluded from the report (its reload drill seeds with the
    store's default clock — only stable booleans banked), preserving cross-root byte-determinism.
D7  R1 calibration implemented (silence-ruled default): entriesPerRun splits into entryShare registry
    pipelines + the remainder as store steps. The registry's full-snapshot rewrite per mutation is
    itself a measured, ledger-visible scale finding.
D8  a2a.mjs never pasted → the CR-002 launch/route/delegation thread is struck; the orchestration
    surface is exercised via the store legs + the roster projection.
D9  scale.seeds implemented as a derivation salt (default 0) on the battery's sha256 form.
D10 Verification battery not executed in the text-only lane — commands + expected shapes above;
    nothing fabricated; the manual large lane is provided, not claimed.
    Emission note: this re-emission is byte-faithful to the prepared delivery except three
    micro-cleanups (an unused import and dead statements removed from simulate.ts; the ledger
    purity test's second assertion made a genuine re-derivation; one predicted leg-count corrected).
    Observation (no action taken): the battery README's journey-4 table row predates CR-010b and
    disagrees with battery.ts's manifest; the code is the authority.

## EVIDENCE
- fixture: the six industry profiles (parameters only), the lab's fixture world/response model
  (engine-labeled, carried verbatim), the J4-validated registry payloads.
- local-real: every registry, store, roster, query, and CLI leg (real seams, real node fs, injected
  clock); every lab leg (the real engine executed); the battery baseline's j4/j5/j6 legs (the
  battery's own labels carried).
- simulated: the battery baseline's driver legs (stub-injected, disclosed; the battery's own label).
- Never promoted anywhere; the map stays the only wired/gap authority.

## THE LEDGER SUMMARY (the map's current shape; pinned by tests)
10 WiringMap entries — 4 closed (the ZC-003/ZC-004/ZC-005 station flips + the ZC-008 wave-6 flip), 4 exercised-still-gap, 2 unexercised-still-gap:
  ZC-001 (CR-002) exercised — store legs + battery driver baseline (AGENT_OS orchStore stateSource)
  ZC-002 (CR-002) exercised — store + roster legs via the CR-002 runtime binding
  ZC-003 (CR-003) closed — the hook-bus runtime landed (54/54 local-real); the map state is wired
  ZC-004 (CR-004) closed — the observatory runtime landed (49/49 local-real); j5-s4 replay graduated
  ZC-005 (CR-005) closed — the memory runtime landed (66/66 local-real); the map state is wired
  ZC-006 (CR-006) exercised — registry + query legs + battery j4 baseline
  ZC-007 (CR-007) unexercised — sources contracts untouched
  ZC-008 (CR-009) closed — the command-facade runtime landed (38/38 local-real over the real
        registry + the real CR-008 gate + the real approval lane); the map state is wired
        (the wave-routing disclosure: the entry's stale gapOwner 'CR-008' predates the wave
        replanning — the CR-009 wave landed the runtime consumer)
  ZC-009 (CR-009) exercised — CLI legs + battery j6 baseline (the map-vs-runtime delta the ledger exists to expose)
  ZC-010 (CR-010) unexercised — parity contracts untouched
Owners: CR-002 ×2; CR-006/007/009/010 ×1 each. Lab legs map to no entry (no LAB
authority in the map) — recorded, never dropped.

## SCALE
- In-suite lane: tiny (1×1×6, 6×1×8) for the smokes + MODEST 6 profiles × 8 runs × 32 entries for the
  double-run determinism proof (48 runs; predicted 152 registry entries / 760 registry journal lines /
  48 graphs / 2,912 store journal rows — formula-pinned by tests).
- Manual-only lane: LARGE 6 × 16 × 128 (never claimed in-suite; command + predicted counts in GATES).
- All durations are injected-clock steps; the only wall-clock numbers are the invoker's external
  `time` measurements of the manual lane.