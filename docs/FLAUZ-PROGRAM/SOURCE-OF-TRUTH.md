# Flauz Program — Source of Truth

Repository: payswapdotorg/Flauz
Product branch: main
Integrated head: `main` (resolve the live SHA with `git rev-parse main`)
Verification date: 2026-09-29

This repository is the sole operational source of truth for the Flauz engineering program. Chat history, prior model outputs, external lab notes, and stale status snapshots are not authoritative.

## Canonical authority

When sources disagree, use this order:

1. The actual integrated code and configuration on `main`.
2. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`.
3. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`.
4. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md` for active execution rules.
5. `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`.
6. The active TL handoff for the assigned lane.
7. Historical completion handoffs, lab artifacts and reports.

A document is subordinate to the integrated tree. It must never override code, tests, CI evidence, or a newer registry entry.

## Branch policy

- `main` is the canonical integrated Flauz product line.
- `upstream/main` is the preserved Code OSS reference line and must not receive ordinary Flauz feature work.
- Every Flauz product PR targets `main`.
- Product state is never inferred from `upstream/main`.
- Never create a second Code OSS fork for Flauz.
- Any temporary TL worker branch must either merge to `main`, be explicitly superseded, or be deleted; an unmerged branch is not product state.

## Control-plane invariants

Every material change to Flauz must leave the repository internally self-describing:

- the implementation is on `main`;
- the responsible TL and work-item status are recorded in `WORK-REGISTRY.md`;
- architecture changes are recorded in `ARCHITECTURE-LOCK.md` or an explicitly linked decision record;
- current integrated state is reflected in `CURRENT-STATE.md`;
- the active TL handoff records what remains and the exact verification evidence;
- no document may claim a newer state than the integrated `main` tree.

The control plane is updated in the same merge wave as the work it describes.

## Current reconciliation — 2026-09-29

- `main` is the canonical product head; resolve its live SHA rather than copying a historical SHA.
- All registered TL1/TL2/TL3/TL4 foundation items are DONE.
- AO-H1..AO-H4, TL3-H1/TL3-H2, TL4-H1/TL4-H2, PLATFORM-H1/PLATFORM-H2 and TL2-H1 are DONE.
- The Agent OS runtime census is 8 PASS / 0 FAIL / 0 SKIP.
- There are no open pull requests at phase creation.
- The active program is now the Product Acceptance, Discovery and Productization phase defined by `PRODUCT-PHASE.md`.
- There is no CopilotKit or OpenMuse runtime dependency. Any future AG-UI integration remains an additive projection behind the native Flauz service boundary.

## Completion law

A work item is DONE only when:

- implementation is integrated on `main`;
- targeted tests and required CI evidence are present;
- the exact PR/commit is recorded;
- the work item is marked DONE in `WORK-REGISTRY.md`;
- architecture decisions are recorded where applicable;
- prototype, fixture, simulated, and runtime evidence are explicitly distinguished.

A documented FAIL, SKIP, or runtime residual is not silently promoted to PASS.

## No-chat bootstrap

A new TL, worker, or architect must be able to recover the program without prior conversation:

1. Read this file.
2. Read `ARCHITECTURE-LOCK.md`.
3. Read `PRODUCT-PHASE.md`.
4. Read `WORK-REGISTRY.md`.
5. Read the active TL handoff.
6. Inspect the actual `main` tree and current CI evidence before making claims.
7. Take only the next unblocked registry item assigned to that lane.

## Active handoff map

- TL1 -> `TL1-PRODUCT-HANDOFF.md` — control-plane reconciliation and substrate support.
- TL2 -> `TL2-PRODUCT-HANDOFF.md` — Agent OS finding/fix lane.
- TL3 -> `TL3-PRODUCT-HANDOFF.md` — Browser/Environment finding/fix lane.
- TL4 -> `TL4-PRODUCT-HANDOFF.md` — product acceptance and discovery.

The older `TL1-HANDOFF.md` through `TL4-HANDOFF.md` files are historical completion records.

## Program structure

- `extensions/flauz-agent` — agent bridge and Flauz runtime seam
- `extensions/flauz-browser` — browser policy/security/runtime seam
- `extensions/flauz-environments` — environment lifecycle/provider seam
- `extensions/flauz-models` — multi-model provider seam
- `extensions/flauz-workflow` — reusable workflow envelope seam
- `extensions/flauz-workspace` — workspace/task/evidence seam
- `extensions/flauz-resources` — logical resource graph and continuity bridge
- `extensions/flauz-execution` — Agent OS execution-resource integration
- `build/flauz` — packaging, canaries, guards and performance/release tooling
- `test/fixtures` — contract and conformance fixtures
- `docs/FLAUZ-PROGRAM` — authoritative engineering control plane

The companion `payswapdotorg/flauz-code-lab` repository is historical research/evidence only. It is not required to reconstruct, operate, or hand off the Flauz program.
