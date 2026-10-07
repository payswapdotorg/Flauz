# Flauz Master Roadmap — Product Completion, Production and Engineering Lab

Status: ACTIVE  
Effective phase: Two-TL Product Completion and Engineering Lab  
Effective date: 2026-10-01  
Canonical product branch: `main`

## Purpose

This file is the canonical program roadmap after the completed four-TL foundation and P2 product-acceptance phase.

The program now has exactly two active technical leads:

- **TL-A — Product Completion and Productionization**
- **TL-B — Engineering Lab and Adaptive Optimization**

The two TLs are intentionally independent. Neither may block useful work waiting for the other.

Historical P2 acceptance documents remain evidence. They no longer decide current ownership or next actions.

## Source-of-truth rule

Use this order:

1. integrated code/configuration on `main`;
2. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`;
3. this file;
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`;
5. `docs/FLAUZ-PROGRAM/CURRENT-STATE.md`;
6. the active TL handoff;
7. historical phase documents and reports.

Chat history, worker messages and stale branch state are not product state.

## Completed baseline

The following are complete and preserved as historical evidence:

- TL1/TL2/TL3/TL4 foundation portfolios;
- registered hardening;
- live-provider verification;
- P2-001 control-plane reconciliation;
- P2-002 full product acceptance;
- P2-003 user discovery audit;
- the original acceptance findings closed through the verified landing waves;
- P2-FIX-108 packaged-assets contract;
- P2-FIX-112 platform-surface review.

The remaining inherited P2-FIX tail is absorbed by TL-A unless a new architecture decision explicitly changes ownership.

## Phase A — Product Completion and Productionization

Owner: TL-A

### A-PROD-001 — Finish inherited acceptance tail

Complete and independently verify every still-open or deliberately deferred P2-FIX item.

Current inherited items include:

- P2-FIX-102 — dedicated battery/session tsconfig landing gate;
- P2-FIX-106 — browser popup-gate placement redesign;
- P2-FIX-107 — browser record-time URL redaction;
- P2-FIX-109 — executor cancellation port/reconciliation;
- P2-FIX-110 — remotePidAlive unverifiable outcome;
- P2-FIX-111 — restoration-family vocabulary alignment;
- P2-FIX-113 — signed/keyed hash-chain decision or explicit deferral.

A finding is complete only when its code, tests, evidence and registry state agree on `main`.

### A-PROD-002 — Final independent product verification

Re-run the full integrated journey after the inherited tail closes.

Required evidence:

- runtime-real end-to-end journey;
- browser/environment/resource recovery;
- live-provider path where credentials are intentionally provisioned;
- compatibility;
- security;
- performance;
- restart/recovery;
- provenance;
- packaging/release.

No simulated result may be promoted to production evidence.

### A-PROD-003 — Dogfooding

Use Flauz itself for real development work.

Dogfood must exercise:

- repository exploration;
- implementation;
- tests;
- browser work;
- environments;
- multi-agent delegation;
- approvals/takeover;
- provider switching;
- failure/recovery;
- artifacts/evidence;
- workspace continuity.

Capture actual friction and turn real defects into registry items.

### A-PROD-004 — Beta readiness

Build the operational layer required for controlled external use:

- install/update reliability;
- workspace migration/upgrade safety;
- durable-state backup/export;
- crash recovery;
- diagnostics;
- telemetry with explicit privacy controls;
- provider/environment failure handling;
- rollback;
- support/debug bundle;
- release checklist.

### A-PROD-005 — Production readiness

Prove:

- reproducible release artifacts;
- signing and integrity checks;
- security posture;
- data isolation;
- secret handling;
- long-running worker durability;
- observability;
- backup/recovery;
- failure/rollback;
- upgrade compatibility;
- documented supported/unsupported capabilities.

### A-PROD-006 — Production launch and post-production operations

After launch, operate a closed reliability loop:

production usage
→ evidence/telemetry
→ incident/problem registry
→ fix
→ regression test
→ release
→ post-release verification.

Production changes must preserve the same source-of-truth and ownership laws.

## Phase B — Engineering Lab

Owner: TL-B

The Engineering Lab is a post-acceptance product layer, but its implementation may proceed in parallel with Phase A because it uses stable Flauz contracts and explicit adapters.

### LAB-001 — Lab contracts and run model

Introduce versioned contracts for:

- WorkloadProfile;
- TaskTypeDescriptor;
- TaskScenario;
- LabScenario;
- LabRun;
- WorldModelVersion;
- AgentBodyDescriptor;
- OrganizationCandidate;
- CapabilityRequirement;
- EvaluationReport;
- CalibrationRecord;
- LabRecommendation;
- ExperimentLink.

Lab state is workspace/tenant scoped.

### LAB-002 — Workload and task-type learning

Build workload profiling from user intent and recent activity, with explicit user controls.

Derived signals may include:

- task families;
- duration;
- complexity;
- tools;
- browser/environment use;
- parallelism;
- human intervention;
- review requirements;
- quality/cost/latency sensitivity.

