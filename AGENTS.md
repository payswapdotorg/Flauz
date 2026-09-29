# Flauz Agent Instructions

The repository default `main` is the active Flauz product line.

## Mandatory bootstrap

Before doing product work, read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
3. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`
4. `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`
5. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
6. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
7. your active TL handoff:
   - TL1 -> `docs/FLAUZ-PROGRAM/TL1-PRODUCT-HANDOFF.md`
   - TL2 -> `docs/FLAUZ-PROGRAM/TL2-PRODUCT-HANDOFF.md`
   - TL3 -> `docs/FLAUZ-PROGRAM/TL3-PRODUCT-HANDOFF.md`
   - TL4 -> `docs/FLAUZ-PROGRAM/TL4-PRODUCT-HANDOFF.md`

The older `TL1-HANDOFF.md` through `TL4-HANDOFF.md` files are historical completion records for this phase.

## Active phase routing

Current phase: **Product Acceptance, Discovery and Productization**.

- P2-001 -> TL1: control-plane reconciliation
- P2-002 -> TL4: full-product acceptance
- P2-003 -> TL4: user discovery audit
- P2-FIX-* -> route by domain; the finding names its single owning TL

Do not invent parallel work outside these registry items.

## Branch rules

- `main` is the canonical Flauz product line.
- `upstream/main` is the upstream Code OSS reference line.
- Product PRs target `main`.
- Do not create another Code OSS fork.
- A worker branch is not product state until merged to `main`.

## Ownership / non-interference

- TL1 owns Code OSS substrate, upstream sync, product build/release, service seam, fork-critical controls and control-plane documents.
- TL2 owns Agent OS, models/providers, orchestration, memory, approvals, workflows, A2A and execution semantics.
- TL3 owns browser, environments, providers, resources and continuity.
- TL4 owns product IA/UX, accessibility, E2E acceptance, compatibility, performance and release quality.

Inspect other TL domains freely. Do not modify another TL's owned implementation or acceptance artifacts. Create and route a `P2-FIX-###` finding instead.

## Autonomous operation

- Do not depend on chat history.
- Claim only an unclaimed work item in your TL lane.
- Work from the latest `main`.
- Use stable contracts, fixtures or mocks when another TL's implementation is not yet available.
- Record implementation, tests, exact SHA/PR and remaining risk.
- Keep registry/status changes in the same merge wave as the implementation they describe.

## Architecture

- Preserve mature Code OSS capabilities.
- Prefer stable APIs and built-in extensions before core patches.
- Stateful cross-surface orchestration belongs in the Flauz service.
- Browser policy is security infrastructure; it is not the browser product.
- Do not turn mocks or prototypes into production claims.
- Core/fork-critical changes require explicit rationale and architecture approval.

## Quality

- Targeted tests first; broad builds only when required.
- Never hide missing functionality behind optimistic UI.
- Never leak provider credentials or workspace secrets.
- Keep human approval and provenance boundaries intact.
- Label evidence honestly: fixture, simulated, local-real, runtime-real, or live-provider.

For general Code OSS coding/style/testing rules, also follow `.github/copilot-instructions.md`.
