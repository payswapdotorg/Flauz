# Flauz Program — Source of Truth

Repository: payswapdotorg/Flauz
Product branch: main
Current product head at verification: 2dd52fc6fe39b3ff8cada7a0e4ead33477e7ff8f

This repository and the product branch are sufficient to operate the Flauz engineering program without prior chat history.

## Branch policy

- main is the canonical integrated Flauz product line.
- upstream/main is the upstream Code OSS reference line and must not receive ordinary Flauz feature work.
- Product work starts from main.
- Every product PR targets main.
- Upstream synchronization is owned by TL1 and must be recorded in the work registry.
- Never infer product state from upstream/main.
- Never create another Code OSS fork for Flauz.

## Authority order

When sources disagree, use this order:

1. Integrated code on main.
2. docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md.
3. docs/FLAUZ-PROGRAM/WORK-REGISTRY.md.
4. docs/FLAUZ-PROGRAM/CURRENT-STATE.md.
5. TL handoff documents in this directory.
6. Historical lab artifacts and reports.

The companion payswapdotorg/flauz-code-lab repository is historical research/evidence. It is not required to operate this program.

## Current control-plane reconciliation — 2026-09-27

- Verified integrated product head on `main`: `2dd52fc6fe39b3ff8cada7a0e4ead33477e7ff8f`.
- No open pull requests were present at verification time.
- Recent integrated work includes TL3 browser/security/environment waves plus TL4 security/release, session-battery and hygiene work; the exact current `main` tree is authoritative over stale control-plane annotations.
- This reconciliation is documentation-only and does not change ownership, branch strategy or the active work lanes of TL1, TL2, TL3 or TL4.
- The external-agent interoperability decision is intentionally downstream of TL1-003: no CopilotKit/OpenMuse runtime dependency is introduced.

## Completion law

A work item is complete only when:
- implementation is on main;
- targeted tests pass;
- relevant CI passes;
- the exact commit/PR is recorded;
- the work item is marked DONE in the registry;
- any architecture decision is recorded;
- prototype-only behavior is explicitly distinguished from production behavior.

## No-chat rule

Do not ask the user what to do next merely because the previous chat session ended.

On startup:
1. read this file;
2. read CURRENT-STATE.md;
3. read ARCHITECTURE-LOCK.md;
4. read WORK-REGISTRY.md;
5. read your TL handoff;
6. pick the highest-priority unblocked work item in your lane;
7. execute it;
8. update the registry before handing off.

## Program structure

extensions/flauz-agent — agent bridge and Flauz runtime seam
extensions/flauz-browser — browser policy/security seam
extensions/flauz-environments — environment registry/provider seam
extensions/flauz-models — multi-model provider seam
extensions/flauz-workflow — reusable workflow envelope seam
extensions/flauz-workspace — workspace task/evidence seam
build/flauz — product packaging, canaries, guards and performance tooling
test/fixtures — contract and conformance fixtures
docs/FLAUZ-PROGRAM — authoritative program control plane
