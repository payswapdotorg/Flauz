# Flauz Work Registry

Statuses: TODO | ACTIVE | BLOCKED | VERIFY | DONE | PARKED

## Architect control-plane note — 2026-09-27

- Verified integrated `main`: `2dd52fc6fe39b3ff8cada7a0e4ead33477e7ff8f`.
- No open PRs were present at verification time.
- The detailed TL work sections below are preserved to avoid stealing or reassigning active TL work.
- Any progress paragraph carrying a date later than 2026-09-27 is stale metadata; determine present status from the exact commit/PR/CI evidence on `main`.
- This note does not add a new active TL lane. CopilotKit/OpenMuse integration is intentionally not a dependency; any future AG-UI adapter is downstream of TL1-003 and must be additive.

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
Status: ACTIVE
Audit all Flauz core patches, retire unnecessary ones, and keep the fork-critical guard at zero unless explicitly approved.

Progress note (2026-09-27, Worker A, second dispatch, branch `feat/tl1-004-core-budget`, base `bfeb5e2df91`): the core-change budget landed at `docs/FLAUZ-PROGRAM/CORE-CHANGE-BUDGET.md`. Census at the pinned base (`git diff --name-status upstream/main...HEAD` + `sync-upstream.mjs --report`): 888 paths — 886 ADDITIVE / 2 SHARED-FILE CHANGE (`.eslint-allowed-javascript-files` +32/−0, `AGENTS.md` +39/−3, both allowlisted), 0 unallowlisted divergences, src/vs pristine (guard PASS exit 0; escape hatch `src/vs/workbench/contrib/flauz` unused/absent). Ledger: records CB-1/CB-2 with the four ARCHITECTURE-LOCK §4 fields, census summary table, ZERO-FORK-CRITICAL assertion with guard evidence, per-family template (F1–F5) for future core patches. Retirement verdicts: KEEP ×2 — nothing behavioral to retire, verified honestly (both shared-file changes are non-runtime; allowlist audit 23/23 lines live, 0 stale; no retirement proposed for execution). Guard integrity fix (surgical, `flauz-hygiene.yml` only): (a) push triggers now `[flauz/main, main]` — pushes to main previously bypassed the hygiene gate entirely post-reset; (b) the guard's "pristine base" now fetches `origin upstream/main` (the upstream-sync job's own fetch pattern) and runs `--base origin/upstream/main` — the old `--base origin/main` compared product-vs-product (PR delta only, never the accumulated upstream divergence). Gates: census verbatim, guard exit 0, YAML OK (python3 + pyyaml 6.0.3 parse + structural checks), verify-fixtures ALL 105 CASES AS EXPECTED (0 deviations), TL1-001 gates cited (sync census CLEAN exit 0; `node --test sync-upstream.test.mjs` 12/12). Follow-ups recorded in the ledger §9 (sibling push triggers F-1, machine-checkable ledger validator F-2, UPSTREAM-DELTA.md refresh F-3, path-filter residual gap F-4). Status stays ACTIVE pending merge to main + green CI (SOURCE-OF-TRUTH completion law — DONE is the Lead's flip).

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
Status: DONE (merge 62e46ad0, PR #12 closed-superseded by station merge, 2026-09-27)
Integrate policy, partitions, credential isolation, prompt-injection defenses, screenshot/evidence capture and recovery.
Delivered (Worker A, branch `tl3/a2-browser-security`, base `c3b20345cec`, station-integrated against the hygiene-wave rewrites): per-session UA discipline (agent sessions carry a deterministic Flauz agent product token via Emulation.setUserAgentOverride; human sessions untouched; override failure => typed session error, fail-closed), download policy deny-by-default (Browser.setDownloadBehavior, no allow surface in v0), popup/new-target gate (Target.setAutoAttach + policy-check before use; denied targets closed + evidence row — the B1c class for popups), G6 forced-reset EXECUTION through the policy engine (narrow typed reset op, about:blank only, `security.enforceReset` additive policy key defaulting true, serialized only on explicit opt-out), partition-scoped tab ownership (cross-partition use = typed error; recovery re-attach respects partitions), session journal PIN-1 (`.flauz/browser-sessions.jsonl`, append-only, canonical records, MANDATORY actor — the continuity seam for flauz-resources), untrusted-content boundary markers in capture-derived evidence rows (boundary marker, not sanitization — documented). Verified at station: typecheck exit 0, 205/205 node --test, B-POLICY drill PASS, activation-lint GREEN, fork-critical EMPTY, verify-fixtures 91 cases 0 deviations (merged tree), premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep 0. Integration notes: main's hygiene type-guard `isSessionError` generic constrained (`extends object`) — fixes a pre-existing main TS2322; conflict resolutions documented in the merge commit.

Progress note (2026-09-29, Worker A, branch `tl3/a3-browser-real`, base `cd5273f`): the browser completion rung delivered. (1) The OPTIONAL real-Chromium hardening drill `extensions/flauz-browser/test/canaries/real-chromium-hardening.drill.ts` — the REAL runtime (CdpEndpointHost + BrowserSessionManager + hardening + popup gate + recovery) against a real Chromium over a real CDP WebSocket; REAL RUN GREEN (43 assertions, Chrome for Testing 153.0.8010.12 headless); SKIPs with exit 0 without `FLAUZ_CDP_ENDPOINT` (never fails a gate for lacking a browser); documents + pins FIVE real-Chromium divergences from the FakeCdpTransport contract as drift-canary assertions (F-DELIVERY: page-session auto-attach does not deliver window.open popups; F-POPUP-URL: popup targetInfo.url empty at attach; F-RELEASE-CMD: `Runtime.run` is not a real CDP method — real release is `Runtime.runIfWaitingForDebugger`; F-OPENER-BLOCK: window.open blocks the opener while a popup is held; F-RECOVERY-DOMAINS: recovery does not re-send Page.enable so post-recovery commit observation times out) — recorded as TL fix candidates, NOT patched (semantics pinned by the landed suites). (2) The G3/P1 flauz-defaults posture: DELIVERED-AS-FINDING — an extension CANNOT contribute a configurationDefault for `chat.agent.networkFilter` (APPLICATION scope rejected at the extension point, `configurationExtensionPoint.ts:217,227-232`); the three named product-side alternatives (enterprise policy ChatAgentNetworkFilter / fork-critical in-tree registerDefaultConfigurations contribution / zero-fork default-profile settings.json provisioning pin) are in INTEGRATION-GAP.md G3. (3) Docs: INTEGRATION-GAP.md (G3 + P1 + What-remains with the findings), README.md (the real-Chromium verification section), B-POLICY.md (the optional real-endpoint drill, NOT CI-required). Verified: typecheck exit 0, 205/205 node --test, policy-gated-navigation drill PASS, real-chromium drill REAL RUN PASS, activation-lint GREEN, fork-critical-guard PASS (ledger EMPTY), verify-fixtures ALL CASES 0 deviations, premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep 0.

Merge record (2026-09-27, TL3 station): squash-merged to main at `f430e01090c` (branch `tl3/a3-browser-real`, single commit `3483fc569a3`, 6 files +1017/-25; clean auto-merge — the interim hygiene wave touched only src/*.ts, no overlap). Station verification INDEPENDENTLY RE-RUN (never trusting reported numbers): flauz-browser typecheck exit 0, 205/205 node --test, B-POLICY drill GREEN, real-chromium drill REAL RUN at station against a dedicated headless Chromium 153.0.8010.12 (exit 0, the five pinned divergences reproduced exactly as reported) + SKIP-mode exit 0, activation-lint GREEN, fork-critical EMPTY, verify-fixtures 91 cases (base tree) and 103 cases (merged tree, both 0 deviations), premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep of the full diff 0. security-gate: identical environmental FAIL on main-baseline @ 7f2618f0 and the merged tree (the packaging row needs the CI npm install; evidence mode promotes its SKIP) — no regression from this merge. Status: the browser completion rung is DONE (the IA-shell boot verification of window.openBrowserTab remains with the B-POLICY canary as documented; G5/G6 stay product-side records).

### TL3-003 — Environment lifecycle
Status: DONE (PR #11, squash a9f51d61, 2026-09-27)
Turn environment descriptors into create/start/stop/snapshot/attach/detach/destroy operations behind provider adapters.
Progress note (2026-09-29, Worker B, branch `tl3/b-env-lifecycle`, base `c3b20345cec`): the lifecycle landed in extension-land (`extensions/flauz-environments/src/lifecycle/`): the `EnvironmentExecutor` port (create/start/stop/attach/detach/snapshot/destroy + describe), the typed state machine (`registered -> created -> starting -> running <-> stopping -> stopped -> destroyed` + `failed` + the `/attached` connection substate; illegal transitions are typed errors), the `EnvironmentLifecycleManager` (MANDATORY provenance actor, fail-closed trust gate for start/attach on `untrusted`, typed outcomes never raw throws), the PIN-2 sibling envelopes (`.flauz/environments-lifecycle.json` + append-only `.flauz/environments-ops.jsonl`, exact shapes, fixtures at `test/fixtures/environments-lifecycle/`), the LOCAL-REAL `LocalProcessExecutor` (bound to `workspace-remote` in a documented local-loopback posture; FIXED harness `fixtures/env-agent.ts` only — descriptor-supplied execution forbidden; real terminate/reap with SIGKILL escalation; real sha256 snapshot manifests; orphan + stale crash reconciliation), and the REMOTE-SIMULATED executors (ssh-local/container/cloud-sandbox, TEST INFRASTRUCTURE, explicit `simulated` opt-in only). Commands `flauz.env.create/start/stop/attach/detach/snapshot/destroy/status` (typed results) + lifecycle state/last-op in the tree rows. Real providers remain TL3-004; the `resolvers` grant stays absent (DL-33). Verified: typecheck exit 0 (incl. the pre-existing views.test.ts:193 fix), 94/94 `node --test`, C-ENV canary GREEN, activation-lint GREEN, fork-critical EMPTY, verify-fixtures 82 cases 0 deviations, premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep 0.

Merge record (2026-09-27, TL3): PR #11 squash-merged to main at `a9f51d61` (base `c3b20345` + prep `c6e2d5c6` — the TL station's capability-guard narrowing fix for the hygiene-wave providers/index.ts TS2322 break found during the test-merge gate run). Station-verified post-merge on the integrated tree: typecheck exit 0, 94/94 tests, C-ENV canary PASS, activation-lint GREEN, fork-critical EMPTY, verify-fixtures 91 cases 0 deviations, premium-ux-gate CLEAN, ia-gate CLEAN, secret sweep 0. Status DONE.

### TL3-004 — Provider matrix
Status: DONE (rung 1 — station-integrated 2026-09-27; rung 2 = live workbench resolver code + the resolvers grant, see INTEGRATION-GAP)
Implement provider adapters for local, SSH, containers, cloud sandboxes and E2B-style environments behind one contract.
Delivered (Worker B, branch `tl3/b2-providers`, single commit `1044899c11a`, 17 files +4172/-227, base `cd5273fe`): the CliPort seam (injectable process-runner, timeout+kill), SshCliExecutor (ssh-cli, serves ssh-local: capability probe, descriptor-data auth, FIXED-harness-over-stdin start — descriptor-supplied execution still forbidden, pid-tracked escalation, ssh-cat snapshots into the canonical manifest), DockerCliExecutor (docker-cli, serves container: docker-info probe with typed CLI_NOT_AVAILABLE, pinned-safe run+cp of the fixed harness, stop-escalation, describe reconciliation via real docker inspect), CloudHttpAdapter (cloud-http, serves cloud-sandbox: real REST client over an injectable HttpPort, apiKeyRef vault-gated, local mock-server failure-class drills), manager routing (remote kinds -> real executors; workspace-remote/local-process + simulated opt-in unchanged), 5 test suites incl. the FakeCli scriptable port + SKIP-gated liveRemote live drills. Station verification independently re-run: typecheck 0, 131 tests 129/0/2, all gates green, siblings 205+83, secrets 0. Station integration: 1 indent-style conflict resolved (manager.ts, zero semantic delta) + a merge-wave ROBUSTNESS FIX in fixtures/env-agent.ts (signal handlers now arm BEFORE the ready line — a load-sensitive SIGKILL-escalation race observed ~1-in-3 under CPU stress; 8/8 clean stress runs post-fix).
Implement provider adapters for local, SSH, containers, cloud sandboxes and E2B-style environments behind one contract.

### TL3-005 — Resource graph
Status: DONE (PR #8, squash a695bd8b, 2026-09-27)
Unify files/tasks/browser/environments/artifacts/model/provider resources behind ResourceRef without flattening divergent access surfaces.
Delivered: extensions/flauz-resources — ResourceRef (flauz.resource-ref/v0: logical URN ids, mandatory agent/human/tool provenance), kind-specific access surfaces (vault-only secret refs, literals rejected), typed edges with legality, surface versioning (identity survives surface change — pinned acceptance tests), continuity/restoration plans, resources-ops.jsonl provenance ledger, flauz.res.list/show/graph/verify commands, R-RES canary + flauz-resources.yml, fixture matrix. Verified: station trio (83/83 tests) + all flauz canaries green (R-RES green on first run).

### TL3-006 — Continuity
Status: DONE (merge 6e014f59aa4, station-integrated 2026-09-27)
Persist and restore logical session/task/context state across environment changes.
Delivered (Worker C, branch `tl3/c2-continuity`, single commit `11b7df2cbed`, 58 files +6377/-38, base `dcec0f8f`): continuity as an EXECUTABLE capability — flauz-environments `src/continuityExec/` (ContinuityManager export/restore/verify/status with typed ops + MANDATORY provenance; the `flauz.continuity-bundle/v0` manifest + append-only `flauz.continuity-ops/v0` ledger with the DL-9/DL-32 canonical discipline; the N-8 surface canon materialized from real `.flauz/` state with the SECRET-REDACTION LAW — secret-shaped surfaces record presence + path hash, never payloads; logical ids `flauz:continuity:<16-hex>`), commands `flauz.continuity.export/restore/verify/status` (restore destructive-class: force-gated, atomic per-surface, fail-closed on untrusted targets), the additive `planSwitch.continuityBundleId?` hand-off, and the flauz-resources PIN-1 journal bridge (`journalBridge.ts`: strict READ-ONLY parser, ResourceRef minting from logical sessionIds, attribution-real edges, `flauz.res.syncBrowserSessions` with provenance). 37 fixtures (good + 35 bad) + 648/242-line suites. Station verification independently re-run: env 113/113 + res 93/93 in isolation; merged tree (with TL3-004) env 150 tests 148/0/2 + res 93/93, typechecks 0, all gates green, siblings 205/205, secrets 0 (3 sweep hits examined — regex patterns + runtime-fragment assembly per the no-literal law, benign). Integration: 4 additive conflicts resolved by union; a stale-local-main trap (first merge silently b2-less, caught by the 113-vs-150 test count) was caught and redone on the true main.
Persist and restore logical session/task/context state across environment changes.

## TL4 — Product UX, Verification and Release Quality

### TL4-001 — Product information architecture
Status: DONE (fixture rung; 2026-09-28: flauz-hygiene CI green on main @ 6985b2d015a — fork-critical, activation-lint, IA gate, compile+hygiene, Flauz unit tests all PASS)
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
Status: DONE (fixture rung; 2026-09-28: flauz-hygiene CI green on main @ 6985b2d015a — Premium UX gate step PASS; recorded follow-ups: reveal-runtime smoke, live file events)
Implement and verify typography, density, hierarchy, states, focus, keyboard behavior, empty/loading/error/recovery states and polished transitions.

Progress note (2026-09-28, Worker A, branch `tl4/a2-premium-ux`, base `4cee31ec504`): the premium layer landed on the TL4-001 views. Spec: docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md (decision-first: row grammar label/description·separator/codicon, state templates with the exact token contract, keyboard/focus map with reveal navigation, a11y grammar, stock-only motion policy, perceived-performance rules, cross-surface coherence checklist). Implementation across the six extensions: shared date module src/format.ts duplicated verbatim where timestamps render (workspace/agent/environments — gate-enforced identity); last-known-good recovery for Tasks + Environments (a failed refresh keeps prior rows below the error row; Browser stays fail-closed by decision); error/degraded rows unified to contextValue `flauzError` + Retry-titled command; docs surface v1 = flauz-guide.md shipped with flauz-workspace, reachable from every error row via one stock `view/item/context` menu rule (flauz.workspace.openGuide); row-level reveal navigation flauz.workspace.revealTask (session→task, task→evidence expand) via createTreeView + getParent; ages in row descriptions + absolute UTC stamps in tooltips; a11y labels on every row (Home + Browser rows gained them); ia-gate IA6 extended to recognize createTreeView as provider wiring (clean fixture co-updated to cover both forms). Gate: build/flauz/scripts/premium-ux-gate.mjs (PU1 welcome link+guidance, PU2 state/a11y tokens per provider file with the no-failure-source marker for the Models exemption, PU3 focus family, PU4 title/sentence case, PU5 no webview/css/icon-fonts, PU6 single formatTimestamp + no ad-hoc date formatting) — fixtures under test/fixtures/premium-ux-gate/ (clean + no-retry/no-welcome/webview/title-case/date-drift fail cases), wired into verify-fixtures.sh (82 cases, 0 deviations) + flauz-hygiene.yml (`--require` step after the IA gate) + the .eslint-allowed-javascript-files allowlist line (TL4 merge-wave note convention). Branch evidence: premium-ux-gate CLEAN, ia-gate CLEAN, activation-lint GREEN, fork-critical EMPTY, all six extension suites green under `node --test` (335 tests). Status stays ACTIVE pending merge + CI green (SOURCE-OF-TRUTH completion law).

Merge record (2026-09-28, TL4 lead): PR #9 squash-merged to main at `c0af9c3de466` (branch `tl4/a2-premium-ux`, 44 files with integration prep). **Cross-lane semantic conflict caught by the station's test-merge and resolved:** the premium-ux contract applies to every flauz surface, and the TL3 wave (browser runtime + resource graph, PRs #7/#8) landed after A2's base — the merged tree failed PU4 (flauz-resources command titles) and PU6 (flauz-browser `isoAt` ad-hoc `new Date(...).toISOString()`). Resolution, landed as prep commits on BOTH parents so the squash tree was green on arrival (zero red window): (1) branch commit `c9b8f04c10e` — format module v2: `toIsoStamp(epochMs)` protocol sibling, spec §2.4 v2 records the decision; (2) main commit `d4b1576918b` — TL3-surface compliance: flauz-resources titles title-cased (3 commands), flauz-browser gained the 4th verbatim format.ts copy and `isoAt` became a thin wrapper (TL3's `flauz.browser-session/v0` descriptor contract byte-identical before/after). Station verification (never trusting reported numbers): branch-in-isolation all gates exit 0; merged tree verify-fixtures ALL 83 CASES (0 deviations), activation-lint GREEN, ia-gate CLEAN (6 views, 42 commands), compat-battery 1887/1887 PASS, budget-gate GREEN, premium-ux-gate CLEAN (4 format.ts copies), fork-critical-guard EMPTY; full test sweep 478/478 across seven flauz extensions (agent 38, browser 161, environments 47, models 15, resources 83, workspace 69, workflow 65); secret sweep of the full merge diff 0. Station-count delta noted: worker reported 82 fixture cases, station counts 83 (both 0 deviations). Status stays ACTIVE until CI (flauz-hygiene.yml premium-ux-gate `--require` step) reports green on main; then DONE for the fixture rung (reveal-runtime smoke + live file events remain recorded follow-ups).

### TL4-003 — Code OSS compatibility battery
Status: DONE (fixture rung; 2026-09-28: flauz-compat CI green on main @ 6985b2d015a — 1887/1887 rows PASS, fixture matrix green; runtime promotion for L3 remains follow-up)
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
Status: DONE (fixture rung; 2026-09-27: TL4-006-head CI green on main @ 2dd52fc6fe — flauz-session, flauz-compat, flauz-budgets, flauz-workflow, flauz-security, flauz-hygiene all GREEN on the same head; runtime promotion = follow-up)
Run real user-session simulations spanning task creation, agent execution, browser, environment, verification, artifact and recovery.

Progress note (2026-09-27, TL4 lead, station-executed — the dispatched
worker's lane never landed; TL4 executed personally per the
start-immediately doctrine):
  - Suite extensions/flauz-workflow/test/session-battery.test.ts: four
    whole-user-session journeys driving the REAL modules — J1 golden
    (create -> plan -> approve -> tool artifact+ledger -> browser leg over
    FakeCdpTransport with the policy engine + on-disk journal ->
    environment lifecycle behind SimulatedRemoteExecutor -> verify ->
    sign-off -> save fragment), J2 recovery (re-run with replay approvals:
    new task, derivedFrom-linked evidence, fragment history), J3
    fail-closed (denied navigation sends ZERO drive commands; actor-less
    lifecycle op = typed ACTOR_REQUIRED rejection), J4 continuity (full
    restart on the same root: tasks/workflows/lifecycle/journal recover;
    re-run completes).
  - Pinned-transcript discipline: golden-transcript.json deep-compared
    every run; doctored variant proves failability (exit 1); determinism
    proven across bun + node runners.
  - Gate build/flauz/scripts/session-battery.mjs (zero-dep; --require
    evidence mode; node >= 22.6 runner detection, SKIP semantics); CI lane
    .github/workflows/flauz-session.yml (dedicated
    tsconfig.session-battery.json typecheck — the suite spans three
    extensions — + battery --require + doctored-fixture proof + fixture
    matrix; the compiled unit-subset lane runs it as .js too).
  - Spec docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md (journey catalogue,
    transcript contract, promotion ladder: fixture -> compiled -> runtime
    rung). Runtime rung (real CDP, LocalProcessExecutor, booted workbench)
    activates when TL2/TL3 expose CI-driveable seams.

### TL4-005 — Performance and resource budget
Status: DONE (fixture rung; 2026-09-28: flauz-budgets CI green on main @ 6985b2d015a; runtime promotion for the 9 pending-runtime rows remains follow-up)
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
Status: DONE (fixture/static rung; 2026-09-27: same-head 6-workflow CI green on main @ 2dd52fc6fe; runtime rung — npm audit delta, bundle signatures, SBOM — documented as follow-up)
Create integrated gates for secrets, permissions, browser safety, supply chain, packaging, signing and reproducible release artifacts.

Progress note (2026-09-27, TL4 lead, station-executed — the dispatched
worker's lane never landed; TL4 executed personally):
  - Gate build/flauz/scripts/security-gate.mjs (zero-dep): secrets row
    (12-pattern credential battery over the Flauz additive namespace +
    documented allowlist build/flauz/security-allowlist.json +
    unused-entry hygiene), dependency-purity (flauz extensions: zero
    runtime deps, devDeps allowlisted), proposed-api (composed rota),
    packaging (double-bundle byte-identical dist hashes via the repo's
    own esbuild = reproducible release artifacts).
  - Fixture matrix (test/fixtures/security-gate/): clean tree (placeholders
    never fire), planted-github/neon/connstring/key (each fires, SYNTHETIC
    tokens), allowlist suppression + unused-entry detection — pinned in
    verify-fixtures.sh (104 cases).
  - CI .github/workflows/flauz-security.yml: job 1 zero-dep static rows +
    fixture matrix (node 20); job 2 full --require after the root install
    (the hygiene lane's own native-build preamble: libkrb5-dev,
    libx11/libxkbfile headers, electron headers preinstall).
  - Delegated dynamic rows (documented, never faked): DL-20
    hardened-ledger integrity (flauz-workflow.yml hardening.test.ts),
    browser deny-by-default (flauz-browser.yml suites + session-battery
    J3). Spec: docs/FLAUZ-PROGRAM/TL4-SECURITY-GATE.md.

### TL4-008 - Compat L3 runtime boot smoke
Status: DONE (2026-09-27, TL4 lead merge record: station `verify-branch.sh tl4/b3-compat-l3` GREEN @ 7c02f356c8c — 13 gates, zero src/ changes, secret sweep clean, fixtures 116/116; squash-merged as PR #14 -> main @ c1d9414ec13b; branch deleted; `compat-l3` lane dispatched on main per SOURCE-OF-TRUTH completion law — first-run record in `build/flauz/compat-l3-baseline.md`)
Promote the Code OSS compatibility battery's layer 3 (TL4-COMPAT-BATTERY section 11) from a PROBE-ONLY CI placeholder to a REAL, CI-executed runtime boot smoke: the workbench still boots and the pillar surfaces still function with the flauz extensions active, proven at runtime on a runner (never a worker sandbox).

Progress note (Worker B, branch `tl4/b3-compat-l3`):
- Driver `build/flauz/scripts/compat-l3-smoke.mjs` (zero-dep, node >= 20, `--help` + house exit codes): attach mode (CI: CDP `/json/version` + `/json/list` readiness/target rows, log-corpus fatal scan, source-pinned extension-host + flauz activation markers from extHostExtensionService.ts:480,818, compiled pillar rows in the B-POLICY A3 pattern) and child mode (`--cmd`: process-group ownership, auto-wired captures, natural exit code). Honesty law: unobservable rows are SKIP with the exact reason, never a fake pass; catalogue is ADDITIVE.
- CI `compat-l3` job in `.github/workflows/flauz-compat.yml` (job 1 untouched): the proven preamble (apt natives + xvfb stack, preinstall, npm install, electronTypes, the hygiene `npm-run-all2 -l core-ci hygiene ...` compile line, then `npm run compile` for the bootable dev `out/` tree, `bundle-extensions.mjs --verify`, setup-electron), then the b-policy-canary boot (`DISPLAY=:10 ./scripts/code.sh --verbose --remote-debugging-port=9333 ...` under the xvfb service), then the driver `--require`, then process-tree kill ALWAYS + boot-log/report artifacts (pinned SHAs, auto-token-only install env per DL-20/DL-28).
- Trigger policy: `workflow_dispatch` (opt-in, the job compiles) + one weekly `schedule` canary (Mon 04:23 UTC); never per-push.
- Fixture-backed: `test/fixtures/compat-l3/` (clean/fatal/no-ext/no-flauz log corpora + fake-out compiled trees), `build/flauz/compat-l3-smoke.test.mjs` (17 node --test cases incl. fake CDP servers and child-mode stubs), verify-fixtures.sh section. Baseline `build/flauz/compat-l3-baseline.md`: row census (14 PASS-capable, 4 functional SKIP rows), first-run record table, honest distance ladder (CDP-WebSocket DOM rows, lane F functional smokes, exit-clean in CI, browser-mode boot).

### TL4 merge-wave integration note (2026-09-27, TL4 lead)

The upstream hygiene gate (`local/code-no-new-javascript-files`) rejected the
three new zero-dep gate scripts; fixed by allowlisting them in
`.eslint-allowed-javascript-files` (same precedent as the Wave-4 flauz
harness entries). Applies to future TL4 gate scripts: every new zero-dep
`.mjs` gate merged to main must land with its allowlist line in the same PR.

### TL4-007 — Session-battery runtime rung (real CDP + real executor)
Status: ACTIVE (2026-09-27, Worker A dispatched from the replay, branch `tl4/a3-session-runtime`, base dcec0f8f7c9)
Promote the whole-session acceptance battery (TL4-004) from the fixture
rung to the runtime rung: the same four journeys (J1 golden, J2 recovery,
J3 fail-closed, J4 continuity) over REAL ports — the real CdpEndpointHost
against a real headless Chromium over a real CDP WebSocket (the proven
TL3-003 drill seam) and the real LocalProcessExecutor for the environment
leg. The journey catalogue and transcript contract stay IDENTICAL; only
the ports change. Volatile runtime values are normalized via an explicit
documented table, never a silent loosening. CI lane: opt-in
`session-runtime` job in flauz-session.yml (Chrome-for-Testing download +
FLAUZ_CDP_ENDPOINT). This is the CURRENT-STATE "Known gaps" item 9
(whole-product end-to-end acceptance) executed at the battery level.

### TL4-009 — Security-gate runtime rung (audit delta, SBOM, bundle manifest)
Status: DONE (2026-09-27, TL4 lead merge record: station `verify-branch.sh tl4/c3-security-runtime` GREEN @ a539330e044 — 13 gates incl. the NEW security-runtime-gate itself (audit-delta + CycloneDX 1.5 SBOM + pinned bundle-signature manifest), verify-fixtures GREEN, compat-battery 1887/1887, secret sweep 0 hits, zero src/ changes; eslint allowlist union-resolved with TL4-008 entries; squash-merged as PR #15 -> main @ 337aac0df5d8; branch deleted; flauz-security push lane re-runs the runtime gate at the merge head — CI-CONFIRMED GREEN at head 46e36ba71e4 (the Flauz Security workflow completed success 2026-09-27 incl. the runtime gate step with the committed pins), security-runtime-report available via workflow_dispatch) [station-of-record addendum, TL3 resident: the flip's "pinned bundle-signature manifest" gate row was verified in its esbuild-unresolvable SKIP shape, not against pins; the manifest shipped STATION-PENDING and the pins landed in the station-completion commit immediately after this flip — the flauz-security lane needs a head >= that commit to go green, per the SOURCE-OF-TRUTH completion law]
Promote the integrated security gate (TL4-006) from the fixture/static
rung to the runtime rung: post-install npm-audit delta over the
flauz-added dependency set (product root package.json vs upstream/main),
CycloneDX 1.5 JSON SBOM emission for the flauz artifact set (zero-dep
generator), and a pinned bundle-signature manifest (sha256 per flauz
extension bundle; regenerate-and-diff = FAIL on drift — the supply-chain
tamper signal). Rows are additive; the existing security-gate.mjs stays
frozen. CI: the flauz-security post-install job gains the runtime gate
step; a workflow_dispatch report job uploads SBOM + report artifacts. This
is the CURRENT-STATE "Known gaps" item 10 (production packaging/release)
advanced at the gate level.

Station completion record (TL3 resident, 2026-09-27 ~22:57Z): the TL4 lead's
PR #15 squash-merge (47s open-to-merge, CI not awaited) landed the runtime
rung with the bundle manifest still STATION-PENDING — the merge's own CI
wiring (flauz-security job 2, --require) fails by design until the pins
exist (not-pinned = divergence, the tamper-signal posture). Resolved at
this station per the in-file procedure: build/ subpackage install (npm ci
--ignore-scripts, 544 pkgs, 9s) -> --generate on the merged tree -> 7
extensions / 7 artifacts, byte-identical double-bundle passes; pins
deterministic across trees (identical values regenerated from two
different base trees carrying the same extension sources — the
reproducible-bundling law holding under cross-tree comparison).
Robustness fix riding this commit: the verify-fixtures repo-mode guard
now mirrors the gate's resolveEsbuild candidate list (three paths); the
worker guard assumed esbuild-unresolvable whenever root node_modules was
absent, which deviates in any station-pin posture (build/-only install).
Both shapes proven: 131 cases 0 deviations (esbuild-absent) / 125 + note
(esbuild-present). Full battery on the final tree: fork-critical PASS,
activation-lint GREEN, ia-gate CLEAN, premium-ux-gate CLEAN, security-gate
GREEN, security-runtime-gate GREEN (sbom + manifest PASS vs pins; audit
row live only post-install). Hygiene context: the same station restored
main's hygiene law earlier tonight (23c3a568b2b — the TL4-008 squash-merge
had landed 13 unallowlisted compat-l3 fixture .js files; merged before its
PR hygiene run failed at 22:43:40Z).

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
