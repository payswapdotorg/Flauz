# Flauz Parallel Execution Plan

## Current mode — Product Acceptance, Discovery and Productization

The original four-TL build and post-completion hardening are complete. The current program is a coordinated acceptance phase.

### Active lanes

| Work | Owner | Can run now? | Primary artifact |
|---|---|---|---|
| P2-001 Control-plane reconciliation | TL1 | DONE (closed in its merge wave — see `WORK-REGISTRY.md`) | control-plane docs + registry evidence |
| P2-002 Full product acceptance | TL4 | YES | acceptance journey evidence |
| P2-003 User discovery audit | TL4 | YES | discovery findings/evidence |
| P2-FIX-* Routed findings | TL1/TL2/TL3/TL4 by domain | As claimed | implementation PR + re-test evidence |

P2-001, P2-002 and P2-003 do not require one another to start.

## Stable TL boundaries

| TL | Owns | Must not own |
|---|---|---|
| TL1 | Code OSS substrate, upstream sync, product build, native service seam, control plane | Agent semantics, browser internals, final UX judgement |
| TL2 | Agent OS, models, orchestration, memory, approvals, workflows, A2A, execution semantics | Browser implementation, environment provider implementation, visual/product UX |
| TL3 | Browser runtime/security, environment lifecycle/providers, resource continuity | Agent planner semantics, upstream merge policy, product visual system |
| TL4 | UX, E2E verification, compatibility, performance, accessibility, release quality | Core orchestration semantics, provider implementation |

## Worker partition

Each TL has three non-overlapping worker lanes in the active handoff.

- TL1: CURRENT-STATE / program-index / bootstrap-discoverability.
- TL2: agent-runtime / model-fabric / collaboration-state, READY-TO-CLAIM.
- TL3: browser / environments / resources-continuity, READY-TO-CLAIM.
- TL4: journey-runtime / discovery-UX / independent-verification.

Workers must not edit the same file concurrently.

## Finding routing

A cross-TL issue is a finding before it is an implementation task.

Format: `P2-FIX-###`

Required fields:

- observed behavior;
- evidence level;
- owning domain/TL;
- exact reproduction;
- acceptance test;
- architecture impact.

Routing:

- Agent/orchestration/model/memory/workflow/A2A/execution -> TL2
- Browser/environment/resource/continuity -> TL3
- UX/IA/accessibility/performance/compatibility/release -> TL4
- Code OSS/upstream/packaging/service/core placement/control plane -> TL1
- Cross-domain architecture change -> decision record before implementation

## Non-interference rules

1. One owner per registry item.
2. One implementation PR per item.
3. A worker may inspect any TL but may modify only its owned implementation surface.
4. TL4 may report another TL's defect but patches it only when the defect is in TL4-owned UX/release code.
5. TL1 alone edits canonical control-plane files during this phase.
6. Other TLs submit registry/status text as part of their PR; TL1 integrates the canonical control-plane update.
7. Do not cherry-pick another TL worker branch into your branch.
8. Update/rebase against current `main` before final integration.
9. Stable contracts, fixtures and mocks are preferred over waiting on another TL.
10. No core/fork-critical change without an architecture decision.

## Evidence / completion law

Every claim names its evidence level:

`fixture | simulated | local-real | runtime-real | live-provider`

Never convert SKIP into PASS or fixture/simulated evidence into runtime claims.

A P2-FIX item becomes DONE only when:

- implementation is on `main`;
- targeted tests are green;
- required runtime evidence exists;
- security/provenance/ownership laws remain intact;
- TL4 re-runs the affected acceptance scenario;
- TL1 records the final registry/control-plane state in the same merge wave.

## External interoperability

Native Flauz service protocol remains the authoritative boundary.

- CopilotKit is optional client technology, not a runtime dependency.
- OpenMuse is a reference/interoperability target, not a Flauz runtime.
- Future AG-UI support is an additive projection at the native service boundary.
