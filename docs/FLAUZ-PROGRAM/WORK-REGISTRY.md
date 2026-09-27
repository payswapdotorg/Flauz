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
Status: DONE (PR #7, squash ed460d92, 2026-09-27)
Build the Flauz-controlled Chromium/CDP browser runtime and integrate it into the workbench as a first-class user/agent surface.
Delivered: CDP transport + FakeCdpTransport, BrowserSessionDescriptor/Manager (human/agent separation, flauz:browser:<hex> logical ids), policy-gated navigation (deny => zero CDP commands, pinned by tests; posture P0), console/network/screenshot capture -> evidence rows, recovery (drop/wedge/reconcile + current-policy recheck), host adapters (CdpEndpointHost + WorkbenchBrowserHost via vendored vscode.proposed.browser.d.ts), product grant flauz.flauz-browser:["browser"], B-POLICY A4-A10 reclassified, CI driver drill. Verified: station trio + all flauz canaries green; integrated with TL4-001 IA shell (union merge, 161/161 tests).

### TL3-002 — Browser session security
Status: TODO
Integrate policy, partitions, credential isolation, prompt-injection defenses, screenshot/evidence capture and recovery.

### TL3-003 — Environment lifecycle
Status: ACTIVE
Turn environment descriptors into create/start/stop/snapshot/attach/detach/destroy operations behind provider adapters.
Progress note (2026-09-29, Worker B, branch `tl3/b-env-lifecycle`, base `c3b20345cec`): the lifecycle landed in extension-land (`extensions/flauz-environments/src/lifecycle/`): the `EnvironmentExecutor` port (create/start/stop/attach/detach/snapshot/destroy + describe), the typed state machine (`registered -> created -> starting -> running <-> stopping -> stopped -> destroyed` + `failed` + the `/attached` connection substate; illegal transitions are typed errors), the `EnvironmentLifecycleManager` (MANDATORY provenance actor, fail-closed trust gate for start/attach on `untrusted`, typed outcomes never raw throws), the PIN-2 sibling envelopes (`.flauz/environments-lifecycle.json` + append-only `.flauz/environments-ops.jsonl`, exact shapes, fixtures at `test/fixtures/environments-lifecycle/`), the LOCAL-REAL `LocalProcessExecutor` (bound to `workspace-remote` in a documented local-loopback posture; FIXED harness `fixtures/env-agent.ts` only — descriptor-supplied execution forbidden; real terminate/reap with SIGKILL escalation; real sha256 snapshot manifests; orphan + stale crash reconciliation), and the REMOTE-SIMULATED executors (ssh-local/container/cloud-sandbox, TEST INFRASTRUCTURE, explicit `simulated` opt-in only). Commands `flauz.env.create/start/stop/attach/detach/snapshot/destroy/status` (typed results) + lifecycle state/last-op in the tree rows. Real providers remain TL3-004; the `resolvers` grant stays absent (DL-33). Verified: typecheck exit 0 (incl. the pre-existing views.test.ts:193 fix), 94/94 `node --test`, C-ENV canary GREEN, activation-lint GREEN, fork-critical EMPTY, verify-fixtures 82 cases 0 deviations, premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep 0. Status stays ACTIVE pending TL station merge + CI green.

### TL3-004 — Provider matrix
Status: TODO
Implement provider adapters for local, SSH, containers, cloud sandboxes and E2B-style environments behind one contract.

### TL3-005 — Resource graph
Status: DONE (PR #8, squash a695bd8b, 2026-09-27)
Unify files/tasks/browser/environments/artifacts/model/provider resources behind ResourceRef without flattening divergent access surfaces.
Delivered: extensions/flauz-resources — ResourceRef (flauz.resource-ref/v0: logical URN ids, mandatory agent/human/tool provenance), kind-specific access surfaces (vault-only secret refs, literals rejected), typed edges with legality, surface versioning (identity survives surface change — pinned acceptance tests), continuity/restoration plans, resources-ops.jsonl provenance ledger, flauz.res.list/show/graph/verify commands, R-RES canary + flauz-resources.yml, fixture matrix. Verified: station trio (83/83 tests) + all flauz canaries green (R-RES green on first run).

### TL3-006 — Continuity
Status: TODO
Persist and restore logical session/task/context state across environment changes.

## TL4 — Product UX, Verification and Release Quality

### TL4-001 — Product information architecture
Status: ACTIVE
Design and begin implementing the coherent shell across editor, agent, browser, task, environment and evidence surfaces.

Progress note (2026-09-27, branch tl4/a-ia-shell, Worker A): the Flauz shell landed — one activity-bar container `flauz` ($(sparkle), owned by flauz-workspace) holding six tree views backed by real service state: flauz.home + flauz.tasks (flauz-workspace), flauz.agentSessions (flauz-agent), flauz.environments (flauz-environments), flauz.browser (flauz-browser), flauz.models (flauz-models); each with viewsWelcome empty states, error rows with Retry commands, focusView command family (category "Flauz") and view/title refresh. Machine-checkable IA gate at build/flauz/scripts/ia-gate.mjs wired into flauz-hygiene.yml and verify-fixtures.sh (fixtures under test/fixtures/ia-gate/). Spec: docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md. Status stays ACTIVE pending merge-to-main + green CI (SOURCE-OF-TRUTH completion law).

Merge record (2026-09-27, TL4 lead): PR #6 squash-merged to main at
`33e0af4ea9` (branch `tl4/a-ia-shell`, 83 files). Station-verified in
isolation AND as a test-merge with current main: ia-gate CLEAN (6 views in
container `flauz`, 31 command ids); verify-fixtures ALL 72 CASES (0
deviations); compat-battery 1887/1887; activation-lint GREEN; extension
tests re-run at station (all six exit 0; workspace spot-check 64/64);
fork-critical EMPTY; secret sweep 0. Status: the IA shell rung is DONE
pending CI green on main; premium-UX rung (TL4-002) builds on these views.

### TL4-002 — Premium UX
Status: ACTIVE
Implement and verify typography, density, hierarchy, states, focus, keyboard behavior, empty/loading/error/recovery states and polished transitions.

Progress note (2026-09-28, Worker A, branch `tl4/a2-premium-ux`, base `4cee31ec504`): the premium layer landed on the TL4-001 views. Spec: docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md (decision-first: row grammar label/description·separator/codicon, state templates with the exact token contract, keyboard/focus map with reveal navigation, a11y grammar, stock-only motion policy, perceived-performance rules, cross-surface coherence checklist). Implementation across the six extensions: shared date module src/format.ts duplicated verbatim where timestamps render (workspace/agent/environments — gate-enforced identity); last-known-good recovery for Tasks + Environments (a failed refresh keeps prior rows below the error row; Browser stays fail-closed by decision); error/degraded rows unified to contextValue `flauzError` + Retry-titled command; docs surface v1 = flauz-guide.md shipped with flauz-workspace, reachable from every error row via one stock `view/item/context` menu rule (flauz.workspace.openGuide); row-level reveal navigation flauz.workspace.revealTask (session→task, task→evidence expand) via createTreeView + getParent; ages in row descriptions + absolute UTC stamps in tooltips; a11y labels on every row (Home + Browser rows gained them); ia-gate IA6 extended to recognize createTreeView as provider wiring (clean fixture co-updated to cover both forms). Gate: build/flauz/scripts/premium-ux-gate.mjs (PU1 welcome link+guidance, PU2 state/a11y tokens per provider file with the no-failure-source marker for the Models exemption, PU3 focus family, PU4 title/sentence case, PU5 no webview/css/icon-fonts, PU6 single formatTimestamp + no ad-hoc date formatting) — fixtures under test/fixtures/premium-ux-gate/ (clean + no-retry/no-welcome/webview/title-case/date-drift fail cases), wired into verify-fixtures.sh (82 cases, 0 deviations) + flauz-hygiene.yml (`--require` step after the IA gate) + the .eslint-allowed-javascript-files allowlist line (TL4 merge-wave note convention). Branch evidence: premium-ux-gate CLEAN, ia-gate CLEAN, activation-lint GREEN, fork-critical EMPTY, all six extension suites green under `node --test` (335 tests). Status stays ACTIVE pending merge + CI green (SOURCE-OF-TRUTH completion law).

Merge record (2026-09-28, TL4 lead): PR #9 squash-merged to main at `c0af9c3de466` (branch `tl4/a2-premium-ux`, 44 files with integration prep). **Cross-lane semantic conflict caught by the station's test-merge and resolved:** the premium-ux contract applies to every flauz surface, and the TL3 wave (browser runtime + resource graph, PRs #7/#8) landed after A2's base — the merged tree failed PU4 (flauz-resources command titles) and PU6 (flauz-browser `isoAt` ad-hoc `new Date(...).toISOString()`). Resolution, landed as prep commits on BOTH parents so the squash tree was green on arrival (zero red window): (1) branch commit `c9b8f04c10e` — format module v2: `toIsoStamp(epochMs)` protocol sibling, spec §2.4 v2 records the decision; (2) main commit `d4b1576918b` — TL3-surface compliance: flauz-resources titles title-cased (3 commands), flauz-browser gained the 4th verbatim format.ts copy and `isoAt` became a thin wrapper (TL3's `flauz.browser-session/v0` descriptor contract byte-identical before/after). Station verification (never trusting reported numbers): branch-in-isolation all gates exit 0; merged tree verify-fixtures ALL 83 CASES (0 deviations), activation-lint GREEN, ia-gate CLEAN (6 views, 42 commands), compat-battery 1887/1887 PASS, budget-gate GREEN, premium-ux-gate CLEAN (4 format.ts copies), fork-critical-guard EMPTY; full test sweep 478/478 across seven flauz extensions (agent 38, browser 161, environments 47, models 15, resources 83, workspace 69, workflow 65); secret sweep of the full merge diff 0. Station-count delta noted: worker reported 82 fixture cases, station counts 83 (both 0 deviations). Status stays ACTIVE until CI (flauz-hygiene.yml premium-ux-gate `--require` step) reports green on main; then DONE for the fixture rung (reveal-runtime smoke + live file events remain recorded follow-ups).

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

### TL4 merge-wave integration note (2026-09-27, TL4 lead)

The upstream hygiene gate (`local/code-no-new-javascript-files`) rejected the
three new zero-dep gate scripts; fixed by allowlisting them in
`.eslint-allowed-javascript-files` (same precedent as the Wave-4 flauz
harness entries). Applies to future TL4 gate scripts: every new zero-dep
`.mjs` gate merged to main must land with its allowlist line in the same PR.

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
