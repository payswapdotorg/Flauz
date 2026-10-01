# Flauz Agent Instructions

The repository default `main` is the active Flauz product line.

## Mandatory bootstrap

Before doing product work, read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
3. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
4. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
5. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
6. the active TL handoff:
   - TL-A -> `docs/FLAUZ-PROGRAM/TL-A-PRODUCTIZATION-HANDOFF.md`
   - TL-B -> `docs/FLAUZ-PROGRAM/TL-B-ENGINEERING-LAB-HANDOFF.md`

The older Product Acceptance, Discovery and Productization documents are historical evidence, not active routing.

## Active phase routing

Current phase: **Two-TL Product Completion and Engineering Lab**.

- TL-A -> remaining acceptance gaps, product completion, dogfooding, beta, production and post-production reliability
- TL-B -> Engineering Lab, workload learning, task worlds, Agent Bodies, organization search, model occupancy, capability search and closed-loop calibration
- cross-TL work -> stable contract first; do not block either TL on an unfinished implementation

The master roadmap and work registry are authoritative. Do not invent parallel work outside registered items.

## Branch rules

- `main` is the canonical Flauz product line.
- `upstream/main` is the upstream Code OSS reference line.
- Product PRs target `main`.
- Do not create another Code OSS fork.
- A worker branch is not product state until merged to `main`.

## Ownership / non-interference

- TL-A owns product completion and productionization across the existing Flauz product surfaces.
- TL-B owns the Engineering Lab vertical and its contracts, simulation, search, console and calibration.
- Both TLs may inspect the whole repository.
- Neither TL may silently patch the other TL's active implementation.
- Shared contracts are updated before cross-TL integration.
- Do not cherry-pick another TL's worker branch.

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
