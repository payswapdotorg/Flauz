# Flauz — Start Here

This is the Code OSS-based Flauz product line.

## Authoritative branch

Checkout:
`main`

The repository default `main` is the canonical Flauz product line. The preserved upstream Code OSS reference is `upstream/main`.

## Current phase

**Two-TL Product Completion and Engineering Lab**

Canonical roadmap:
`docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`

## Read before coding

1. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. the active TL handoff:
   - TL-A -> `docs/FLAUZ-PROGRAM/TL-A-PRODUCTIZATION-HANDOFF.md`
   - TL-B -> `docs/FLAUZ-PROGRAM/TL-B-ENGINEERING-LAB-HANDOFF.md`

Historical P2 documents remain useful evidence but do not determine current ownership.

## Product rule

Flauz is not a replacement for the IDE.

It is Code OSS + Agent OS + Workspace OS, with browser and environment dimensions.

Preserve existing Code OSS capabilities unless a requirement explicitly proves otherwise.

## Operating rule

No chat history is required.

1. Find your TL handoff.
2. Claim only an unclaimed item in your lane.
3. Work from current `main`.
4. Use stable contracts, fixtures or mocks for cross-TL dependencies.
5. Test at the evidence level required by the item.
6. Record evidence, exact SHA/PR and remaining risk.
7. Update the registry in the same merge wave.

### Two-TL independence law

TL-A must be able to complete productionization without the Engineering Lab.

TL-B must be able to complete the Lab without waiting for productionization.

The Lab may only cross into real execution through the stable `LabExecutionPort` / AgentTask / Workflow boundary.