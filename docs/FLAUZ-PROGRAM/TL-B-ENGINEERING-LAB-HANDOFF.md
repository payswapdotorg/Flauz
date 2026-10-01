# TL-B Handoff — Engineering Lab and Adaptive Optimization

Status: ACTIVE  
Program: Two-TL Product Completion and Engineering Lab

## Mission

Build the post-production Engineering Lab that continuously discovers better organizations, agent roles, model assignments, tools and capabilities for each user's workload.

The Lab is a learning/optimization layer, not a second execution authority.

## Start here

Read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file

Then inspect current `main`.

## Core product model

The Lab learns:

user workload
→ task type
→ simulated task world
→ Agent Body candidates
→ organization candidates
→ model/tool/capability assignments
→ robust simulation/evaluation
→ recommendation
→ real Flauz task
→ observed result
→ calibration
→ improved recommendation.

## Work order

### B1 — Contracts and workload model

Create versioned contracts for:

- WorkloadProfile;
- TaskTypeDescriptor;
- TaskScenario;
- LabScenario;
- LabRun;
- EvaluationReport;
- CalibrationRecord.

User activity must be governed:

- explicit opt-in for learning from activity;
- workspace/tenant scoping;
- raw activity separated from derived features;
- no secrets in the learning corpus;
- user-visible retention controls;
- export/delete support.

### B2 — Task-world generator

Construct deterministic and stochastic environments for the user's actual workload.

The first world should target software engineering because Flauz already has the necessary workspace, browser, environment and repository substrate.

The design must remain domain-general.

### B3 — Agent Body library

Define reusable model-independent bodies.

Example:

Senior Architect Body
- role;
- inputs/outputs;
- tools;
- permissions;
- memory;
- communication;
- evaluator;
- budget;
- safety constraints.

Then instantiate:

Body + Model + Capabilities.

Do not create a second model router.

### B4 — Organization search

Search:

- single agent;
- planner/worker;
- architect/implementer/reviewer;
- parallel implementers;
- specialist/delegator;
- custom graph topologies.

Optimize across:

- quality;
- success;
- latency;
- cost;
- robustness;
- human intervention;
- security/policy constraints.

### B5 — Model occupancy

Prove that the same Agent Body can be evaluated with different model occupants.

The Lab must answer:

- which model is best for this body?
- which model assignment is best for this organization?
- where is a cheaper/faster model sufficient?
- where does a stronger model materially improve results?

Model identities remain under Model Fabric authority.

### B6 — Capability search

Represent tools and capabilities as explicit contracts.

The Lab may discover:

"This organization requires capability X."

Then:

unavailable
→ capability acquisition/provider path
→ verification
→ version
→ simulation.

The Lab must not silently grant permissions.

### B7 — Simulator and learning ladder

Implement replaceable optimization engines.

Start with deterministic evaluation and historical/local replay before requiring online RL.

Support:

- bandits;
- offline evaluation;
- evolutionary search;
- tree search;
- model-based planning;
- RL.

Never make the algorithm the architecture.

### B8 — Robust evaluation

Every candidate records:

- outcome;
- uncertainty;
- model ensemble agreement;
- seed robustness;
- OOD distance;
- cost;
- latency;
- safety/policy compliance;
- reproducibility.

Always compare against a single-agent baseline.

### B9 — Lab console

Expose:

- Run Lab Now;
- this task;
- this task type;
- my workload;
- custom scenario;
- candidate organizations;
- model assignments;
- capability requirements;
- evidence;
- confidence;
- cost/latency/quality trade-offs;
- apply/save/compare actions.

Recommendations are reversible and auditable.

### B10 — Real-task bridge

Introduce a narrow adapter:

LabRecommendation
→ AgentTask / Workflow / session request.

The Lab cannot directly execute side effects.

### B11 — Calibration and closed-loop proof

At least one full scenario must demonstrate:

1. workload observation;
2. task-type discovery;
3. world generation;
4. organization search;
5. model occupancy search;
6. robust simulation;
7. real Flauz execution;
8. outcome measurement;
9. calibration;
10. improved second run.

## Worker boundaries

B1 owns contracts/workload/world-model code.

B2 owns Agent Bodies, organization search, model occupancy and capability evaluation.

B3 owns Lab UI, run control, calibration, evidence and the real-task bridge.

Workers use local fixtures and deterministic simulators instead of waiting for TL-A.

## No dependency on TL-A

TL-B must be able to complete every simulation/search/UI milestone without TL-A changing production code.

For the real-task bridge, use a typed `LabExecutionPort) with a deterministic fake until the production adapter is available.

The Lab never bypasses Agent OS, approvals, leases, environment trust or browser policy.

