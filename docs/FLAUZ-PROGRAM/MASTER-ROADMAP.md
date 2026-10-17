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


## Current frontier — 2026-10-15 reconciliation (TL-B)

Program state at `main` head `1430141c358f6460b437346bfc794076fc43b781`:

- Phase C-R: COMPLETE (CR-001..013; terminal ledger closed=5 / exercised-still-gap=3 / unexercised-still-gap=2).
- Free Inference Fabric: COMPLETE as an implementation workstream (INF-001..009); the INF-009 live-provider acceptance canary remains an env-gated clean-SKIP — no live-provider exchange is verified until a configured successful run is recorded.
- Domain Harness OS: waves 1-7 COMPLETE (DH-001..007; 938 family tests) — the composition layers, not industry content.
- TL-A production: the first production-real deployment is closed at v0.2.0; sustained production-operation closure remains open (TL-A-owned).

The remaining TL-B roadmap sequence: DH-008 policy/approval/evidence/KPI profiles · DH-009 domain benchmark/simulation worlds · DH-010 domain UI/navigation projections · DH-011 end-to-end onboarding and activation · DH-012 Lab-driven harness optimization · DH-013 cross-industry harness acceptance.

A domain harness remains composable configuration over the universal Flauz core, never an industry fork.

## Addendum — 2026-10-15 (later, TL-B): Wave 8 landed

