# Flauz Two-TL Program

Status: ACTIVE  
Effective date: 2026-10-01

## Why the program is now two TLs

The original four-TL construction program and P2 acceptance program did their job. The repository is now sufficiently integrated that continuing four independent TL ownership trees creates unnecessary coordination overhead.

The program therefore collapses into two vertical, full-stack lanes:

- **TL-A — Product Completion and Productionization**
- **TL-B — Engineering Lab and Adaptive Optimization**

Both TLs are expected to operate autonomously from `main), use stable contracts, and finish their assigned vertical without waiting for the other.

## Shared rules

1. `main) is the only product state.
2. Every work item is registered before implementation.
3. One owner per item.
4. One implementation PR per item unless a documented integration wave requires otherwise.
5. No cherry-picking worker branches between TLs.
6. Cross-TL dependencies use contracts, mocks or fixtures.
7. Shared implementation files are not edited concurrently.
8. Architecture changes require an architecture decision before implementation.
9. Core/fork-critical changes require explicit rationale and approval.
10. Every completion claim records tests, evidence, PR and SHA in the registry.
11. Production claims require production-real evidence.
12. No secrets in source, fixtures or policy files.

## TL-A ownership

TL-A is the owner of everything required to turn the current integrated product into a reliably deployable and operated product:

- remaining P2-FIX tail;
- browser/environment/resource acceptance residue;
- cross-extension acceptance/instrument fixes;
- product UX gaps discovered during dogfood;
- packaging and release;
- operational tooling;
- install/update/migration;
- observability;
- backup/recovery;
- beta;
- production;
- post-production reliability loop.

TL-A may modify any existing Flauz product surface needed to finish these outcomes, provided it follows the architecture lock.

### TL-A workers

- **A1 Runtime completion:** remaining semantic/runtime/security findings and their tests.
- **A2 Product/release:** UX, accessibility, packaging, deployment, install/update, diagnostics and release gates.
- **A3 Dogfood/operations:** real-user workflows, reliability, telemetry/privacy, backup/recovery, beta and production operations.

## TL-B ownership

TL-B owns the entire Engineering Lab vertical:

- workload profiling;
- task taxonomy;
- task-world generation;
- Lab simulation;
- Agent Body library;
- organization search;
- model occupancy search;
- tool/capability search;
- evaluation;
- calibration;
- Lab console;
- Lab-to-Flauz bridge;
- personalized optimization;
- closed-loop proof.

TL-B may consume all stable Flauz contracts but must not replace Agent OS, Model Fabric, Workspace OS or authorization authorities.

### TL-B workers

- **B1 Workload/world:** WorkloadProfile, TaskType, TaskScenario, simulation/world models, learning environment.
- **B2 Agent intelligence:** Agent Bodies, Organization search, model occupancy, tools/capabilities, benchmarks.
- **B3 Lab product/learning:** Lab console, run control, evidence, calibration, real-task bridge and closed-loop proof.

## Independence test

A work item is independently runnable when:

- its branch starts from current `main);
- all cross-TL dependencies are typed contracts;
- deterministic fixtures/mock adapters exist for any unavailable implementation;
- its tests do not import another TL's unfinished branch;
- the work can be reviewed and verified without chat context.

## Integration contract

The only planned cross-TL integration is:

TL-B Lab Recommendation
→ Flauz AgentTask/Workflow submission
→ TL-A production/runtime authorities
→ EvidenceRow / EvaluationResult
→ TL-B calibration input.

TL-A does not call Lab internals.

TL-B does not bypass Agent OS to execute a task.

## Final two-TL acceptance

Before the program is considered complete:

- TL-A proves the production product works independently.
- TL-B proves the Lab works independently.
- Both rerun the shared integration scenario from clean `main).
- The integration uses only published contracts.
- The Lab cannot grant permissions, credentials or bypass policy.
- A failed Lab is safe: it cannot corrupt real workspace state.

