# Flauz Architect Takeover — 2026-09-27

## Verification point

Repository: `payswapdotorg/flauz`
Product branch: `main`
Verified integrated head: `2dd52fc6fe39b3ff8cada7a0e4ead33477e7ff8f`
Open PRs at verification: none

This is the architect-level reconciliation after reviewing the Flauz program control plane, the current `main` history, all four TL handoffs, the current extension architecture, and the current provider/UI seams.

## Non-disruptive takeover rule

No existing TL branch, worker assignment, implementation directory or active work item is changed by this takeover.

The changes in this control-plane update are documentation/architecture only. TL1, TL2, TL3 and TL4 remain independently active.

## Architecture decision: CopilotKit / OpenMuse

Flauz does not need a hard integration with CopilotKit or OpenMuse.

### Flauz remains authoritative

The product architecture remains:

`Code OSS workbench + Flauz extensions + Flauz service/control plane`

The Flauz service owns durable execution, tasks, sessions, approvals, leases, policy, evidence, provider routing and cross-surface state.

### AG-UI is optional interoperability

AG-UI is worth keeping as a future boundary adapter because it can let external agent UIs consume Flauz events and state without changing the Flauz authority model.

That adapter must come after TL1-003 establishes the versioned native service protocol.

CopilotKit may be used as one optional client/UI implementation against that adapter. It must not become a runtime dependency of the core product.

### OpenMuse is a reference target

OpenMuse's continuous-agent, browser/terminal/files interaction model is useful for UX and interoperability experiments, but its server/worker/runtime architecture overlaps with responsibilities Flauz already owns.

Therefore:
- do not embed OpenMuse;
- do not fork its runtime into Flauz;
- do not make Flauz depend on OpenMuse;
- allow future interoperability through the same Flauz service boundary.

## Control-plane hygiene

Older program documents contained stale integrated-head values and future-dated status annotations. Current `main` is the source of truth. The reconciled docs now point at the verified head and explicitly distinguish historical status text from live code evidence.

## Work sequencing implication

No active TL is blocked or reprioritized by the AG-UI/OpenMuse decision.

The next architectural center remains the durable Flauz service/control plane, especially:
- TL1-003 native service protocol;
- TL2 durable orchestration/provider/memory/approval semantics;
- TL3 real provider/continuity promotion;
- TL4 runtime promotion of acceptance/performance/security gates.

Only after those seams are sufficiently stable should external agent-UI interoperability become implementation work.

## Authority

This document is an architect-level decision record. It does not replace the architecture lock, work registry or TL handoffs; it reconciles them with the verified integrated `main` tree on 2026-09-27.
