# Flauz Work Registry

Statuses: TODO | ACTIVE | BLOCKED | VERIFY | DONE | PARKED

## TL1 — Substrate, upstream compatibility and product integration

### TL1-001 — Upstream synchronization lane
Status: ACTIVE
Maintain a deterministic upstream-sync process from the Code OSS reference line into the product line. Preserve Flauz additions and record merge conflicts/decisions.

Acceptance: repeatable sync procedure, current diff report, no accidental upstream-only regressions.

### TL1-002 — Product build/release shell
Status: TODO
Own product.flauz.json, packaging identity, default profile, extension inclusion and release artifacts.

Acceptance: clean Flauz build output with all six bundled Flauz extensions and no accidental Microsoft product branding.

### TL1-003 — Core integration seam
Status: TODO
Establish the smallest stable client-to-Flauz-service IPC/API seam for commands, events, health, auth and lifecycle.

Acceptance: versioned protocol usable by every feature TL without direct implementation coupling.

### TL1-004 — Core-change budget
Status: TODO
Audit all Flauz core patches, retire unnecessary ones, and keep the fork-critical guard at zero unless explicitly approved.

### TL1-005 — Web/desktop packaging parity
Status: TODO
Ensure a clear desktop shell and web-compatible shell story without weakening capability boundaries.

## TL2 — Agent OS

### TL2-001 — Durable orchestration
Status: ACTIVE
Turn the current agent/workspace slice into durable task/agent execution with recovery, retry, cancellation and multi-agent routing.

### TL2-002 — Real model/provider adapters
Status: TODO
Implement real adapters and routing for external and local models while preserving Code OSS language-model/tool APIs.

### TL2-003 — Context and memory
Status: TODO
Implement tiered memory/context compilation, retrieval, provenance and model-aware budgets as Flauz service capabilities.

### TL2-004 — Approval/takeover/lease semantics
Status: TODO
Integrate human approval, takeover, cancellation propagation and resource leases into the execution graph.

### TL2-005 — Reusable workflows
Status: TODO
Promote workflow envelopes into executable reusable workflows with validation, versioning and recovery.

### TL2-006 — Agent-to-agent collaboration
Status: TODO
Extend the current A2A seam into actual multi-agent coordination with private context and shared task state.

## TL3 — Browser and Environment OS

### TL3-001 — Real browser runtime
Status: ACTIVE
Build the Flauz-controlled Chromium/CDP browser runtime and integrate it into the workbench as a first-class user/agent surface.

### TL3-002 — Browser session security
Status: TODO
Integrate policy, partitions, credential isolation, prompt-injection defenses, screenshot/evidence capture and recovery.

### TL3-003 — Environment lifecycle
Status: TODO
Turn environment descriptors into create/start/stop/snapshot/attach/detach/destroy operations behind provider adapters.

### TL3-004 — Provider matrix
Status: TODO
Implement provider adapters for local, SSH, containers, cloud sandboxes and E2B-style environments behind one contract.

### TL3-005 — Resource graph
Status: TODO
Unify files/tasks/browser/environments/artifacts/model/provider resources behind ResourceRef without flattening divergent access surfaces.

### TL3-006 — Continuity
Status: TODO
Persist and restore logical session/task/context state across environment changes.

## TL4 — Product UX, Verification and Release Quality

### TL4-001 — Product information architecture
Status: ACTIVE
Design and begin implementing the coherent shell across editor, agent, browser, task, environment and evidence surfaces.

### TL4-002 — Premium UX
Status: TODO
Implement and verify typography, density, hierarchy, states, focus, keyboard behavior, empty/loading/error/recovery states and polished transitions.

### TL4-003 — Code OSS compatibility battery
Status: ACTIVE
Build a regression suite for core Code OSS functionality so Flauz additions cannot silently damage editor, terminal, git, debug, tasks, extensions or accessibility.

