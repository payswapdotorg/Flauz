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

### Platform-surface posture (TL1 review records)

**P2-FIX-112 — the vscode fs-port append strategy (2026-10-01, TL1 review).**
`vscode.workspace.fs` (`FileSystem`, the vendored `vscode.d.ts`) exposes
exactly: `stat`, `readDirectory`, `createDirectory`, `readFile`, `writeFile`,
`delete`, `rename`, `copy` — **no append primitive**. The sanctioned append
strategy for every vscode fs-port surface is therefore **read + tmp + atomic
rename** (byte-preserving, non-tearing — the posture landed by TL3 partition C,
PR #74 / TL3C-12, pinned by its regression). The cost model: one
read-modify-write amplification per append. This is the port's recorded cost,
not a defect; a platform-level append API would be a vscode API change outside
Flauz's reach without forking core (the zero-fork-critical law), and none is
made. Extensions that need high-frequency appends should batch or journal
through the durable seams (e.g. the transition-lock-serialized ledgers) rather
than amplify per-row fs appends.

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


## 10. Engineering Lab

The Engineering Lab is an additive optimization layer above the existing Flauz authorities.

### 10.1 Purpose

The Lab learns how to organize work for a specific user and task type by searching over Agent Bodies, model occupancy, organization topology, tools, capabilities, budgets and execution strategies.

It may construct simulated task worlds and evaluate candidate organizations before recommending a configuration for a real Flauz task.

### 10.2 Stable contracts

The Lab introduces additive, versioned contracts:

- WorkloadProfile
- TaskTypeDescriptor
- TaskScenario
- LabScenario
- LabRun
- WorldModelVersion
- AgentBodyDescriptor
- OrganizationCandidate
- CapabilityRequirement
- EvaluationReport
- CalibrationRecord
- LabRecommendation
- ExperimentLink

A Lab contract must not redefine an existing Flauz authority.

### 10.3 Agent Body / model separation

An Agent Body is independent of its model occupant.

Agent Body + selected model + permitted capabilities = Agent Instance.

The Lab may compare the same body under different models and may search model assignment across an organization.

Model/provider authorization remains owned by Model Fabric. The Lab creates no second model router.

### 10.4 Organization search

An Agent Organization is a graph of bodies/instances and communication/delegation edges.

Search may vary role specialization, graph topology, number of agents, model assignment, tools, memory, budgets, ordering and termination.

A single-agent organization is always a mandatory baseline.

### 10.5 Simulation and learning

The Lab may use deterministic replay, stochastic simulation, contextual bandits, offline policy learning, RL, model-based search or other replaceable optimizers.

The evaluation contract is architectural; the optimizer is not.

Counterfactual outcomes must remain explicitly labeled as model output. Historical evidence remains immutable.

### 10.6 Workload learning and privacy

The Lab may learn from user intent and recent activity only under explicit product controls.

Implementation must provide workspace/tenant isolation, opt-in learning controls, separation of raw activity from derived features, secret exclusion, retention/export/delete controls and auditable provenance for recommendations.

### 10.7 Real-task boundary

A Lab recommendation becomes a real task only through normal Flauz authorities:

LabRecommendation -> AgentTask / Workflow / Session -> existing policy/approval/lease/resource controls -> real execution -> EvidenceRow / outcome -> calibration.

The Lab never directly performs an ungoverned side effect.

### 10.8 Safety

A simulated strategy that violates policy, rights, privacy, security or authorization is invalid regardless of reward.

### 10.9 Long-running work

Simulation/training jobs use durable worker infrastructure and resumable artifacts. The Lab must not depend on synchronous web requests for long-running computation.

### 10.10 External technology

CopilotKit, OpenMuse and Code OSS remain non-authoritative integration technologies. The Lab is a Flauz-owned contract layer and is independent of a particular simulation/RL library.


## 11. ZCode-derived Product Patterns and Capability Exchange

Selected external product patterns may be adopted as additive projections over existing Flauz authorities. They must not create a second task scheduler, workflow journal, permission broker, model router, resource registry or persistence authority.

Capability Packs are versioned descriptions of agent-facing artifacts (CLI, skill/instructions, MCP server, commands, configuration and provenance). External sources such as Printing Press/Printing Press Library, Composio, MCP/skills catalogues and user-supplied API/site definitions are replaceable import sources only. Imported entries become Flauz-owned records with hashes, licenses, declared permissions/endpoints and verification status.

Hooks may enrich context or request existing approval behavior but may not bypass policy or leases. Persistent agent memory is subordinate to Workspace OS and tenant policy. Plan mode, run observability and replay are projections over the canonical Flauz journal. Compound commands and local mirrors are allowed only as bounded optimizations that preserve provenance and side-effect visibility.

Phase-C placement: `build/flauz/zcode-patterns/**`, `build/flauz/capabilities/**`, `extensions/flauz-capabilities/**`. No `src/vs/**` change without an explicit architecture decision.


## 12. Free Inference Fabric and Domain-Harness Law

### 12.1 Free-plan semantics

The product may promise **unlimited Flauz usage** on the Free plan. It must not promise literally unlimited third-party model tokens.

Provider capacity, quotas, model availability, rate limits and terms remain external constraints and must be disclosed.

### 12.2 Per-user capacity law

The preferred Free inference topology is:

`Flauz -> per-user inference fabric -> user-owned/direct provider accounts and permitted local/free providers`.

Flauz must not operate a shared public gateway that pools third-party free-tier API keys unless the relevant provider terms explicitly authorize the arrangement.

Credentials are per-user/per-tenant, secret-safe, and never placed in source, fixtures or shared server configuration.

### 12.3 FreeLLMAPI boundary

`tashfeenahmed/freellmapi` may be used as:
- reference architecture;
- optional per-user/local sidecar;
- adapter source;
- provider-routing pattern library.

It is not a Flauz execution authority, permission authority or required runtime dependency.

Before enabling any upstream/provider integration, verify its current license and provider-specific terms.

### 12.4 Inference routing law

Inference routing may select among permitted models/providers using:
- capability;
- context window;
- health;
- quota/cooldown;
- latency;
- reliability;
- user policy;
- cost/plan rules.

Routing must never:
- grant permissions;
- bypass approval;
- bypass model authorization;
- silently substitute a materially different model/provider.

The selected provider/model and fallback path must be provenance-bearing.

### 12.5 Domain-harness law

Industry specialization is a harness over the universal Flauz core, not a fork.

A domain harness may compose:
- ontology and terminology;
- user roles;
- Agent Bodies/organizations;
- workflows and task types;
- capability packs;
- model preferences;
- approvals/policies;
- evidence requirements;
- KPIs;
- benchmark/simulation worlds;
- UI/navigation projections.

A user may hold multiple roles/specializations.

The Engineering Lab may optimize a harness, but:
- Agent OS remains execution authority;
- Workspace OS remains workspace/state authority;
- Model Fabric remains provider/model authority;
- capability registry remains capability authority;
- approval/policy remains permission authority.

### 12.6 No-new-authority law

Free inference and domain-harness layers must not create a second:
- scheduler;
- workflow journal;
- permission broker;
- model router;
- resource registry;
- persistence authority.

