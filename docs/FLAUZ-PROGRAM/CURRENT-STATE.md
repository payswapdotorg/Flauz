# Flauz Current State

Program control-plane refresh: 2026-10-01
Integrated product branch: `main`
Integrated head: resolve live with `git rev-parse main`

## Completed baseline

- TL1/TL2/TL3/TL4 foundation portfolios: DONE.
- Registered hardening and live-provider verification: DONE.
- P2-001 control-plane reconciliation: DONE.
- P2-002 full product acceptance: DONE — 14/14 runtime-real legs, 110 assertions, 0 failures.
- P2-003 user discovery audit: DONE — 23 PASS / 0 KNOWN-GAP after the closure wave.
- P2-FIX-108 packaged-assets packaging contract: DONE.
- P2-FIX-112 platform-surface review: DONE.

## Current active program

**Two-TL Product Completion and Engineering Lab**

Canonical roadmap:
`docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`

Active handoffs:

- TL-A: `docs/FLAUZ-PROGRAM/TL-A-PRODUCTIZATION-HANDOFF.md`
- TL-B: `docs/FLAUZ-PROGRAM/TL-B-ENGINEERING-LAB-HANDOFF.md`

## TL-A status

TL-A owns the remaining inherited acceptance tail, final independent verification, dogfooding, beta, production and post-production reliability.

Remaining inherited P2-FIX items:

- 102 — dedicated battery/session tsconfig landing gate;
- 106 — browser popup-gate placement redesign;
- 107 — record-time URL redaction;
- 109 — executor cancellation/reconciliation;
- 110 — remotePidAlive unverifiable outcome;
- 111 — restoration-family vocabulary alignment;
- 113 — keyed/signed hash-chain decision or explicit bounded deferral.

P2-FIX-108 and P2-FIX-112 are closed.

Historical TL3/TL1 claim records are retained for provenance. Unmerged worker branches are not product state.

## TL-B status

TL-B owns the Engineering Lab vertical:

- workload profiling;
- task taxonomy;
- simulated task worlds;
- Agent Body library;
- organization search;
- model occupancy search;
- tool/capability search;
- evaluation;
- calibration;
- Lab console;
- real-task bridge;
- personalized closed-loop optimization.

TL-B can proceed independently with deterministic fixtures and a fake execution adapter until the production integration surface is ready.

## Independence law

Neither TL waits for the other.

TL-A must be able to finish productionization without the Lab.

TL-B must be able to finish Lab simulation/search/UI without productionization.

Cross-TL execution is contract-only:

`LabRecommendation -> AgentTask / Workflow / Session -> existing Flauz authorities`.

## Post-production target

After both lanes pass their own acceptance gates:

Dogfood -> Beta -> Production -> Post-production reliability loop -> personalized Engineering Lab optimization.

## Evidence law

Use:

`fixture | simulated | local-real | runtime-real | live-provider | production-real`.

Never promote a lower evidence level by wording alone.

## Control-plane law

When this file conflicts with `main`, `ARCHITECTURE-LOCK.md`, `MASTER-ROADMAP.md` or `WORK-REGISTRY.md`, those higher-authority sources win.


## TL-B Phase C status — ZCode-derived product patterns + Capability Exchange

LAB-001..011 are complete. TL-B is authorized to begin Phase C independently of TL-A. The protected productionization surfaces remain TL-A-owned; Phase C uses additive build/ext surfaces, stable contracts and station-owned generated artifacts only.


## Fresh-chat continuation state — 2026-10-07

Active reconstruction documents:
- `docs/FLAUZ-PROGRAM/FRESH-CHAT-TL-A-HANDOFF.md`
- `docs/FLAUZ-PROGRAM/FRESH-CHAT-TL-B-HANDOFF.md`

Verified frontier:
- TL-A: A-PROD-006 sustained production-operation closure.
- TL-B: Phase C-R is active; current `main` has advanced through CR-008, so inspect the registry before claiming remaining CR items.
- TL-B strategic next layer: Domain Harness OS plus Free Inference Fabric.
- Chat history is not required for reconstruction.

Free-tier decision:
- Free plan = unlimited Flauz usage, not unlimited provider tokens.
- Prefer per-user/direct/local inference capacity.
- Do not pool third-party free-tier API keys into a shared public Flauz gateway.
- FreeLLMAPI is reference/optional adapter technology, not an authority or required dependency.


## Control-plane refresh — 2026-10-15 (TL-B reconciliation)

