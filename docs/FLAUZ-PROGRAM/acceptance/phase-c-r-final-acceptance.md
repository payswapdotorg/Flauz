# CR-013 — Phase C-R Final Acceptance (the formal evidence artifact)

Status: DONE (2026-10-09, wave 7, B3 lane)
Owner: TL-A station lane (CR-013, the final Phase C-R roadmap item — the terminal map verdict, the final acceptance RUN at scale, and this record)
Verified main: `a5d7cf9ca11` (a5d7cf9ca118d4a36344ba5f25b25271fb9d25a3, station rev-parse'd at dispatch — the CR-009 landing + the wave-6 station records)
Branch: `flauz-tlb/cr013-final-acceptance` (credential-free lane: local commit only, never pushed)
Record law: every verdict below derives from a run or a disk walk THIS lane executed; zero promoted labels, zero fabricated numbers. The acceptance record is an evidence artifact — the WiringMap (`build/flauz/zcode-patterns/activation/common/wiring.ts`) stays the only wired/gap authority, and the gap ledger (`build/flauz/journey/simulation/gapClosure.ts`) stays the only closure-verdict derivation (the CR-012 law: output-only, never a second authority).

## Scope

The terminal Phase C-R acceptance over the pinned base: (1) the disk-verified TERMINAL
MAP VERDICT — the mechanical import walk over every one of the ten WiringMap entries'
contractModules, the flip rule applied per entry (the routed-forward decision the
wave-2 record deferred to "the next wave that cites the runtimes as entry points" —
CR-013 is that wave); (2) THE FINAL ACCEPTANCE RUN at LARGE scale (the manual lane
this lane invoked — never claimed in-suite); (3) the seven canonical journeys through
the battery; (4) the simulation gap ledger at the map's post-walk truth; (5) the five
baseline gates re-run at the final tree; (6) the scoped suite census. Nothing is
promoted; every gap that survives survives with a disk-verified reason on record.

## The evidence matrix

Levels from the frozen chain `fixture | simulated | local-real | runtime-real |
live-provider | production-real` — nothing promoted past the strongest honestly
achieved level per dimension.

| # | Dimension | Receipt | Level | Verdict |
|---|---|---|---|---|
| 1 | The terminal map verdict walk | The mechanical import walk (a zero-dep deterministic walk over 2,804 non-test `.ts`/`.mjs` files under `build/flauz` + `extensions`, excluding `*.test.ts`, the test trees, and the map itself; value imports AND type-only imports both counted, reported separately) over all 50 cited contractModules of the ten entries; the flip rule (the map's own four landed-flip standard: non-test runtime consumer + green local-real pinning suite + honest local-real label) applied per entry | **local-real** (the disk walk over the import graph) | **ZC-009 flips gap→wired** (the CLI bin `build/flauz/cli/bin/flauz.ts` VALUE-imports `grammar.ts` + `wire.ts` + `exitcodes.ts`; `cli/runtime/handlers.ts` TYPE-imports `wire.ts`; `cli/runtime/context.ts` TYPE-imports `exitcodes.ts` (HeadlessMode); `journey/battery/battery.ts` VALUE-imports `grammar.ts` + `parity.ts`; the pinning suite `cli/cli.test.ts` runs 60/60 local-real over the real seams) — **ZC-001/002/006/007/010 STAY GAP** (zero non-test consumers each, conditions 1 fails; terminal gapNotes recorded in the map) — **ZC-003/004/005/008 citations verified to hold** (their runtimes VALUE-import their families: hookBus 3/4, observatory 4/4 + the CLI handlers, memoryRuntime 4/4, commandFacade 3/3; suites 54/54, 49/49, 66/66, 38/38) |
| 2 | The LARGE-lane scale receipt | `time node --import tsx build/flauz/journey/simulation/simulate.ts --scale large --root /tmp/cr013-large/run-1` — the honest wall-clock printed by `time` (the harness itself reads no clock): **real 1m18.556s · user 1m18.053s · sys 0m3.284s**; the report's own summary counts are the receipt | **local-real** (the invoker's external measurement, labeled as such) | **96 runs (6 profiles × 16, green 96 / red 0) · 304 registry entries / 1,520 registry journal lines · 384 graphs / 25,120 store journal rows · legs: 1,520 registry + 1,632 store + 384 query + 192 cli + 192 lab + 96 roster = 4,016 green legs (~4,000 receipts with the battery baseline) · ledger: closed 5 / exercised-still-gap 3 / unexercised-still-gap 2 of 10 — DELTAS-VS-PREDICTION: NONE (96=96, 304/1,520=304/1,520, 384/25,120=384/25,120, 864 lab/CLI/roster/query=192+192+96+384, 1,632 store=1,632, 1,520 registry=1,520, ledger = the map's post-walk truth) |
| 3 | The journey battery (the seven canonical journeys) | The battery suite `build/flauz/journey/battery/battery.test.ts` — 29/29 in-tree including the real-driver leg; the journey statuses from the harness manifest (`battery.ts`, the code authority) with their honest evidence labels | simulated + local-real (the battery's own labels, never promoted) | journey-1-coding: 8/8 runnable, 8 simulated (driver: agent-delegation) · journey-2-research: 7 runnable (simulated) + 1 pending (CR-005, the persist-memory step) · journey-3-multi-agent: 7/7 runnable, 7 simulated · journey-4-capability: 5 runnable (local-real, the capability-discovery legs over the real registry) + 4 pending (CR-006 ×2, CR-008 ×2) · journey-5-recovery: 7/7 runnable, 7 local-real (the reload drill + the CR-004 cold-replay drill) · journey-6-cli: 8/8 runnable, 8 local-real (the in-process CLI legs) · journey-7-unsafe-capability: 0 runnable + 5 pending (CR-008; pending-by-design, never a faked pass) — totals 52 steps: 42 runnable-now (22 simulated + 20 local-real), 10 pending-wiring |
| 4 | The simulation gap ledger (the terminal census) | The LARGE-lane report's ledger (`buildGapLedger` over the real WIRING map + the run's own receipts — derived, never asserted): closed **5** (ZC-003/ZC-004/ZC-005/ZC-008/ZC-009), exercised-still-gap **3** (ZC-001 store+battery legs · ZC-002 store+roster legs via the CR-002 runtime binding · ZC-006 registry+query+battery-j4 legs), unexercised-still-gap **2** (ZC-007, ZC-010); byGapOwner {CR-002: 2, CR-006: 1, CR-007: 1, CR-010: 1} — CR-009 retires (ZC-009 is wired; it stays in exercisedCapabilityIds [ZC-001, ZC-002, ZC-006, ZC-009] because exercise never promotes); lab legs map to no entry (no LAB authority) — recorded, never dropped | **local-real** (derived from this lane's run) | **5 / 3 / 2 of 10 — the map's post-walk truth, pinned by the updated simulation suite (56/56)** |
| 5 | The five baseline gates (re-run at the final tree) | `verify-fixtures.sh --quiet` → ALL 232 CASES AS EXPECTED (0 deviations) · `fork-critical-guard.sh --base upstream/main` → PASS, FORK-CRITICAL ledger EMPTY · `compat-battery.mjs --require` → 1887 rows — 1887 PASS · 0 FAIL · 0 SKIP — PASS (Flauz is additive over stock) · `activation-lint.mjs` → ACTIVATION LINT GREEN (the pre-existing R7 WARN stands, config-owned) · `packaging-parity.mjs` → CLEAN (21 extension(s) covered, 71 rows, 0 drift, 0 violations) | local-real | **all five hold their baseline numbers at the final tree — the gates-stay-green law** |
| 6 | The scoped suite census | The §4 receipts, direct (type stripping, node v24.21.0) + mirror-emit (the station recipe, wave-6 form with the extensions fill-in): commandFacade 38/38 · commands contracts 106/106 · observatory 49/49 · observatory contracts 73/73 · memory 66/66 · hookBus 54/54 · bgAgent 46/46 · cli 60/60 · registry 77/77 · gate 69/69 · activation (wiring) 36/36 · dogfood 177/177 · battery 29/29 · simulation 56/56 (mirror; the pins updated to the post-walk truth) | local-real | **every suite holds its exact count — growth nowhere, breakage nowhere (the flip broke nothing)** |

## The terminal ledger table (all ten entries — the disk-verified map truth)

| capabilityId | verdict | owner | the disk-verified reason (the gapNote truth) |
|---|---|---|---|
| ZC-001 common projections | **gap** (exercised-still-gap) | CR-002 | The CR-002/CR-004/CR-005 runtimes routed as these projections' consumers all landed binding their own authorities DIRECTLY (OrchestrationStore/A2ABus, TaskService/ExecJournalStore, MemoryStore) — none imports any of the six projection modules; test-pinned only. The map-vs-runtime delta the ledger exists to expose. |
| ZC-002 background-agent contracts | **gap** (exercised-still-gap) | CR-002 | The CR-002 runtime landed self-contained: `bgAgent.mjs` binds the real OrchestrationStore + A2ABus through validated non-literal dynamic imports and imports NONE of the six launch/inspect/message/control/outcome/registryView families; test-pinned only. |
| ZC-003 hook-bus contracts | **wired** | the CR-003 landing (runtime) | `hookBus.ts` (bindHookBus) VALUE-imports registration/dispatch/policy over the real OrchestrationStore journal + A2ABus; 54/54 local-real. |
| ZC-004 observatory contracts | **wired** | the CR-004 landing (runtime) | `observatory.ts` (ObservatoryRuntime) VALUE-imports all four families over the real TaskService + ExecJournalStore; 49/49 local-real; the CLI's CR-009 handlers additionally consume replay.ts + the runtime. |
| ZC-005 memory contracts | **wired** | the CR-005 landing (runtime) | `memoryRuntime.ts` (MemoryRuntime) VALUE-imports all four families over the real tiered MemoryStore; 66/66 local-real. |
| ZC-006 packs contracts | **gap** (exercised-still-gap) | CR-006 | The exchange runtimes bind the authorities DIRECTLY: `registry.mjs` over its own frozen state.mjs tables; `gate.ts` imports only registry.mjs (its packs references are transcribed comments, never imports); the pack/verification/catalog families are test-pinned only. |
| ZC-007 sources contracts | **gap** (unexercised-still-gap) | CR-007 | The CR-007 adapter kit (sources/adapters/sources/*.ts) binds the source seams directly and is itself consumed only by its own tests; the source/adapter/import families have zero non-test consumers; test-pinned only. |
| ZC-008 commands contracts | **wired** | the CR-009 landing (runtime) | `commandFacade.ts` (CommandFacadeRuntime) VALUE-imports compound/mirror/facade over the real registry + the real CR-008 gate + the real approval lane; 38/38 local-real. |
| ZC-009 CLI contracts | **wired** (the CR-013 terminal-walk flip) | the CR-010/CR-010b landing (runtime; the CR-009 observatory handlers ride it) | The CLI bin (`flauz.ts`, runCli) VALUE-imports grammar/wire/exitcodes; handlers.ts TYPE-imports wire; context.ts TYPE-imports exitcodes; the parity family's consumer is the journey battery (the parity view's designed surface); 60/60 local-real over the real seams. The stale "service-side" gapNote predates the CLI's own landing. |
| ZC-010 parity contracts | **gap** (unexercised-still-gap) | CR-010 | Zero non-test consumers of the discovery/evidence/gate/matrix families — the runtime parity surface that landed is the CLI's own parity view (ZC-009's cli/common/parity.ts), a different family; test-pinned only. |

The stale "CR-XXX owns the activation" phrasing survives NOWHERE in the map: the six
stale gapNotes were rewritten to the terminal disk truths above (five rewrites +
the ZC-009 flip's elimination), each naming the landed runtime(s), the direct-authority
binding, the test-pinned-only status, and the map-vs-runtime delta the ledger exists
to expose — recorded by CR-013 as the terminal state.

## The Phase C-R completion verdict

**Phase C-R is complete-with-honest-gaps.** The runtime-activation program
(CR-002 bgAgent, CR-003 hookBus, CR-004 observatory, CR-005 memory, CR-006 registry,
CR-007 adapters, CR-008 gate, CR-009 command facade, CR-010/010b CLI, CR-012
simulation + gap ledger) delivered real consumers over the live authorities for every
capability family — every landed runtime runs over its real seams (stores, journals,
registries, engines) with local-real pinning suites, and the final acceptance RUN at
LARGE scale exercised the composed surface green end to end (96/96 runs, 4,016/4,016
legs, zero red, in 1m18.556s of honest wall-clock). The map's strict
contract-consumption standard (a non-test runtime module importing the entry's own
contractModules, pinned local-real) is met by **5 of 10 entries** (ZC-003, ZC-004,
ZC-005, ZC-008, and — as of this walk — ZC-009). The remaining five gaps are
disk-verified map-vs-runtime deltas recorded above and pinned in the map's terminal
gapNotes: the runtimes that were routed as those families' consumers landed binding
their authorities directly instead (ZC-001, ZC-002, ZC-006, ZC-007), or no runtime
surface was ever routed to the family (ZC-010). The ledger exists to expose exactly
this class — and now it does, terminally, with every verdict derived and none
promoted.

## Deviations

- **D1 (environmental, disclosed):** the prescribed LARGE-lane invocation
  `node --import tsx …` requires a resolvable `tsx`; the repo tree carries none and a
  repo npm install is forbidden by this order, so the loader was resolved from the
  isolated toolchain (`/home/z/toolchain/node_modules/tsx/dist/loader.mjs` — the same
  package the CR-012 recipe installs outside the tree). Same harness, same scale,
  same root; only the loader resolution differs.
- **D2 (observation, no action taken — the CR-012 D10 class):** the battery README's
  journey-4 table row (0 runnable / 9 pending) predates CR-010b and disagrees with
  `battery.ts`'s manifest (5 runnable local-real / 4 pending); the code is the
  authority and dimension 3 above reports the manifest truth. Out of this order's
  bounded edit set.
- **D3 (observation, no action taken):** the activation README's gap-table row for
  ZC-009 still reads `gap / fixture / CR-009`; the placement law bounds this order's
  edits to the map, the simulation pins, the battery README ledger line, and this
  record. The WiringMap is the only wired/gap authority; the README row is now one
  landing behind it.
- **D4 (expected, not a deviation):** the simulation suite runs in the mirror-emit
  lane only (its lab family imports compiled-style `.js` specifiers; a direct
  type-stripping run fails `ERR_MODULE_NOT_FOUND` on `labContracts.js` by design) —
  §4 prescribes exactly the mirror form, which ran 56/56.

No other deviations: every predicted LARGE-lane count matched the actual receipt
(deltas: NONE), every suite held its exact count, and all five gates held their
baseline numbers at the final tree.