Raw activity, derived features and retained learning state must be separately governed.

### LAB-003 — Task-world builder

Generate task-specific simulated environments.

Examples:

- web/software engineering;
- research;
- civil/engineering workflows;
- finance;
- healthcare;
- browser/computer-use;
- Blender/3D;
- video editing;
- spreadsheet/data work;
- future domains.

Each world records its inputs, seed, version, information boundary and evidence provenance.

### LAB-004 — Agent Body library

Agent Bodies are model-independent executable structures defining:

- role;
- input/output contract;
- tools;
- permissions;
- memory;
- communication;
- capabilities;
- budget;
- latency;
- evaluation hooks;
- policy constraints.

`Agent Body + selected model + permitted capabilities = Agent Instance`.

The Lab must not create a second model router.

### LAB-005 — Organization search

Search organization graphs across:

- number of agents;
- roles;
- topology;
- delegation;
- shared/private memory;
- critic/reviewer roles;
- model assignment;
- tool allocation;
- budgets;
- ordering;
- termination conditions.

Always include a single-agent baseline.

### LAB-006 — Model/tool/capability search

The Lab can compare:

- the same body with different models;
- different bodies with the same model;
- different model assignments within one organization;
- tool allocations;
- capability sets.

A missing capability becomes an explicit CapabilityRequirement rather than an improvised agent behavior.

### LAB-007 — Simulation and learning ladder

Use replaceable optimization engines:

1. historical/observed response models;
2. contextual bandits/off-policy evaluation;
3. offline policy learning;
4. simulator-based RL;
5. model-based/counterfactual search;
6. bounded real-task validation.

The evaluation contract is stable even when the optimizer changes.

### LAB-008 — Calibration and user feedback loop

Compare:

simulated prediction
→ real task outcome
→ prediction error
→ calibrated world-model version.

Retain uncertainty, OOD status, robustness and regime information.

### LAB-009 — Lab product surface

Provide a user-facing Lab console that can:

- run the Lab now;
- select this task / task type / workload / custom scenario;
- inspect candidate organizations;
- inspect model occupancy;
- inspect capability requirements;
- compare cost/latency/quality/robustness;
- save a recommendation;
- apply a recommendation through normal Flauz execution;
- rerun the Lab.

Applying a recommendation is reversible and auditable.

### LAB-010 — Real-task bridge

The Lab may recommend a configuration for a real Flauz task.

It must execute through existing:

- Agent OS;
- Model Fabric;
- Workspace OS;
- Browser;
- Environment;
- Resource;
- Evidence;
- approval/security boundaries.

The Lab never becomes a second execution engine.

### LAB-011 — Closed-loop proof and personalized Flauz

Demonstrate:

user workload
→ task-type model
→ simulated world
→ organization/model/capability search
→ recommendation
→ real Flauz task
→ measured result
→ calibration
→ improved recommendation.

The first proof may focus on software engineering, but the architecture must remain domain-general.

## Independence law

TL-A may complete Phase A without LAB implementation.

TL-B may complete the Lab simulation/search/control plane without waiting for Phase A implementation by using stable interfaces and deterministic fixtures.

Cross-TL interaction occurs only through versioned contracts:

- AgentTaskState;
- AgentSessionDescriptor;
- ModelProviderDescriptor;
- ToolDescriptor;
- ResourceRef;
- EnvironmentDescriptor;
- BrowserSessionDescriptor;
- EvidenceRow;
- DecisionRecord;
- HumanApproval;
- OperationLease;
- WorkflowEnvelope;
- Lab-specific contracts defined in LAB-001.

No worker branch is imported into another TL branch.

## Completion gates

### Gate A — Product completion

A-PROD-001 through A-PROD-006 complete with production evidence.

### Gate B — Engineering Lab

LAB-001 through LAB-011 complete with reproducible benchmark/evaluation evidence.

### Gate C — Closed-loop product proof

Both TLs independently verify their own lane and then jointly verify only the stable integration points.

The final product state is:

Flauz runtime
+ production operation
+ workload-aware Engineering Lab
+ adaptive Agent Body/Organization/Model optimization.

## Evidence law

Evidence labels:

`fixture | simulated | local-real | runtime-real | live-provider | production-real`

No lower evidence level is promoted by wording alone.

## No-chat bootstrap

A new TL can reconstruct the entire program by reading:

1. `FLAUZ-START-HERE.md`;
2. this file;
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`;
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`;
5. the applicable TL handoff;
6. the actual `main` tree.



## Phase C — Agent-Native Productivity and Capability Exchange

Owner: TL-B

Phase C is a post-LAB productization lane. It adopts selected ZCode product patterns without importing ZCode's runtime architecture. It is intentionally additive and independent of TL-A's productionization work.

### Independence and protected surfaces

