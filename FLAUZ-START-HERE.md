# Flauz — Start Here

This is the Code OSS-based Flauz product line.

## Authoritative branch

Checkout:
`main`

The repository default `main` is the canonical Flauz product line. The preserved upstream Code OSS reference is `upstream/main`.

## Current phase

**Two-TL Product Completion, Runtime Activation and Domain-Harness Direction**

Canonical roadmap:
`docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`

## Read before coding

1. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. fresh-chat handoffs:
   - TL-A -> `docs/FLAUZ-PROGRAM/FRESH-CHAT-TL-A-HANDOFF.md`
   - TL-B -> `docs/FLAUZ-PROGRAM/FRESH-CHAT-TL-B-HANDOFF.md`
6. historical/extended TL handoffs:
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
## Current strategic direction — domain harness + free inference

Flauz's next product-level objective is to transform into the domain-specific work harness selected by a user during onboarding. The universal Agent OS and Workspace OS remain underneath; the harness composes domain ontology, roles, workflows, capabilities, policies, evidence, benchmarks and UI projections.

The Free plan should provide **unlimited Flauz usage**, not a promise of literally unlimited third-party model tokens. TL-B owns the inference-fabric implementation; TL-A owns production/security/release validation. Do not expose a shared public gateway that pools other people's third-party free-tier API keys.

For a fresh chat, treat the two fresh-chat handoffs above plus current `main` as the active reconstruction point.
