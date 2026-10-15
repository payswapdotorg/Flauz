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