TL-B may implement Phase C without modifying TL-A-owned productionization surfaces. Preferred homes are `build/flauz/zcode-patterns/**`, `build/flauz/capabilities/**`, `extensions/flauz-capabilities/**`, dedicated tests/fixtures and control-plane docs.

Phase-C workers must not edit `extensions/flauz-production/**`, `extensions/flauz-release/**`, `extensions/flauz-backup/**`, `extensions/flauz-migration/**`, `extensions/flauz-telemetry/**`, `extensions/flauz-diagnostics/**`, TL-A dogfood records/implementation, or generated release manifests/SBOM/bundle pins. Generated artifacts are regenerated by the integration station only.

### ZC-001 — ZCode pattern contracts

Freeze additive contracts for background-agent lifecycle, hook events, plan continuity, run observability/health, persistent agent memory and replay/resume projections. These are projections over existing authorities, not new authorities.

### ZC-002 — Background-agent user experience

Expose launch, inspect, message, pause/stop/cancel, resume, completion/failure/lost and artifact handoff using existing AgentTaskState, AgentSessionDescriptor, evidence and lease semantics.

### ZC-003 — Hook Bus

Add typed session/prompt/tool/approval/post-tool/finalization hooks. Hooks may enrich context or request existing approval/deny behavior; they cannot grant permissions or bypass policy.

### ZC-004 — Plan + Run Observatory + Replay

Add explicit plan mode, approved-plan continuity, workflow/subagent phases, health/stall/concurrency visibility and deterministic cold replay after restart. The existing journal/event source remains canonical.

### ZC-005 — Scoped persistent agent memory

Expose user/project/workspace-local memory with explicit enablement, retention/export/delete, provenance and secret exclusion. Memory remains subordinate to Workspace OS and tenant policy.

### ZC-006 — Capability Pack contract and catalog

Create a Flauz-owned package format covering CLI, skill/instructions, MCP server, commands, required capabilities, permissions, configuration, provenance, version, license, hash, platform compatibility and verification status.

### ZC-007 — External capability-source adapters

Add replaceable adapters for Printing Press/Printing Press Library, Composio, MCP/skill catalogs and direct user/API/site/community-project specifications. External sources provide discoverable artifacts; Flauz remains the verification and execution authority.

### ZC-008 — Agent-native command facade

Where capabilities require many round trips, support bounded typed compound commands and optional safe local mirrors/caches. Side effects remain visible, provenance-bearing and routed through existing Tool/Resource/Approval authorities.

### ZC-009 — CLI / headless parity

Expose workspace, background-agent, workflow, approval, evidence, replay, Lab and capability-discovery journeys through a first-class CLI/headless client of the existing Flauz service.

### ZC-010 — ZCode parity and quality gate

Run documented comparisons for coding, exploration, background delegation, plan/execute, browser/computer use, memory, hooks, workflow monitoring, replay/recovery and capability discovery. Phase C is complete only when targeted tests, evidence labels, discovery/a11y checks and existing gates remain green.


## Current frontier — Phase C-R runtime activation + domain-harness direction

The original Phase C contract layer ZC-001..ZC-010 is complete. Phase C-R runtime activation is the active TL-B runtime lane.

Completed/landed on current main:
- CR-001 runtime activation spine;
- CR-006 capability-exchange registry runtime;
- CR-010/CR-011 CLI/headless and journey-battery shell;
- CR-002 background-agent runtime;
- CR-007 external capability-source adapter kit;
- CR-010b CLI capability/approval runtime;
- CR-001 activation-map repair and 36/36 verification;
- current-main advancement through the CR-008 verification + permission gate landing.

Inspect the registry on each fresh start before claiming remaining CR items.

### Strategic product direction — Domain Harness OS

Flauz must be able to transform into the domain-specific work harness selected by a user during onboarding.

The model is:
`industry selection -> harness instantiation -> domain ontology/roles/workflows/capabilities/policy/evidence/UI -> real execution -> observation -> Engineering Lab optimization -> increasingly specialized harness`.

A harness is composable configuration over the universal Flauz core, not an industry-specific fork.

### Strategic product direction — Free Inference Fabric

The Free plan promise is **unlimited Flauz usage**, not literally unlimited third-party model tokens.

TL-B owns the inference-fabric architecture and adapters. TL-A owns production/security/release validation.

Use the tactics demonstrated by `tashfeenahmed/freellmapi` as a reference/optional integration path:
- provider catalog;
- health scoring;
- quota/cooldown tracking;
- retry/backoff;
- failover;
- capability/context-window matching;
- provenance;
- transparent capacity/reset state.

Preferred topology:
`Flauz -> per-user inference fabric -> user-owned/direct provider accounts and permitted local/free providers`.

Do not create a public Flauz gateway that pools other people's free-tier provider API keys. Verify each upstream license and each provider's current terms before enabling a source.

FreeLLMAPI is replaceable infrastructure, not a Flauz authority. Model/provider authorization remains owned by Model Fabric; policy/approval remains authoritative; inference routing must not grant permissions.