Verified frontier at `main` head `1430141c358f6460b437346bfc794076fc43b781` (the pre-reconciliation head; station-verified this session: the seven DH family tsc gates EXIT 0, the DH family batteries 938/938 passing, the production/ops sibling battery 137/137 passing).

Completed work (preserve; evidence levels as registered):

- Phase C-R: COMPLETE — CR-001..013 landed; the terminal acceptance ledger reads closed=5 / exercised-still-gap=3 / unexercised-still-gap=2 (the three exercised-but-unresolved integration gaps and two unexercised gaps remain OPEN ledger rows, tracked not closed).
- INF (Free Inference Fabric): COMPLETE — INF-001..009 landed (fixture-evidence implementation workstream; PRs #179..#191). The INF-009 live-provider acceptance canary remains an env-gated clean-SKIP: no live-provider exchange at the INF-009 boundary is verified until a successful, appropriately configured run is recorded. The earlier TL2-H1 live-provider drill (4/4) remains its own separate record.
- DH (Domain Harness OS): waves 1-7 COMPLETE — DH-001..007 landed (PRs #193..#198): the DomainHarness contract, onboarding, role composition, ontology, task/workflow templates, Agent Body/organization defaults and capability-pack population families; 938 passing family tests. These establish reusable contracts and composition layers — NOT a finished, populated, end-to-end industry harness.
- TL-A: the first production-real deployment is recorded closed — LIVE https://flauz-web.vercel.app, product version 0.2.0, PR #192 (`ce92e834`), with the production smoke battery and the E2E boot receipt (production-real evidence).

Remaining work:

- TL-B: DH-008 through DH-013 (the outstanding Domain Harness OS sequence).
- TL-A: sustained production-operation closure under A-PROD-006 remains OPEN (TL-A-owned).
- Inference Fabric: the live-provider acceptance exchange remains UNVERIFIED (env-gated skip) — do not describe it as verified until a configured successful run is recorded.

The work registry (`WORK-REGISTRY.md`) is the operational source of truth; this section reconciles this document to it as of 2026-10-15. Historical sections above are preserved unchanged.

## Addendum — 2026-10-15 (later, TL-B): Wave 8 landed

DH-008 (policy/approval/evidence/KPI profiles, PR #199 `f83687163f`) and DH-009 (domain benchmark/simulation-worlds, PR #200 `75c239fa9a`) are DONE. The remaining TL-B sequence is now **DH-010 through DH-013**. The DH family test total is 1252 at the merged head (registry landing record at `ed06a93c074`).

## Addendum — 2026-10-15 (later, TL-B): Wave 9 landed

DH-010 (domain UI/navigation projections + the flauz-harness workbench surface, PR #201 `032e7b0369`) and DH-011 (the end-to-end onboarding→activation journey family, PR #202 `36285b9dc78`) are DONE. The remaining TL-B sequence is now **DH-012 and DH-013**. The DH family test total is 1561 at the merged head (+99 extension-surface tests).

## Addendum — 2026-10-15 (later, TL-B): Wave 10 landed

DH-012 (the Lab-driven harness optimization loop, PR #203 `e79cfe73b65`) is DONE. The remaining TL-B item is **DH-013 (cross-industry harness acceptance) — the final row**. The DH family test total is 1734 at the merged head.

## Final state — 2026-10-15 (TL-B): THE DOMAIN HARNESS OS SEQUENCE COMPLETE

DH-013 (the cross-industry harness acceptance family, PR #204 `e2d738074`) is DONE — **the DH-001..DH-013 sequence is complete**. Thirteen harness families live on main at `147a7dd5d30` with **1,868 passing family tests** (+ production/ops 137 + the flauz-lab/flauz-harness workbench surfaces 99), verified at the merged head. The cross-industry acceptance (software · finance · healthcare · construction) proves the composition-not-fork law programmatically and registers the six-row honest gap ledger verbatim.

**The registered residue (tracked, not closed):**
- The DH gap ledger's six rows (registry wave-11 record): LAB industry task-worlds coverage · content representativeness · no live-provider execution · no production-real harness deployment · workbench runtime binding · the CR ledger integration gaps.
- TL-A: sustained production-operation closure under A-PROD-006 remains OPEN (TL-A-owned).
- INF: the live-provider acceptance exchange remains UNVERIFIED (env-gated skip) until a configured successful run is recorded.

The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.


## Addendum — 2026-10-16 (TL-B): the DH gap ledger row 1 closed (the lab industry task-worlds)

The registered residue's first row — LAB industry task-worlds coverage — is closed: the three industry fixture task-worlds (finance · healthcare · construction) are shipped to the LAB-003 fixture lane on branch `flauz-tlb/dh-gap1-lab-worlds` (PR placeholder #205 — the station fills the PR number at merge), composed over the REAL task-world engine with the industry extension registry disclosed (the landed registry census unchanged, pinned by the landed batteries; the combined catalog composed by import). The lab family state: 331 passing tests (210 landed, unmodified + 121 new), the scoped lab tsconfig gate EXIT 0, determinism greps law-comment-only. The DH-009 benchmark binding for the new scenarios is skipped with the reason disclosed (the binding law resolves against the landed registry — never forced). The remaining registered residue: the gap ledger's rows 2-6 (content representativeness · no live-provider execution · no production-real harness deployment · the workbench runtime binding · the CR ledger integration gaps), TL-A's sustained production-operation closure (TL-A-owned), and the INF live-provider exchange (env-gated skip). The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.


## Addendum — 2026-10-16 (TL-B, later): the DH gap ledger rows 1-2 closed in the acceptance family (content representativeness + the row-1 propagation)

The registered residue's first two rows are closed IN the acceptance family's own frozen ledger (the DH residue wave 2, branch `flauz-tlb/dh-gap2-content`, PR placeholder #206 — the station fills the PR number at merge): row 1 (LAB industry task-worlds coverage) now carries its CLOSED successor state — the closure of the GAP-1 landing propagated from the registry record into the ledger row itself, with the fixtures' expectedGaps and honest-gap-law comments updated (no fixture registers the closed row; the report never carries a false registry claim) — and row 2 (content representativeness) is closed by the declared censused representativeness bar: each industry's curated content at least doubled (six roles, ten terms, four tasks, four bodies, four packs, two profiles — real domain-shaped, fixture-labeled, no domain-truth claims), the census pinned by the battery and the content-census disclosure riding every report. The four fixtures now ALL carry curated benchmarks through the two frozen binding modes (software: the base-registry binding over the REAL three SE scenarios; finance/healthcare/construction: the industry-extension bindings over their OWN worlds' REAL scenarios through the combined catalog — the REAL imported lab extension registry lookups), and all four benchmark legs are EVALUATED (the industry legs through the acceptance family's combined-catalog composition over the REAL imported `generateTaskInstances` engine entry point; the DH-09 records still compose the registry-bound floor entries — the honest split disclosed). The acceptance family state: 161 passing tests (66 contract + 95 runner, re-pinned and grown from 134; every re-pin disclosed), the scoped tsc gate EXIT 0, determinism greps law-comment-only, the lab battery 331 unchanged. The remaining registered residue: the gap ledger's rows 3-6 (no live-provider execution · no production-real harness deployment · the workbench runtime binding · the CR ledger integration gaps), TL-A's sustained production-operation closure (TL-A-owned), and the INF live-provider exchange (env-gated skip). The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.


## Addendum — 2026-10-16 (TL-B, later): the DH gap ledger rows 1-3 closed in the acceptance family (the live-provider execution row)

The registered residue's third row — no live-provider execution (the INF boundary) — is closed IN the acceptance family's own frozen ledger (the DH residue wave 3, branch `flauz-tlb/dh-gap3-live-provider`, PR #207): row 3 now carries its CLOSED successor state, recording the INF-009 canary's station-verified live-real run (2026-10-16, exit 0: endpoint reachable, probe 200 OK; the COMPLETED exchange recorded as a live-real DrillRecord — drillClass 'acceptance-exchange', verdict 'eligible', 8 landed byte citations — over the station's REAL provider endpoint, the platform's sanctioned inference gateway, a REAL chat-completion round-trip with the raw secret station-side and the drill binding only the opaque handle; the canonical ledger line reading back byte-identical through the live kit; the same line over a fixture-configured port refused as the typed 'no-live-port' rejection). The closure rides the row verbatim (never by silent removal), 'no-live-provider-execution' joins the frozen closed-key list, and the landed closed-row refusal machinery now covers rows 1-3 at every walk; the four industry fixtures register exactly the three open rows, and the family's own task-execution evidence ceiling stays fixture-labeled (the live-real evidence lives at the INF boundary, never claimed here). The acceptance family state: 161 passing tests (66 contract + 95 runner, re-pinned with every re-pin disclosed), the scoped tsc gate EXIT 0, determinism greps law-comment-only, the INF acceptance battery 180 unchanged (the family untouched except the README receipt row), the lab battery 331 unchanged. The remaining registered residue: the gap ledger's rows 4-6 (no production-real harness deployment · the workbench runtime binding · the CR ledger integration gaps) and TL-A's sustained production-operation closure (TL-A-owned). The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.


## Addendum — 2026-10-16 (TL-B, latest): the DH gap ledger rows 1-3 and 5 closed in the acceptance family (the workbench runtime binding row)

The registered residue's fifth row — the workbench surface runtime binding — is closed IN the acceptance family's own frozen ledger (the DH residue wave 4, branch `flauz-tlb/dh-gap5-binding-drill`, PR #208): row 5 now carries its CLOSED successor state, recording the binding drill's station-verified bun-lane run (2026-10-16, exit 0, run twice: the flauz-harness extension's runtime port — `src/flauzHarnessPort.ts`, the only cross-lane runtime edge — executed END-TO-END over the REAL Domain Harness OS kits: the port open over a fresh temp root, the REAL frozen vocabularies, the DH-02 session walk industry → company → work-types → review, the DH-03 compose+emit at the same root, the propose boundary minting the harness 'flauz:hrn:0000000000000007' through the inner REAL DH-01 kit with the deterministic injected seams, the REAL DH-010 nine-section projection over the minted harness with the honest not-composed families, and the closed activation door pinned on the port surface — exactly the twelve ops + the id/mode data keys, no activation, the DH-01 authority keeps the lifecycle; the determinism double-run byte-equal). The drill lives at `extensions/flauz-harness/test/flauzHarnessPort.binding.drill.ts` — its `.drill.ts` suffix keeps it outside the node `--test` glob (the extension's node lane still never imports the binding, the letter of the flauz-lab law kept; Node type stripping cannot resolve the kits' `.js` specifiers) while bun resolves those specifiers natively — the same runner law the build/flauz family batteries document. The closure rides the row verbatim (never by silent removal), 'workbench-surface-runtime-binding' joins the frozen closed-key list, and the landed closed-row refusal machinery now covers rows 1-3 and 5 at every walk; the four industry fixtures register exactly the two open rows. The acceptance family state: 161 passing tests (66 contract + 95 runner, re-pinned with every re-pin disclosed), the scoped tsc gate EXIT 0, determinism greps law-comment-only, the extension typecheck EXIT 0, the extension node lane 66/66 unchanged, the INF acceptance battery 180 unchanged, the lab battery 331 unchanged. The remaining registered residue: the gap ledger's rows 4 and 6 (no production-real harness deployment, TL-A-coordinated · the CR ledger integration gaps — no longer contiguous: row 5 closed between them) and TL-A's sustained production-operation closure (TL-A-owned). The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.


## Addendum — 2026-10-17 (TL-A): the sustained production-operation closure — A-PROD-006 COMPLETE

The TL-A-owned registered residue's last row is closed: **the sustained production-operation closure under A-PROD-006 is COMPLETE** (the registry's W9 landing record is the operational source of truth for the full inventory). The closure evidence: 5 local revolutions + 2 production-real revolutions on record; 6 release identities (v0.1.0 → v0.2.1); 2 REAL incidents driven through the frozen-stage lifecycle end-to-end (A-PROD-006-W4-I1; INC-W8-PARITY-GAP); the six-row LIVE battery 8/8 at both production identities; the LIVE ledger census with the closure row banked (`flauz:prd:fdc6f5f1782d2021` the repo-side local-real twin; the production-real twin on Neon). The honest disclosures ride the registry record verbatim: the macOS CI red (long-standing platform item, root-cause pending, never hidden), the local-ensureSchema posture, and the remaining registered residue — the DH gap ledger's rows 4 + 6 (TL-B lanes; row 4 TL-A-coordinated with the production evidence staged at the LIVE 0.2.1 surface).

The verified frontier after the closure: **TL-B's gap-ledger rows 4 + 6** (the residue waves; row 4's production-real harness deployment evidence awaits TL-B's closure wave), the disclosed platform items (macOS CI root-cause; the host-swap OOM class), and the sustained surface watch (the resident console posture). The INF-009 live-provider exchange is station-verified live-real per the GAP-3 record — no open INF residue per the registry terminal state. The work registry (`WORK-REGISTRY.md`) remains the operational source of truth.