Progress (2026-09-27, Worker B, branch `tl4/b-compat-battery`):
- Battery implemented (layers 1+2, zero-dep): `build/flauz/scripts/compat-battery.mjs` — L1 invokes the fork-critical guard; L2 diffs stock contribution surfaces (commands/keybindings/menus/views/viewsContainers/configuration/submenus), product.json identity (set extracted from product.flauz.json), root package.json scripts/deps names, plus a Flauz positive control.
- 14 fixture trees under `test/fixtures/compat-battery/` wired into `verify-fixtures.sh` (every rule has a case that makes it fail; allowlist suppression proven both ways).
- Baseline on current main: 1887 rows — 1887 PASS / 0 FAIL / 0 SKIP, exit 0 with `--require` (recorded in `build/flauz/compat-baseline.md`).
- CI gate `.github/workflows/flauz-compat.yml` (battery `--require` vs origin/upstream/main + fixture matrix; L3 runtime smoke present as a PENDING wiring skeleton).
- Spec + coverage matrix: `docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md`. Deferred families (languages/grammars/themes/taskDefinitions/debuggers/notebookRenderer/chat families etc.) documented there with rationale; L3 runtime promotion is the main follow-up.

Acceptance remains open until merged to main and the L3 ladder rung is promoted.

Merge record (2026-09-27, TL4 lead): PR #4 squash-merged to main at
`2ed7dc3c337` (branch `tl4/b-compat-battery`, 213 files). Station-verified
independently post-merge at `0d663e600c3`: compat-battery `--require`
1887/1887 PASS; verify-fixtures ALL 64 CASES (0 deviations, both waves'
fixtures coexist); activation-lint GREEN; secret sweep of the diff 0.
Status stays ACTIVE until CI (flauz-compat.yml) reports green on main;
then DONE for the L1+L2 rung (L3 runtime promotion remains follow-up).

### TL4-004 — Whole-session acceptance battery
Status: TODO
Run real user-session simulations spanning task creation, agent execution, browser, environment, verification, artifact and recovery.

### TL4-005 — Performance and resource budget
Status: ACTIVE
Measure startup, activation, memory, CPU, browser launch, model switching and multi-agent workloads.

Progress note (2026-09-27, Worker C, branch `tl4/c-perf-budgets`):
budget doctrine landed (docs/FLAUZ-PROGRAM/TL4-PERF-BUDGETS.md — metric catalogue,
promotion ladder, enforcement policy); machine-checkable registry
build/flauz/budgets/flauz-budgets.json (45 rows: 30 enforced-ci / 3
enforced-in-repo / 3 fixture / 9 pending-runtime) + JSON schema; unified zero-dep
gate build/flauz/scripts/budget-gate.mjs (skip-vs-fail policy, --require scopes,
consumes measurement records + the perf-log-parse emit shapes); fixture matrix
test/fixtures/budget-gate/ wired into verify-fixtures.sh (44 cases, 0 deviations);
CI job .github/workflows/flauz-budgets.yml (registry self-check, mapped real
perf-fixture plumbing with --require enforced-ci, violations probe, fixture
matrix). Honest baseline: build/flauz/budgets/BASELINE.md — fixture-backed today,
real measured numbers are CI's job once flauz-perf artifacts feed the gate;
browser-launch/model-switch/multi-agent rows are defined, not measured (runtime
pending TL3/TL2). Merge is the TL4 lead's job.

Merge record (2026-09-27, TL4 lead): PR #5 squash-merged to main at
`0d663e600c3` (branch `tl4/c-perf-budgets`, 19 files). Station-verified
independently post-merge: budget-gate fixtures green (pass/over/skip/--require
behaviors all proven); verify-fixtures ALL 64 CASES (0 deviations);
activation-lint GREEN; secret sweep 0. Status stays ACTIVE until CI
(flauz-budgets.yml) reports green on main; then DONE for the fixture rung
(runtime promotion for the 9 pending-runtime rows remains follow-up).

### TL4-006 — Security and release gates
Status: TODO
Create integrated gates for secrets, permissions, browser safety, supply chain, packaging, signing and reproducible release artifacts.

## Cross-TL rule

No TL may wait for another TL to begin useful work.

When an interface is not implemented:
- define the contract;
- create a local fixture/mock;
- continue independently;
- integrate when the real implementation becomes available.

A TL may depend on another TL for final integration, but never for starting work.

## Current program start

All four TLs are ACTIVE from this registry reset.

The first objective for every TL is contract-first progress, not planning-only output.
