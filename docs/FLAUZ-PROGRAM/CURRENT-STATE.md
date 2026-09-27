# Flauz Current State

Program reset: 2026-09-27
Integrated product branch: main
Integrated head at verification: 2dd52fc6fe3 (TL4 wave 2: TL4-004 whole-session acceptance battery + TL4-006 integrated security/release gates landed with same-head 6-workflow CI green — session, compat, budgets, workflow, security, hygiene; the TL3 wave-2 chronic hygiene debt (space indentation 3866, eslint 92) cleared by the TL4 lane)

## Branch state

- main is the canonical Flauz product line at 2dd52fc6fe3 (ALL SIX TL4 items done: 001/002/003/004/005/006; TL3-001/002/003/005 done; TL1-001 active).
- upstream/main is the preserved Code OSS reference line at 9bf9ae764da438b1234a8243dc9e47173ef58ee7.
- flauz/main is a compatibility alias for the former product branch at 76b7e1a789a0dfa7b900be1fa801016deca7bd99.
- main is 76 commits ahead of upstream/main and 0 behind at the reset point.
- Do not implement product work on upstream/main.

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

The TL3-003 lifecycle is DONE (PR #11 a9f51d61): create/start/stop/attach/detach/snapshot/destroy behind the EnvironmentExecutor contract, local-real LocalProcessExecutor (fixed harness, SIGKILL escalation, real fs snapshots) + remote-simulated executors (explicit opt-in), PIN-2 lifecycle envelopes, trust-gated ops. Real providers remain TL3-004.

Do not call every adapter a production provider.

### Resources (TL3-005, merged)

extensions/flauz-resources provides the logical resource graph: ResourceRef identity, kind-specific access surfaces, typed edges, continuity/restoration plans and the provenance ops ledger, persisted under .flauz/ with the sibling-envelope discipline.

### Whole-session acceptance battery (TL4-004, merged)

Four scripted user journeys drive the real Flauz surfaces end to end (task state machine, evidence ledger, workflow envelope save/re-run, browser session manager with policy + journal, environment lifecycle): golden session, recovery re-run with derived evidence, fail-closed denial paths, and continuity after full restart. Pinned transcript fixtures make every observable outcome machine-checked on each Flauz-relevant change; the runtime rung (real CDP, real executor) is the documented promotion.

### Integrated security and release gates (TL4-006, merged)

One machine-checked verdict for the release-blocking security surface: credential-pattern scan over the Flauz namespace with a documented allowlist, supply-chain dependency purity, the proposed-API permissions rota, and reproducible packaging (double-bundle byte-identical dist hashes). Dynamic rows (DL-20 ledger integrity, browser deny-by-default) run in their own CI lanes and are named in the coverage matrix.

### Workflow

The current workflow extension provides a workflow envelope and the integrated M1 safety rail.

Later workflow capabilities must be re-established from current code and tests before being called complete.

## Known gaps

1. Real provider adapters and real model execution.
2. Durable multi-agent orchestration.
3. Durable context and memory.
4. Reusable workflow execution beyond the current envelope.
5. Fully integrated Flauz-controlled browser runtime.
6. Real environment lifecycle execution.
7. Resource graph, leases/conflicts, takeover and collaboration semantics.
8. Coherent premium product UX.
9. Whole-product end-to-end acceptance on a real build.
10. Repeatable upstream synchronization and production packaging/release.
11. Linux, Windows, web and desktop verification without regressing Code OSS features.
12. Proposed-API dependencies and their upgrade/retirement plan.

Previous TL2 lab reports are evidence of work performed, not a substitute for current integrated verification.
The code on main plus these program documents is now the authoritative starting point.
