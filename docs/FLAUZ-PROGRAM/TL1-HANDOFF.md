# TL1 Handoff — Code OSS Substrate, Upstream Compatibility and Product Integration

## Mission

Own the Code OSS substrate as the stable foundation of Flauz.

Your output is not another competing Flauz architecture. Make the existing architecture shippable on top of Code OSS while preserving upstream capability and minimizing permanent fork cost.

## First reads

- SOURCE-OF-TRUTH.md
- ARCHITECTURE-LOCK.md
- CURRENT-STATE.md
- WORK-REGISTRY.md
- PARALLEL-EXECUTION.md
- .github/copilot-instructions.md

## Three workers

### Worker A — Upstream/branch engineering
- upstream sync strategy;
- compare main versus upstream/main;
- rebase and merge mechanics;
- fork-critical audit;
- upstream regression detection.

### Worker B — Product shell/build
- product.flauz.json;
- product branding/default profile;
- bundled extension inclusion;
- packaging;
- desktop/web product targets;
- release metadata.

### Worker C — Platform/service integration
- define the versioned client-to-Flauz-service protocol;
- health/lifecycle/auth seams;
- IPC/event transport;
- minimize direct dependencies from feature extensions into Code OSS internals.

## First sprint

Work on TL1-001, TL1-002, TL1-003 and TL1-004 concurrently.

Do not wait for TL2/TL3/TL4.

## Hard rules

- upstream/main is not the product branch.
- No large refactor of Code OSS solely for aesthetics.
- Any core patch requires a recorded rationale.
- Keep the fork-critical guard meaningful.
- Maintain all native Code OSS capabilities.

## Handoff format

Every completed item must include:
- files changed;
- exact PR/commit;
- targeted tests;
- compatibility impact;
- upstream delta;
- remaining risk.

## Done means

A fresh engineer can clone this repo, checkout main, read the program docs, build the product, and understand exactly how Flauz relates to upstream Code OSS.
