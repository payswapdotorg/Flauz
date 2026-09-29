# Flauz Active Product Phase — Acceptance, Discovery and Productization

## Phase status

**ACTIVE — 2026-09-29**

The original four-TL foundation and all registered post-completion hardening are complete on `main`.

This phase is the first coordinated product phase after platform construction. Its purpose is to prove that the existing Flauz architecture emerges as one coherent product for a human user, identify gaps without weakening TL boundaries, and route each gap to its owning TL.

## Canonical baseline

- Product branch: `main`
- Current head: resolve live; never copy a historical SHA
- Open pull requests: 0 at phase creation
- Original TL1/TL2/TL3/TL4 portfolios: DONE
- AO-H1..AO-H4: DONE
- TL3-H1/TL3-H2: DONE
- TL4-H1/TL4-H2: DONE
- PLATFORM-H1/PLATFORM-H2: DONE
- TL2-H1 live-provider verification: DONE

The code on `main`, `SOURCE-OF-TRUTH.md`, `ARCHITECTURE-LOCK.md` and `WORK-REGISTRY.md` remain the authority.

## Active work items

| ID | Owner | Status | Purpose |
|---|---|---|---|
| P2-001 | TL1 | ACTIVE | Reconcile the control plane and make the repository self-describing for this phase |
| P2-002 | TL4 | ACTIVE | Execute full product acceptance across the real Flauz user journey |
| P2-003 | TL4 | ACTIVE | Audit discoverability, navigation, recovery UX and user comprehension |
| P2-FIX-* | Derived owner | READY-TO-CLAIM | Implement concrete acceptance/discovery findings without changing ownership boundaries |

P2-002 and P2-003 may run in parallel with P2-001. Acceptance does not wait for documentation cleanup; it starts from the current integrated `main`.

## Handoff map

- TL1 active handoff: `docs/FLAUZ-PROGRAM/TL1-PRODUCT-HANDOFF.md`
- TL2 active handoff: `docs/FLAUZ-PROGRAM/TL2-PRODUCT-HANDOFF.md`
- TL3 active handoff: `docs/FLAUZ-PROGRAM/TL3-PRODUCT-HANDOFF.md`
- TL4 active handoff: `docs/FLAUZ-PROGRAM/TL4-PRODUCT-HANDOFF.md`

These phase handoffs supersede the older completion handoffs for deciding what to do next. The older files remain historical completion records.

## Ownership law

| Domain | Primary owner | Work that must stay out of this TL |
|---|---|---|
| Code OSS substrate, upstream sync, product build, service seam, fork-critical guard, control plane | TL1 | Agent semantics, browser internals, final UX judgement |
| Agent runtime, orchestration, models/providers, memory, approvals, workflows, A2A, execution semantics | TL2 | Browser engine, environment provider internals, visual/product UX judgement |
| Browser runtime/security, environments/providers, resources, continuity | TL3 | Agent planner semantics, upstream merge policy, product visual system |
| Product IA/UX, accessibility, E2E acceptance, compatibility, performance, release quality | TL4 | Agent semantics and provider implementation |

A TL may inspect another TL's area. A TL must not silently patch another TL's owned implementation area.

## Finding routing

Every acceptance or discovery problem becomes a finding before cross-TL implementation.

Finding format:

`P2-FIX-###`

Each finding must state:

- observable user/system behavior;
- evidence and runtime level;
- owning domain;
- proposed contract change, if any;
- exact owning TL;
- acceptance test;
- whether architecture change is required.

Routing:

- Agent/orchestration/model/memory/workflow/A2A/execution finding -> TL2
- Browser/environment/resource/continuity finding -> TL3
- UX/IA/accessibility/performance/compatibility/release finding -> TL4
- Code OSS/upstream/packaging/service/core-placement/control-plane finding -> TL1
- Cross-domain architecture change -> decision record first; implementation owner is assigned after the decision

TL4 owns the acceptance verdict. It does not own semantic fixes in TL2/TL3 domains.

## Claim protocol

1. Only one TL claims a finding.
2. Claim is recorded in `WORK-REGISTRY.md` before implementation.
3. The implementing TL creates a dedicated branch/PR named with the finding ID.
4. The branch must remain testable without another unfinished TL branch.
5. Cross-TL dependencies use stable contracts, mocks or fixtures while the real implementation is in flight.
6. Do not cherry-pick another TL's worker branch into product state.
7. Rebase/update from current `main` before final integration.
8. A finding is DONE only after implementation, targeted tests, required runtime evidence and registry update land together.

## Shared-file law

The following control-plane files are owned by TL1 during this phase:

- `AGENTS.md`
- `FLAUZ-START-HERE.md`
- `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
- `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`
- `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
- `docs/FLAUZ-PROGRAM/PARALLEL-EXECUTION.md`
- phase coordination documents under `docs/FLAUZ-PROGRAM/`

Other TLs supply proposed text/evidence but do not concurrently edit these files.

Each implementation TL owns its product/code paths and its active handoff. TL4 owns acceptance findings and user-journey evidence. Do not place implementation logic inside the acceptance documents.

## Acceptance journey

P2-002 must exercise the product as one system:

`create workspace -> mission/task -> agent session -> live provider -> files/resources -> browser -> environment -> A2A -> human approval/takeover -> artifact/evidence -> failure -> retry/cancel -> restart -> recovery -> continuity -> inspect provenance`

P2-003 must check the same product from the user's perspective:

- first-run discoverability;
- navigation between Home, Tasks, Agent Sessions, Environments, Browser and Models;
- capability discoverability;
- error/recovery affordances;
- approval/takeover comprehension;
- provenance/evidence comprehension;
- no dead-end or orphan states;
- sensible next-step affordances.

## Evidence law

Every claim must identify its evidence level:

`fixture | simulated | local-real | runtime-real | live-provider`

Never convert SKIP into PASS or fixture/simulated evidence into production claims.

## Phase completion

This phase is complete when:

1. P2-001 is DONE and all active control-plane documents describe the current phase.
2. P2-002 has an end-to-end acceptance verdict with all journeys PASS or with explicit P2-FIX findings.
3. P2-003 has a discoverability verdict with all findings routed.
4. All P2-FIX findings are DONE or explicitly deferred with owner/reason.
5. TL4 independently re-verifies the integrated fixes.
6. `CURRENT-STATE.md` and `WORK-REGISTRY.md` are updated in the same final merge wave.
