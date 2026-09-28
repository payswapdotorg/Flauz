# TL4 Handoff — Product UX, Verification and Release Quality

## Mission

Make Flauz feel like one coherent premium product while proving continuously that additions preserve the existing Code OSS experience.

TL4 is the independent quality arm. It is not a final-stage cleanup team.

## First reads

- SOURCE-OF-TRUTH.md
- ARCHITECTURE-LOCK.md
- CURRENT-STATE.md
- WORK-REGISTRY.md
- PARALLEL-EXECUTION.md
- .github/copilot-instructions.md

## Three workers

### Worker A — Product UX
Own:
- information architecture;
- navigation;
- task/agent/browser/environment surfaces;
- empty/loading/error/recovery states;
- keyboard/focus/accessibility;
- visual hierarchy and premium polish.

### Worker B — Compatibility and end-to-end verification
Own:
- Code OSS regression battery;
- full Flauz user journeys;
- fixture-backed contract tests;
- current-main verification;
- Linux/Windows/web/desktop coverage where applicable.

### Worker C — Performance/security/release quality
Own:
- startup/activation budgets;
- memory/CPU budgets;
- extension activation discipline;
- security regression tests;
- secret scanning;
- packaging/release gates;
- reproducibility.

## First sprint

Start TL4-001 through TL4-006 immediately.

Do not wait for the full runtime to exist. Build the harness with fixtures and promote fixtures to real integration coverage as implementations land.

## Hard rules

- A green unit-test suite is not a green product.
- Do not hide missing functionality behind optimistic UI.
- Do not let the command palette be the sole discovery path.
- Preserve mature Code OSS UX where it is already strong.
- Treat premium as measured interaction, visual and recovery quality.

## Done means

A fresh user can discover, use, recover from and continue using Flauz major capabilities without losing the mature editor, terminal, SCM and debugging experience.

## Temporary TL2 secondment — Worker B

TL4 remains the independent quality arm and owner of product verification. Until the Agent OS surge exits, one TL4 worker is temporarily seconded to TL2 as **TL2-S3 — Agent OS Runtime Verification**.

Scope:
- build an independent Agent OS runtime acceptance battery;
- exercise restart, provider failure, cancellation, approval interruption, lease conflict, multi-agent coordination and evidence/provenance recovery;
- promote fixture contracts to runtime CI as TL2 capabilities land;
- keep verdicts machine-checkable and separate implementation claims from observed behavior.

Boundaries:
- no ownership of orchestration semantics;
- no weakening of fail-closed behavior to make a test pass;
- tests must consume public/stable Flauz contracts;
- runtime verification may block a TL2 completion claim but may not silently redefine its architecture.

Acceptance:
- fault/recovery journeys have deterministic expected outcomes;
- restart and provider failure preserve logical task state/provenance;
- approval and lease boundaries are verified independently;
- the battery can be promoted from fixture mode to real runtime mode without rewriting the contract.

When TL2-S3 completes its bounded work-order, Worker B returns to TL4 product-wide verification/quality maintenance.
