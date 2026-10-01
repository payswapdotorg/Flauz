# TL-A Handoff — Product Completion and Productionization

Status: ACTIVE  
Program: Two-TL Product Completion and Engineering Lab

## Mission

Take the current integrated Flauz product from the completed P2 acceptance baseline through all remaining engineering gaps, dogfooding, beta, production and post-production reliability.

TL-A is the production owner.

## Start here

Read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file

Then inspect current `main`. Never trust historical branch state.

## Current inherited gap set

TL-A absorbs the remaining P2-FIX tail:

- 102;
- 106;
- 107;
- 109;
- 110;
- 111;
- 113.

P2-FIX-108 and P2-FIX-112 are already DONE.

The inherited TL3 claims are historical ownership records. Unmerged branches are not product state. TL-A may recreate equivalent work from current `main` under the new registry ownership without importing another TL's branch.

## Work order

### A1 — Close inherited gaps

For each item:

1. reproduce the finding on current `main`;
2. record the current contract;
3. resolve architecture questions first;
4. implement the minimum complete fix;
5. add regression tests;
6. obtain the strongest available evidence;
7. independently verify on clean main-derived state;
8. update the registry.

Known high-value items:

- 102: make dedicated battery TypeScript programs actually compile their subjects and then clear the surfaced instrument drift;
- 106: implement the DL-79 browser-level popup placement + Fetch pre-use observation law;
- 107: implement DL-80 at-record query-value redaction while preserving continuity export redaction;
- 109: decide and implement cancellation-port semantics with partial-effect reconciliation;
- 110: make remotePidAlive uncertainty explicit and fail-closed;
- 111: converge restoration-family vocabulary without inventing a second authority;
- 113: complete the keyed/signed-chain decision or record an explicit bounded deferral.

### A2 — Final verification

Re-run:

- 14-leg acceptance journey;
- live-provider path where provisioned;
- browser real-Chromium scenarios;
- environment real/local-real scenarios;
- resource/continuity recovery;
- compatibility;
- security;
- performance;
- packaging;
- restart/recovery;
- provenance.

The final verdict must distinguish runtime-real from live-provider and production-real evidence.

### A3 — Dogfood

Use Flauz to build and maintain real software.

Capture:

- failed tasks;
- repeated manual interventions;
- confusing UX;
- provider failures;
- browser/environment failures;
- slow paths;
- recovery defects;
- evidence/provenance gaps;
- upgrade/migration defects.

Every defect becomes a registry item before implementation.

### A4 — Beta

Prepare a controlled external release:

- signed artifacts;
- install/update path;
- crash diagnostics;
- backup/restore;
- migration;
- support bundle;
- privacy-controlled telemetry;
- rollback;
- provider/environment outage behavior;
- documented supported platform matrix.

### A5 — Production

Operate the first production release with:

- release checklist;
- observability;
- incident registry;
- rollback path;
- backup verification;
- upgrade verification;
- security monitoring;
- post-release acceptance.

### A6 — Post-production reliability

Every material production issue follows:

incident
→ reproducible finding
→ registry item
→ fix
→ regression
→ release
→ post-release verification.

## Worker boundaries

A1 may touch runtime semantics across existing Flauz extensions.

A2 may touch UI, packaging, deployment and release surfaces.

A3 may touch dogfood harnesses, telemetry, operations, diagnostics and production tooling.

All three may inspect the entire repository.

They must not edit the same file concurrently.

## No dependency on TL-B

TL-A must use a local/mock LabRecommendation contract for production readiness tests.

TL-A must be able to complete production even if the Engineering Lab is completely absent.

