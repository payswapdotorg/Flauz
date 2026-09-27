# Flauz Agent Instructions

The repository default main is the active Flauz product line.

Before doing product work, read:
1. FLAUZ-START-HERE.md
2. docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md
3. docs/FLAUZ-PROGRAM/CURRENT-STATE.md
4. docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md
5. docs/FLAUZ-PROGRAM/WORK-REGISTRY.md
6. docs/FLAUZ-PROGRAM/PARALLEL-EXECUTION.md
7. your TL handoff in docs/FLAUZ-PROGRAM/

Branch rules:
- main is the canonical Flauz product line.
- upstream/main is the upstream Code OSS reference line.
- Product PRs target main.
- Do not create another Code OSS fork.

Autonomous operation:
- Do not depend on chat history.
- Select the highest-priority unblocked work item in your assigned TL lane.
- Use fixtures/contracts when another TL's implementation is not yet available.
- Record implementation, tests, exact SHA/PR and remaining risk.
- Update WORK-REGISTRY.md when a work item changes status.

Architecture:
- Preserve all mature Code OSS capabilities.
- Prefer stable APIs and built-in extensions before core patches.
- Stateful cross-surface orchestration belongs in the Flauz service.
- Browser policy is security infrastructure; it is not the browser product.
- Do not turn mocks or prototypes into production claims.
- Core/fork-critical changes require explicit rationale and architecture approval.

Quality:
- Targeted tests first; broad builds only when required.
- Never hide missing functionality behind optimistic UI.
- Never leak provider credentials or workspace secrets.
- Keep human approval and provenance boundaries intact.

For general Code OSS coding/style/testing rules, also follow .github/copilot-instructions.md.
