# Flauz Current State

Program control-plane refresh: 2026-09-28
Integrated product branch: main
Integrated head at verification: `main` HEAD (resolve the live SHA with `git rev-parse main`)

## Branch state

- main is the canonical Flauz product line; the live integrated SHA is whatever `git rev-parse main` reports. All registered TL1/TL2/TL3/TL4 work-items are DONE at their recorded rungs; the final control-plane reconciliation is the latest integrated commit.
- upstream/main is the preserved Code OSS reference line at 9bf9ae764da438b1234a8243dc9e47173ef58ee7.
- flauz/main is a compatibility alias for the former product branch at 76b7e1a789a0dfa7b900be1fa801016deca7bd99.
- main is 221 commits ahead of upstream/main and 0 behind at the reset point.
- Do not implement product work on upstream/main.

## Control-plane reconciliation

The integrated tree on `main` is authoritative. Older head annotations and any future-dated historical progress paragraphs are subordinate records only.

There is no CopilotKit or OpenMuse runtime dependency. AG-UI remains a possible additive projection after the native Flauz service protocol; it is not a current runtime dependency.

## Agent OS surge

The TL2 Agent OS surge is closed. The three bounded secondments (TL2-S1/S2/S3) are complete and their helpers are released to TL1/TL3/TL4. Ownership never moved from the home TLs.

