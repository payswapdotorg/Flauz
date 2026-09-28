# Flauz Current State

Program reset: 2026-09-27
Integrated product branch: main
Integrated head at verification: 0fb23ff106e9807bc6dbf9e0bdb3974e8655d102 (2026-09-28; current main verification point after TL1 completion, TL3 provider/continuity completion, and TL4 runtime-rung completion)

## Branch state

- main is the canonical Flauz product line at 68ea3e7e43bc484d17b2034fef27a2759d30a913. TL1-001..005 are complete; TL3-001..006 are complete at their current registered rungs; TL4-001..009 are complete at their current registered rungs. TL2 remains the active Agent OS lane. Existing TL ownership remains unchanged.
- upstream/main is the preserved Code OSS reference line at 9bf9ae764da438b1234a8243dc9e47173ef58ee7.
- flauz/main is a compatibility alias for the former product branch at 76b7e1a789a0dfa7b900be1fa801016deca7bd99.
- main is 76 commits ahead of upstream/main and 0 behind at the reset point.
- Do not implement product work on upstream/main.

## Control-plane reconciliation

The program documents previously recorded older integrated heads and several future-dated status annotations. Those annotations are historical metadata, not additional code state. The current `main` tree and exact merge/CI evidence are authoritative.

There is intentionally no CopilotKit or OpenMuse runtime dependency. An AG-UI adapter remains a future, additive interoperability option after TL1-003's native Flauz service protocol is stable.

## Agent OS surge

TL2 is the active architectural bottleneck. Three bounded cross-TL secondments are now attached to TL2: TL1 service integration, TL3 resource/execution integration, and TL4 runtime verification. This is a capacity increase only; ownership remains with the home TLs and Agent OS semantics remain owned by TL2.

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

## Known gaps

1. Real model/provider execution and provider routing.
2. Durable multi-agent orchestration, retry/cancel/recovery and collaborative execution.
3. Durable context/memory compilation, retrieval and provenance.
4. Complete human approval/takeover/lease semantics integrated with the durable execution graph.
5. Production-grade reusable workflow execution/versioning/recovery.
6. Real environment providers beyond the fixed local harness and explicitly simulated remote executors.
7. Cross-surface continuity/restoration across agent task, browser, environment and resource state.
8. Browser runtime promotion from fixture/driver coverage to real-workbench E2E and remaining partition/default-policy work.
9. Whole-session acceptance promotion from fixture-backed simulation to real product/runtime coverage (DONE by TL4-007: J1-J4 over real CDP + LocalProcessExecutor, station-green, PR #19).
10. Runtime performance/security/release promotion for currently fixture-backed or pending-runtime gates (advanced by TL4-009: audit delta + SBOM + pinned bundle manifest landed; runtime CI confirmation in flight).
11. TL1-003's versioned native Flauz service protocol and packaging/release parity.
12. Upstream synchronization as an ongoing maintenance lane plus web/desktop verification.

Previous TL2 lab reports are evidence of work performed, not a substitute for current integrated verification.
The code on main plus these program documents is now the authoritative starting point.
