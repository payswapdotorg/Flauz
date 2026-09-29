# Flauz — Start Here

This is the Code OSS-based Flauz product line.

## Authoritative branch

Checkout:
`main`

The repository default `main` is the canonical Flauz product line. The preserved upstream Code OSS reference is `upstream/main`.

## Current phase

**Product Acceptance, Discovery and Productization**

Read the phase control document first:
`docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`

## Read before coding

1. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
2. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`
3. `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`
4. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
5. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
6. `docs/FLAUZ-PROGRAM/PARALLEL-EXECUTION.md`
7. the active TL handoff:
   - TL1 -> `docs/FLAUZ-PROGRAM/TL1-PRODUCT-HANDOFF.md`
   - TL2 -> `docs/FLAUZ-PROGRAM/TL2-PRODUCT-HANDOFF.md`
   - TL3 -> `docs/FLAUZ-PROGRAM/TL3-PRODUCT-HANDOFF.md`
   - TL4 -> `docs/FLAUZ-PROGRAM/TL4-PRODUCT-HANDOFF.md`

## Product rule

Flauz is not a replacement for the IDE.

It is Code OSS + Agent OS + Workspace OS, with browser and environment dimensions.

Preserve existing Code OSS capabilities unless a requirement explicitly proves otherwise.

## Operating rule

No chat history is required to decide what to do next.

1. Find your TL handoff.
2. Claim only an unclaimed registry item in your lane.
3. Inspect current `main`.
4. Implement in your ownership boundary.
5. Test at the evidence level required by the work item.
6. Record evidence and remaining risk.
7. Update the registry in the same merge wave.

When you find a problem owned by another TL, create a routed `P2-FIX-###` finding. Do not patch across the ownership boundary.
