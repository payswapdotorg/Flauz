# Flauz Program — Source of Truth

Repository: payswapdotorg/Flauz
Product branch: main
Verified integrated head: 6fcf329afc5ee1d6cbc10150a66e31363cd098f8
Verification date: 2026-09-28

This repository is the sole operational source of truth for the Flauz engineering program. Chat history, prior model outputs, external lab notes, and stale status snapshots are not authoritative.

## Canonical authority

When sources disagree, use this order:

1. The actual integrated code and configuration on `main`.
2. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`.
3. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`.
4. `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`.
5. `docs/FLAUZ-PROGRAM/TL1-HANDOFF.md` through `TL4-HANDOFF.md`.
6. Historical lab artifacts and reports.

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
- the owning TL handoff records what is complete, what remains, and the exact verification evidence;
- no document may claim a newer state than the integrated `main` tree.

The control plane is updated in the same merge wave as the work it describes.

## Current reconciliation — 2026-09-28

- Verified latest integrated `main` head: `6fcf329afc5ee1d6cbc10150a66e31363cd098f8`.
- The latest head is the final control-plane reconciliation merge.
- The TL2 Agent OS surge is closed and all three seconded workers are released to their home TLs.
- All registered TL1/TL2/TL3/TL4 work items are marked DONE at their recorded rungs.
- Completion of a work item does not mean every runtime hardening opportunity is closed. Concrete remaining findings are registered below in `WORK-REGISTRY.md` and summarized in `CURRENT-STATE.md`.
- There is no CopilotKit or OpenMuse runtime dependency. Any future AG-UI integration remains an additive client/projection behind the native Flauz service boundary.

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
3. Read `WORK-REGISTRY.md`.
4. Read `CURRENT-STATE.md`.
5. Read the assigned TL handoff.
6. Inspect the actual `main` tree and current CI evidence before making claims.
7. Take only the next unblocked registry item or explicitly authorized hardening item.

## Final handoff map

- TL1: `TL1-HANDOFF.md` — Code OSS substrate, upstream compatibility, build and service seam.
- TL2: `TL2-HANDOFF.md` — Agent OS, orchestration, providers, memory, approvals, workflows and A2A.
- TL3: `TL3-HANDOFF.md` — Browser, environment, resource graph and continuity.
- TL4: `TL4-HANDOFF.md` — Product UX, compatibility, runtime verification, performance and release quality.

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
