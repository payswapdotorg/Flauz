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