DH-008 + DH-009 are DONE (PRs #199/#200; 1252 DH family tests at the merged head). The remaining TL-B sequence: DH-010 · DH-011 · DH-012 · DH-013.

## Addendum — 2026-10-15 (later, TL-B): Wave 9 landed

DH-010 + DH-011 are DONE (PRs #201/#202; 1561 DH family tests + 99 surface tests at the merged head). The remaining TL-B sequence: DH-012 · DH-013.

## Addendum — 2026-10-15 (later, TL-B): Wave 10 landed

DH-012 is DONE (PR #203; 1734 DH family tests at the merged head). The remaining TL-B sequence: DH-013 (the final row).

## Final state — 2026-10-15 (TL-B): the Domain Harness OS roadmap complete

DH-001..DH-013 are ALL LANDED (the final wave: DH-013, PR #204 — the four-industry cross-industry acceptance with the composition-not-fork census and the six-row honest gap ledger). Thirteen harness families, 1,868 passing family tests at the merged head `147a7dd5d30` (+ production/ops 137 + the workbench surfaces 99). The strategic direction stated in this roadmap — Flauz as the domain-specific work harness composed over the universal core — is implemented and acceptance-proven at the fixture/simulated rung, with the unproven registered, never promoted. The registered residue: the gap ledger's six rows; TL-A's sustained production-operation closure; the INF live-provider exchange.


## Addendum — 2026-10-16 (TL-B): GAP-1 closed (the lab industry task-worlds)

The gap ledger's row 1 ('lab task-worlds coverage — the SE fixture world only; finance/healthcare/construction lack industry-specific simulation worlds') is closed at the lab lane: branch `flauz-tlb/dh-gap1-lab-worlds` (PR placeholder #205 — the station fills the PR number at merge) ships the three industry fixture task-worlds — finance (`world-finance-fixtures`), healthcare (`world-healthcare-fixtures`), construction (`world-construction-fixtures`) — composed exactly like the SE world over the REAL LAB-003 engine (imported, never re-implemented; composition, not a fork), each with three curated domain-shaped scenarios, the SE-shaped information boundary, named input banks and `evidenceLevel: 'fixture'`. The industry extension registry is the wave's disclosed deviation: the landed `TASK_WORLDS` census stays SE-only (pinned by the landed batteries in two families), the three worlds register in `industryTaskWorlds.ts` and compose the combined catalog by import — zero catalog injection, one engine, referential identity pinned by tests. The lab family now carries the scoped tsc gate and a 331-test battery (210 landed + 121 new). The DH-009 benchmark binding of the new scenarios was honestly SKIPPED (the binding law resolves scenarioRefs against the landed registry; binding would re-open landed machinery — the reason is recorded in the registry wave record). Gap ledger rows 2-6 remain open; TL-A's sustained production-operation closure and the INF live-provider exchange remain the other registered residue.


## Addendum — 2026-10-16 (TL-B, later): GAP-2 closed (content representativeness + the row-1 propagation into the acceptance family)

The gap ledger's row 2 ('content representativeness — the four industry content sets are curated fixture-level acceptance content, not comprehensive domain truth') is closed, and row 1's closure is PROPAGATED into the acceptance family's own frozen ledger — the DH residue wave 2 on branch `flauz-tlb/dh-gap2-content` (PR placeholder #206 — the station fills the PR number at merge), over the pinned base `1382de10`, entirely inside the TL-B-owned acceptance family. Row 1's row now carries its CLOSED successor state (the three industry task-worlds landed at PR #205 in the lab extension registry; the SE world plus three industry worlds; the coverage row closed 2026-10-15 — the closure recorded IN the row, never by silent removal); row 2's row carries its own closure (the four industry content sets deepened to the declared censused representativeness bar — each industry at least six roles, ten terms, four tasks, four bodies, four packs and two profiles of real domain-shaped curated content; the census pinned by the battery; the content-census disclosure riding every report; the fixture-level bound stays disclosed — never a domain-truth claim, closed 2026-10-16). The wave's lawful contract changes, all disclosed in the worker's D-register: THE CLOSED-ROW LAW (the closed-key list; a closed row is refused as a fixture registration at every walk), THE COVERAGE LAW (the updated fail-closed truth — a covered-industry fixture MUST carry the curated benchmark), the two frozen BENCHMARK BINDING MODES (the base-registry binding and the wrapped industry-extension binding over the combined catalog — the REAL imported `getTaskScenario`/`getTaskWorld`/`generateTaskInstances` lookups; the DH-09 records still compose the registry-bound floor entries, the honest split disclosed), the doubled curated census, and the fifth frozen disclosure (the content census). The acceptance battery re-pinned and grown 134 → 161 (the scoped tsc gate EXIT 0; the lab battery 331 unchanged; the determinism greps law-comment-only). Gap ledger rows 3-6 remain open; TL-A's sustained production-operation closure and the INF live-provider exchange remain the other registered residue.


## Addendum — 2026-10-16 (TL-B, later still): GAP-3 closed (the live-provider execution row — the INF-009 canary's station-verified live-real run)

The gap ledger's row 3 ('no live-provider exchange is exercised') is closed — the DH residue wave 3 on branch `flauz-tlb/dh-gap3-live-provider` (PR #207), over the pinned base `7478237`, in the TL-B-owned acceptance lane with the INF lane's in-lane authority (the row's owner is "INF lane (the INF-009 canary)"). The truth this closure records: the INF-009 live-provider canary ran GREEN (exit 0) with the station env contract set — the station's endpoint contract over the platform's sanctioned inference gateway, a REAL chat-completion round-trip (~400ms latency; the raw secret stays station-side, the drill binds only the opaque handle) — the exchange recorded as a live-real DrillRecord (drillClass 'acceptance-exchange', verdict 'eligible', 8 landed byte citations), the canonical ledger line reading back byte-identical through the live kit, and the same line over a fixture-configured port refused as the typed 'no-live-port' rejection (live-real claimed ONLY when a live exchange actually happened, never promoted). The closed-row law extends to row 3 exactly as the rows-1-2 precedent: the row carries its CLOSED successor state with the closure recorded IN the row (never by silent removal), 'no-live-provider-execution' joins the frozen `ACCEPTANCE_CLOSED_GAP_KEYS` list, the landed refusal machinery (contract walk / row walk / runner gap registration / ledger replay) refuses row-3 registrations, and the four industry fixtures now register exactly the three open rows. The canary drill and the whole INF family are untouched (the INF README gains the one station-run receipt row). The acceptance battery re-pinned at 161 (66 contract + 95 runner; every re-pin disclosed); the scoped tsc gate EXIT 0; the INF battery 180 and the lab battery 331 unchanged; determinism greps law-comment-only. Gap ledger rows 4-6 remain open; TL-A's sustained production-operation closure remains the other registered residue (the INF live-provider exchange is now station-verified live-real — no longer unverified residue).


## Addendum — 2026-10-16 (TL-B, latest): GAP-5 closed (the workbench runtime binding row — the binding drill's station-verified bun-lane run)

The gap ledger's row 5 ('the flauz-harness extension's runtime binding is covered by the bundle+activation gates, not the node lane') is closed — the DH residue wave 4 on branch `flauz-tlb/dh-gap5-binding-drill` (PR #208), over the pinned base `25182f7`, in the TL-B-owned acceptance lane with the workbench surface family's own row (the row's owner is "TL-B (the workbench surface family)"). The truth this closure records: the binding drill (`extensions/flauz-harness/test/flauzHarnessPort.binding.drill.ts`, REAL-VERIFICATION code in the INF-009 canary drill's shape) ran GREEN (exit 0, 2026-10-16, run twice) under `bun` — the lane that resolves the Domain Harness OS kits' `.js` specifiers natively — driving the extension's runtime port (the only cross-lane runtime edge, previously exercised only by the esbuild bundle+activation gates) through the FULL op chain over the REAL kits with the FIXED injected seams: the port open over a fresh temp root, the REAL frozen vocabularies (membership pinned: 'software', 'medium', 'analysis', 'review'), the DH-02 session walk (industry → company → work-types → review, every stage transition observed), the DH-03 roles session composed at the same root through the REAL `loadRolesKit` (one role, emitted), the propose boundary minting the harness 'flauz:hrn:0000000000000007' through the inner REAL DH-01 kit (the pinned deterministic id; the determinism double-run byte-equal — the id seam is the only nondeterminism source and it is injected), listHarnesses carrying exactly the one minted harness at state 'proposed', and the REAL DH-010 navigation projection over the minted harness (the nine frozen sections; composed: overview, roles, lifecycle; the six content-less families honestly not-composed with zero rows), with the closed activation door pinned on the port surface (Object.keys(port) exactly the twelve ops + the id/mode data keys, no activation op — the DH-01 authority keeps the lifecycle). The `.drill.ts` suffix keeps the drill outside the node `--test` glob — the extension's node lane still never imports the binding (the letter of the flauz-lab law kept: Node type stripping cannot resolve those `.js` specifiers); the drill is the bun-lane execution evidence the row was missing. The closed-row law extends to row 5 exactly as the rows-1-3 precedent: the row carries its CLOSED successor state with the closure recorded IN the row (never by silent removal), 'workbench-surface-runtime-binding' joins the frozen `ACCEPTANCE_CLOSED_GAP_KEYS` list, the landed refusal machinery (contract walk / row walk / runner gap registration / ledger replay) refuses row-5 registrations, and the four industry fixtures now register exactly the two open rows. The extension files: the new drill, the README's run-commands + receipt-table + Architecture disclosure, the port header's comment-only amendment (the bun-lane drill disclosed), and one disclosed shim extension (`shims/node.d.ts` gains the drill's exact narrow node surfaces — the extension's own documented zero-dependency pattern; see the worker's D-register). The acceptance battery re-pinned at 161 (66 contract + 95 runner; every re-pin disclosed); the scoped tsc gate EXIT 0; the extension typecheck EXIT 0; the extension node lane 66/66 unchanged; the INF battery 180 and the lab battery 331 unchanged; determinism greps law-comment-only. Gap ledger rows 4 and 6 remain open (no longer contiguous: row 5 closed between them); TL-A's sustained production-operation closure remains the other registered residue.


## Addendum — 2026-10-17 (TL-A): A-PROD-006 the sustained production-operation closure — the program-terminal record

The A-PROD-006 sustained production-operation program is **COMPLETE** (the registry's W9 landing record carries the full inventory and the honest disclosures). The closed reliability loop is demonstrated with production-real evidence twice: v0.2.0 (the first production-real revolution, the LIVE deployment with the E2E boot receipt) and v0.2.1 (the second, driven by a REAL production-integration incident — INC-W8-PARITY-GAP — through the entire frozen lifecycle to closure, with the byte-comparison upgrade receipt). The release identities on record: v0.1.0 · v0.1.1 · v0.1.2 · v0.1.3 · v0.2.0 · v0.1.3→0.2.0→0.2.1. The completion graph is fully exercised — every row carries its evidence citation in the registry record; the closure row is banked on the LIVE Neon ledger with the repo-side local-real twin (`flauz:prd:fdc6f5f1782d2021`).

The remaining registered residue after the closure: the DH gap ledger's rows 4 + 6 (TL-B lanes; row 4 — no production-real harness deployment — TL-A-coordinated, with the production evidence staged at the LIVE 0.2.1 surface by W8/R40), plus the disclosed platform items (the macOS CI red root-cause; the host-swap OOM class). The roadmap's strategic direction stands: Flauz as the domain-specific work harness composed over the universal core — the sustained production surface now operates as the closed loop this roadmap's A-PROD-006 section defined.


## Addendum — 2026-10-17 (TL-A, R42): the macOS CI red root-cause closure — the platform-item terminal record

The long-standing macOS CI red — disclosed at every closure record since the TL1 era as "root-cause pending, never hidden" — is root-caused and closed (the registry's R42 station record is the operational source of truth). GitHub's own failure annotation at the v0.1.0 release tag, banked verbatim: the job was not started because the account's payments/spending-limit boundary refuses the paid larger-runner tier (`macos-26-xlarge`) at runner assignment; the `1ES.Pool` self-hosted labels queue-starve (no such runner connected to this org); `vscode-large-runners` is the dormant third class. Standard hosted macOS runners succeed on the same commits — the red was the provisioning/billing boundary, never a product defect. The 2026-10-08 mitigation stands (both Code OSS workflows manual-dispatch-only; the fork's CI = the green flauz-* ubuntu suite; 40/40 repo runs green since) with the unchanged re-enable condition (per-job re-enable if 1ES-class runners or larger-runner billing is ever provisioned). The remaining disclosed platform items reduce to the host-swap OOM class alone; the registered residue (TL-B's rows 4 + 6) and the sustained surface watch are unchanged. The roadmap's strategic direction stands.