The Agent OS runtime verification battery (TL2-S3, PR #30) is landed: the 8-invariant durability catalogue (flauz.agentos-battery/v1) with one behavioral contract across two promotion rungs (fixture -> runtime), the zero-dep agentos-battery gate (default / --require / --surge-rung / --runtime), doctored controls, the flauz-agentos CI lane, and the honest baseline. Its census (identical at both rungs): 4 PASS, 3 FAIL findings mapped to TL2-001/002 follow-ups (bounded retry, cancellation propagation, concurrent ledger appends), 1 SKIP for the pending lease-conflict contract (TL2-004). The surge completion claim bar is `agentos-battery.mjs --surge-rung`.

## Present product surfaces

The integrated Flauz branch contains:
- extensions/flauz-agent
- extensions/flauz-browser
- extensions/flauz-environments
- extensions/flauz-models
- extensions/flauz-workflow
- extensions/flauz-workspace
- a Flauz activity-bar shell: container `flauz` with Home, Tasks, Agent Sessions, Environments, Browser and Models views (TL4-001, branch tl4/a-ia-shell)
- a premium UX layer over those views (TL4-002, branch tl4/a2-premium-ux): unified error rows with Retry + guide context-menu, last-known-good recovery, row ages/tooltips, reveal navigation, a11y labels on every row
- product.flauz.json
- Flauz build/merge tooling
- browser/environment/workflow/performance canaries
- fork-critical and hygiene guards
- contract fixtures and tests

## Proven at slice level

### Agent

The current bridge demonstrates:
- Flauz chat participant;
- human-gated terminal tool;
- task state seam;
- hash-chained evidence ledger;
- approval/sign-off transitions;
- model selection seam;
- local service process over stdio;
- A2A envelope work.

The current implementation explicitly describes itself as a v0 vertical slice with documented simplifications.

### Workspace/evidence

The current workspace extension provides:
- canonical .flauz/tasks.json;
- append-only hash-chained evidence ledger;
- task state machine;
- evidence exposure;
- chat-edit checkpoint interoperability.

### Models

The current models extension provides a provider seam with adapter implementations for vendors including Codex, Claude and Qwen.

Do not call this full production provider support yet.

### Browser

The browser extension now provides the layered policy engine, partition semantics, fail-closed behavior, CDP-bypass protection AND the TL3-001 runtime: CDP transport (+ test simulator), session manager with human/agent separation, policy-gated navigation (deny sends zero CDP commands), capture->evidence, recovery, and workbench/endpoint host adapters (proposed browser API grant active). TL3-002 session-security hardening is merged (62e46ad0): per-session UA discipline, download deny, popup/new-target gate, G6 forced-reset execution (security.enforceReset), partition-scoped tab ownership, the PIN-1 session journal, untrusted-content evidence markers.

Remaining for the complete browser product: real-workbench E2E of the driver path (B-POLICY boot residuals — the workbench-level window.openBrowserTab boot verification stays with the B-POLICY canary), G5 partition minting (product-side), L2 default-on (G3/P1 — RESOLVED AS FINDING 2026-09-27: an extension CANNOT contribute a configurationDefault for the restricted APPLICATION-scoped `chat.agent.networkFilter`; the zero-fork alternatives live in INTEGRATION-GAP G3). The real-Chromium behavior rung landed (f430e01090c lineage, rebased to 112c72e1): the optional real-chromium-hardening drill (station REAL RUN exit 0 against headless Chromium 153) pins FIVE real-Chromium divergences from the FakeCdpTransport contract as drift canaries (F-DELIVERY, F-POPUP-URL, F-RELEASE-CMD, F-OPENER-BLOCK, F-RECOVERY-DOMAINS) — recorded TL fix candidates, semantics untouched.

### Environments

The current environment extension provides:
- typed descriptors;
- registry;
- continuity model;
- adapters/plans for local/SSH/container/cloud-style environments.

The TL3-003 lifecycle is DONE (PR #11 a9f51d61): create/start/stop/attach/detach/snapshot/destroy behind the EnvironmentExecutor contract, local-real LocalProcessExecutor (fixed harness, SIGKILL escalation, real fs snapshots) + remote-simulated executors (explicit opt-in), PIN-2 lifecycle envelopes, trust-gated ops. TL3-004 rung 1 is DONE (merge 29bc28ba645): the remote kinds are REAL behind the same contract — SshCliExecutor (system ssh, fixed-harness-over-stdin), DockerCliExecutor (docker daemon, typed CLI_NOT_AVAILABLE), CloudHttpAdapter (injectable HttpPort, apiKeyRef vault-gated, mock-server drills), CliPort seam, FakeCli + skip-gated liveRemote suites. Rung 2 (live workbench resolver code + the resolvers grant, DL-33) remains the documented residual.

Do not call every adapter a production provider.

### Resources (TL3-005, merged; TL3-006 merged)

extensions/flauz-resources provides the logical resource graph: ResourceRef identity, kind-specific access surfaces, typed edges, continuity/restoration plans and the provenance ops ledger, persisted under .flauz/ with the sibling-envelope discipline. TL3-006 is DONE (merge 6e014f59aa4): continuity is an EXECUTABLE capability — flauz-environments src/continuityExec/ (content-addressed bundles with the secret-redaction law, the continuity ops ledger, flauz.continuity.export/restore/verify/status typed commands, force-gated atomic restore, the planSwitch hand-off) + the flauz-resources PIN-1 journal bridge (strict READ-ONLY parser, ResourceRef minting from logical session ids, attribution-real edges, flauz.res.syncBrowserSessions).

### Whole-session acceptance battery (TL4-004, merged)

Four scripted user journeys drive the real Flauz surfaces end to end (task state machine, evidence ledger, workflow envelope save/re-run, browser session manager with policy + journal, environment lifecycle): golden session, recovery re-run with derived evidence, fail-closed denial paths, and continuity after full restart. Pinned transcript fixtures make every observable outcome machine-checked on each Flauz-relevant change; the runtime rung (real CDP, real executor) is the documented promotion.

### Integrated security and release gates (TL4-006, merged)

One machine-checked verdict for the release-blocking security surface: credential-pattern scan over the Flauz namespace with a documented allowlist, supply-chain dependency purity, the proposed-API permissions rota, and reproducible packaging (double-bundle byte-identical dist hashes). Dynamic rows (DL-20 ledger integrity, browser deny-by-default) run in their own CI lanes and are named in the coverage matrix.

### Workflow

The current workflow extension provides a workflow envelope and the integrated M1 safety rail.

Later workflow capabilities must be re-established from current code and tests before being called complete.

## Remaining hardening and promotion work

The registered work-items are complete, but the integrated verification has explicit residuals. These are not hidden behind DONE statuses:

1. TL2 Agent OS runtime findings: INV-3 cancellation propagation and INV-6 concurrent ledger serialization CLOSED by the FLAUZ-TL2-F1 hardening lane (PR #39, merge e7aab856, 2026-09-28; census now 6 PASS / 1 FAIL / 1 SKIP at main, DL-77 serialized-append discipline ratified). The INV-5 lease-conflict SKIP is CLOSED by the FLAUZ-TL2-F3 lane (PR #43, merge 8f58f3c2, 2026-09-28 — the typed LeaseConflictError contract on both the a2a claim path and the store lease transitions, plus the sanctioned INV-5 battery journey, live-proven at the runtime rung). Census at main: 7 PASS / 1 FAIL / 0 SKIP. Remaining: INV-2 bounded provider retry (wave-3 lane F2, in flight) — the sole census row left.
2. TL3 provider rung 2: live workbench resolver code and the associated `resolvers` grant remain outstanding.
3. TL3 browser product residuals: CLOSED (TL3-H2 merged 2026-09-28, 5786446b633). The workbench `window.openBrowserTab` boot verification is LANDED as the CI-executable B-POLICY boot drill (job `b-policy-boot-drill`, workflow_dispatch + weekly Tuesday 04:41 UTC; the ERR_BLOCKED_BY_CLIENT honest-SKIP boundary recorded); G5 partition minting and the G3 networkFilter default posture are PERMANENTLY RECORDED as verified extension-platform limitations (INTEGRATION-GAP G5/G3; DL-75/DL-76).
4. TL4 performance promotion: 9 pending-runtime budget rows remain to be measured on real runtime surfaces.
5. Platform baseline debt observed by TL2-S3: CLOSED by PLATFORM-H1 (PR #36, merge ad01c49a) — the SBOM/packaging-parity/bundle-manifest pins regenerated, the fixture-matrix deviations fixed, the Lane-K typecheck and the hygiene format error repaired; the seven affected flauz lanes green at the merge head. One named residual remains, an explicit registry item: the perf startup-pair R6 drift (TL4-H1 evidence, owner TL4; pre-existing since 2026-09-27). The flauz-namespace eslint-warning debt was CLOSED by PLATFORM-H2 (PR #37, merge 84c07a9b): 474 warnings to zero, the Compile & Hygiene pipeline line green end-to-end on main.
6. Live-provider drills remain follow-up evidence for TL2-002; fixture evidence must not be described as live-provider verification.

These items are tracked in `WORK-REGISTRY.md` under the post-completion hardening register.

Previous TL2 lab reports are evidence of work performed, not a substitute for current integrated verification.
The code on main plus these program documents is now the authoritative starting point.


## Source-of-truth rule

This file is a derived state summary. For any conflict, obey `SOURCE-OF-TRUTH.md` and inspect the actual `main` tree/CI evidence.