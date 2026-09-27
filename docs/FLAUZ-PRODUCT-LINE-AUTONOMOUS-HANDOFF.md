# Flauz Product-Line Autonomous Handoff

The current program control plane supersedes the earlier one-page handoff.

Read:
- FLAUZ-START-HERE.md
- docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md
- docs/FLAUZ-PROGRAM/CURRENT-STATE.md
- docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md
- docs/FLAUZ-PROGRAM/WORK-REGISTRY.md
- docs/FLAUZ-PROGRAM/PARALLEL-EXECUTION.md
- docs/FLAUZ-PROGRAM/TL1-HANDOFF.md
- docs/FLAUZ-PROGRAM/TL2-HANDOFF.md
- docs/FLAUZ-PROGRAM/TL3-HANDOFF.md
- docs/FLAUZ-PROGRAM/TL4-HANDOFF.md

Active implementation branch: flauz/main
Repository: payswapdotorg/Flauz

The product branch contains the integrated Flauz extension line. The upstream main branch is reference-only.

The four TL lanes are intentionally parallel:
- TL1: Code OSS substrate, upstream sync, product build and client/service integration.
- TL2: Agent OS.
- TL3: Browser and Environment OS.
- TL4: UX, compatibility, performance, security and release quality.

Every TL can begin immediately from the repository using contracts and fixtures. No TL should wait to start useful work.
