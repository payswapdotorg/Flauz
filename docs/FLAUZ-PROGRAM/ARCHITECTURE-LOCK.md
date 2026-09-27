# Flauz Architecture Lock

## 1. Product definition

Flauz is Code OSS evolved into an agent-centric development and work environment.

Code OSS remains the mature desktop/workbench substrate.

Flauz adds:
- multi-model and multi-agent execution;
- durable task/context/memory state;
- resource and environment management;
- reusable workflows;
- browser-assisted work;
- evidence and decision records;
- human approval/takeover;
- leases/conflict management;
- provider routing;
- collaboration.

The IDE is a pillar of Flauz, not the entire product.

## 2. Three pillars

### Pillar 1 — IDE

Retain and protect Code OSS capabilities:
- editor and language tooling;
- workspace/project model;
- terminal and shell integration;
- search/navigation;
- source control;
- debugging;
- tasks/launch;
- notebooks;
- extensions;
- settings/profiles;
- accessibility;
- command palette;
- remote/workspace facilities.

No Flauz feature may regress these capabilities.

### Pillar 2 — Agent OS

Code OSS agent primitives remain the native UI substrate where they fit.

Flauz owns:
- agent runtime abstraction;
- agent/task orchestration;
- multi-agent coordination;
- human approval and takeover;
- model/provider policy;
- durable memory;
- reusable workflows;
- claims/evidence;
- leases and conflict semantics.

Preferred placement:
- built-in Flauz extensions for vscode integration;
- a separate Flauz service/process for stateful orchestration and cross-surface state;
- provider adapters for external/local runtimes.

### Pillar 3 — Workspace OS

Flauz treats the workspace as more than files.

It adds a logical resource graph spanning:
- files;
- tasks;
- agent sessions;
- environments;
- browser sessions;
- artifacts;
- evidence;
- model/provider resources;
- collaboration state.

Code OSS workspace services remain the local UI/runtime foundation.

## 3. Cross-cutting dimensions

### Browser

Two-stage strategy:

1. Preview/browser v1: use existing Code OSS browser/webview/simple-browser mechanisms where useful.
2. Real browser v2: run Chromium/Playwright/CDP as a Flauz-controlled sidecar/service and expose it through a native Flauz browser surface.

The browser must support:
- human browsing;
- agent browsing;
- screenshots;
- network/console evidence;
- session isolation;
- policy enforcement;
- devtools-oriented diagnostics.

Do not deep-fork Electron merely to obtain a browser until a measured requirement proves extension/service surfaces are insufficient.

### Environments

Represent environments logically and bind them to access surfaces.

Supported classes should include, over time:
- local;
- SSH/remote;
- containers;
- VM;
- cloud sandbox;
- E2B and similar sandboxes;
- tunnel-backed environments.

The environment registry owns descriptors, capabilities, trust posture and continuity metadata.

### Persistence

Use two layers:
- workspace-local .flauz state for portable, reviewable artifacts;
- Flauz service persistence for durable cross-workspace/cross-agent/global state.

Do not force all long-lived state into VS Code Memento/storage.

### Evidence

Evidence is content-addressed where practical and never silently fabricated.

Claims must distinguish:
- claimed;
- observed;
- verified;
- contradicted;
- stale;
- unknown.

### Security

Fail closed for agent side effects.

Principles:
- least privilege;
- explicit human approval for consequential actions;
- browser policy enforced at authoritative control points;
- no provider secrets in source or workspace policy files;
- no token leakage to logs;
- environment trust is explicit;
- agent and human browser sessions remain distinguishable.

## 4. Extension/core placement law

Preferred order:
1. Existing stable Code OSS API.
2. Built-in Flauz extension.
3. Separate Flauz service.
4. Additive src/vs/workbench/contrib/flauz integration only when required.
5. Core/platform patch only with explicit architecture decision.

Target: zero FORK-CRITICAL changes unless a concrete product requirement cannot be implemented otherwise.

Every core patch must record:
- why extension/service APIs are insufficient;
- upstream alternative considered;
- maintenance/merge burden;
- rollback path.

## 5. Stable cross-TL contracts

Teams should converge on these contract families rather than sharing implementation internals:
- FlauzEventEnvelope
- AgentSessionDescriptor
- AgentTaskState
- ModelProviderDescriptor
- ToolDescriptor
- BrowserSessionDescriptor
- EnvironmentDescriptor
- ResourceRef
- EvidenceRow
- DecisionRecord
- HumanApproval
- OperationLease
- WorkflowEnvelope

Contract-first development is mandatory so every TL can begin immediately.

## 6. Upstream compatibility

Flauz should continuously absorb upstream Code OSS improvements.

Rules:
- isolate Flauz behavior in additive directories/files where possible;
- avoid modifying shared upstream code unless necessary;
- keep vendor assumptions out of the core workbench;
- keep the fork-critical guard machine-checkable;
- test the product against the current upstream baseline regularly.

## 7. Product quality law

The product must feel like one environment rather than a collection of extensions.

A user should move naturally between:
Editor, Terminal, Agent, Browser, Task, Environment and Evidence
without losing context, task state, permissions, provenance or next-step affordance.

## 8. Non-goals

Do not:
- rebuild the editor;
- replace the terminal;
- replace git, debugging or tasks unnecessarily;
- create another application shell beside Code OSS;
- create another Code OSS fork;
- turn mock providers into fake production claims;
- present browser policy as equivalent to a fully integrated browser;
- declare production readiness from unit tests alone.


## 9. External agent-UI interoperability boundary

Flauz owns the authoritative execution and state model. External agent UI/runtime frameworks are integration clients, not the Flauz control plane.

### Native-first rule

- The versioned Flauz service protocol is the authoritative boundary for commands, events, health, lifecycle, authorization and durable state.
- Feature extensions and external clients must not invent a competing task/session/approval/evidence state model.
- Policy, leases, provenance and evidence remain enforced by Flauz at the authoritative execution boundary.

### AG-UI / CopilotKit

AG-UI may be implemented later as an additive event/projection adapter at the Flauz service boundary.

- CopilotKit is optional client technology; it is not a Flauz runtime dependency.
- AG-UI is not a replacement for FlauzEventEnvelope or the native service protocol.
- An AG-UI adapter must preserve Flauz task/session/approval/evidence semantics and route consequential commands through the same Flauz authorization, lease and policy paths.
- Do not begin AG-UI implementation until TL1-003 has established the versioned native service protocol.
- Prefer extension/service land; no new src/vs core dependency is implied.

### OpenMuse

OpenMuse is a reference product/interoperability target for agentic browser/terminal/files UX, not a Flauz runtime dependency.

- Do not embed or fork the OpenMuse server/worker architecture into Flauz.
- Reuse validated interaction patterns only when they fit the Flauz architecture and Code OSS substrate.
- Any future OpenMuse interoperability must terminate at the same Flauz service boundary used by other external clients.

This decision is intentionally non-blocking for TL1-TL4 and does not create a new active work item.
