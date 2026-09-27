# Flauz Current State

Program reset: 2026-09-27
Integrated product branch: main
Integrated head at verification: 33e0af4ea9a (TL4 wave-1 merge: PRs #4/#5/#6 station-verified; hygiene allowlist fix 0304e375f63)

## Branch state

- main is the canonical Flauz product line at 33e0af4ea9a (TL4-001/003/005 merged) plus the hygiene-allowlist fix at 0304e375f63.
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

The browser extension now provides the layered policy engine, partition semantics, fail-closed behavior, CDP-bypass protection AND the TL3-001 runtime: CDP transport (+ test simulator), session manager with human/agent separation, policy-gated navigation (deny sends zero CDP commands), capture->evidence, recovery, and workbench/endpoint host adapters (proposed browser API grant active).

Remaining for the complete browser product: session-security hardening (TL3-002) and real-workbench E2E of the driver path.

### Environments

The current environment extension provides:
- typed descriptors;
- registry;
- continuity model;
- adapters/plans for local/SSH/container/cloud-style environments.

The TL3-003 lifecycle (create/start/stop/attach/detach/snapshot/destroy behind executors, local-real + remote-simulated) is in flight.

Do not call every adapter a production provider.

### Resources (TL3-005, merged)

extensions/flauz-resources provides the logical resource graph: ResourceRef identity, kind-specific access surfaces, typed edges, continuity/restoration plans and the provenance ops ledger, persisted under .flauz/ with the sibling-envelope discipline.

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
