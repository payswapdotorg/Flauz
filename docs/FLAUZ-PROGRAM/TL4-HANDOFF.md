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
