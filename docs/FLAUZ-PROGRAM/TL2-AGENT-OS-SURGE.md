# TL2 Agent OS Surge — 2026-09-28

> **Status: COMPLETE (reconciled 2026-09-29, P2-001).** All three secondments
> merged — TL2-S1 (PR #26 `dabe2ebc`), TL2-S2 (PR #28 `04fa8f95`), TL2-S3
> (PR #30) — and the completion rule below is demonstrated by the Agent OS
> runtime census (8 PASS / 0 FAIL / 0 SKIP, `agentos-battery.mjs --surge-rung`
> ALL-GREEN at main, PR #47 `e222680a`; recorded in `WORK-REGISTRY.md`).
> The text below is the historical surge record, preserved as written; the
> active program phase is `PRODUCT-PHASE.md`.

## Purpose

TL2 is currently the unfinished architectural center of Flauz. TL1's substrate/service seam, TL3's browser/environment/resource/continuity layer, and TL4's runtime verification infrastructure are now mature enough to provide targeted assistance without creating a new permanent TL.

## Ownership

**TL2 owns Agent OS.** The borrowed workers are seconded contributors only. They cannot redefine TL1, TL3 or TL4 contracts and they cannot create a competing orchestration architecture.

## Surge graph

```
                         TL2 — Agent OS
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
       TL2-A                 TL2-B                TL2-C
   orchestration          providers           memory/workflows/A2A
          ▲                    ▲                    ▲
          │                    │                    │
       TL2-S1               TL2-S2               TL2-S3
       TL1 helper            TL3 helper           TL4 helper
       service              resource/execution    runtime verification
       integration          integration
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                       durable Agent OS
                               │
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                 ▼
          Browser          Environment        Resources
             └─────────────────┬─────────────────┘
                               ▼
                          Continuity
                               ▼
                       Evidence/Decisions
                               ▼
                         TL4 verdicts
```

## TL2-S1 — TL1 service-integration secondment

**Mission:** make the durable Agent OS consume the completed TL1-003 service seam cleanly.

Work:
- protocol conformance and adapter contracts;
- lifecycle/health/event/auth usage from Agent OS;
- no transport/version duplication;
- additive service-to-orchestrator bridge where needed;
- tests for protocol negotiation, failure, shutdown and event delivery.

Preferred scope: additive files/tests under Flauz service/extension land; avoid broad edits to core protocol files unless compatibility demands them.

Acceptance:
- Agent OS can start/recover through the native Flauz service boundary;
- service errors remain machine-readable and fail-closed;
- protocol conformance stays green;
- no `src/vs` change.

## TL2-S2 — TL3 resource/execution secondment

**Mission:** make the durable Agent OS able to treat browser, environment and logical resources as execution resources.

Work:
- resource acquisition and release contract;
- BrowserSession/EnvironmentExecutor adapters;
- ResourceRef provenance and access-surface hand-off;
- Continuity export/restore integration points;
- failure/timeout/rollback semantics at task level.

Acceptance:
- a durable task can target a browser/environment/resource through existing TL3 contracts;
- trust and policy gates remain authoritative;
- continuity metadata is preserved;
- no TL3 contract is weakened.

## TL2-S3 — TL4 runtime-verification secondment

**Mission:** independently prove Agent OS durability as it is implemented.

Work:
- restart recovery;
- provider failure/retry;
- cancellation propagation;
- approval interruption/takeover;
- lease conflict;
- multi-agent coordination;
- evidence/provenance integrity;
- partial environment/browser failure.

Acceptance:
- deterministic machine-checkable verdicts;
- fixture and runtime modes share one contract;
- failures identify the violated invariant rather than only a symptom;
- no test disables security/policy to obtain a pass.

## Merge and conflict law

1. TL2 decides Agent OS semantic ownership.
2. TL1 decides Code OSS/substrate compatibility conflicts.
3. TL3 decides browser/environment/resource contract conflicts.
4. TL4 owns independent verification verdicts.
5. When shared files collide, extract/adapt rather than broad-refactor.
6. A seconded worker is released when its named surge acceptance is satisfied.

## Completion rule

The surge ends when TL2 can demonstrate a durable execution graph that survives restart, provider failure, environment/resource changes and human intervention while preserving task state, authorization, provenance and evidence.

External agent UI integration remains downstream: no CopilotKit/OpenMuse runtime dependency is introduced by this surge; any AG-UI adapter remains behind the native Flauz service boundary.
