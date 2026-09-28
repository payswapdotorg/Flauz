# TL2 Handoff — Agent OS

## Mission

Turn the current Flauz agent/workspace vertical slices into a durable multi-agent system while preserving Code OSS native agent, chat, model and tool capabilities.

TL2 is the **sole architectural owner** of Agent OS. A temporary three-worker cross-TL surge team is attached to TL2 to increase throughput without transferring ownership to TL1, TL3 or TL4.

## First reads

- SOURCE-OF-TRUTH.md
- ARCHITECTURE-LOCK.md
- CURRENT-STATE.md
- WORK-REGISTRY.md
- PARALLEL-EXECUTION.md
- TL2-AGENT-OS-SURGE.md
- extensions/flauz-agent/README.md
- extensions/flauz-models/README.md
- extensions/flauz-workspace/README.md
- extensions/flauz-workflow/README.md

## Core TL2 workers

### Worker A — Runtime/orchestration
Own:
- durable task graph;
- retry/cancel/recovery;
- multi-agent execution;
- human approval/takeover;
- leases/conflicts.

### Worker B — Models/providers/tools
Own:
- real provider adapters;
- local model adapters;
- provider capability discovery;
- routing policy;
- MCP/tool integration;
- model-aware context budgets.

### Worker C — State/memory/workflows/evidence
Own:
- durable memory;
- context compilation/retrieval;
- workflow execution;
- checkpoint/watermark/signature evolution;
- claims/evidence/decision records;
- A2A semantics.

## Temporary cross-TL surge workers

### TL2-S1 — TL1 secondment: service integration
Use the completed TL1-003 seam as the authoritative transport/control boundary for Agent OS.

### TL2-S2 — TL3 secondment: resource/execution integration
Connect the durable Agent OS graph to the already-landed BrowserSession, EnvironmentExecutor/provider, ResourceRef and Continuity contracts.

### TL2-S3 — TL4 secondment: Agent OS runtime verification
Build and maintain the Agent OS runtime acceptance/fault-injection battery independently from the implementation workers.

These secondments are bounded work-orders, not permanent changes to TL ownership. TL2 accepts the work, resolves semantic conflicts, and owns the merge decision.

## Surge execution order

Run the following in parallel where contracts permit:

1. **TL2-001 / Worker A:** durable orchestration state machine, recovery, cancellation and multi-agent graph.
2. **TL2-002 / Worker B:** provider registry, capability discovery, routing and real-provider execution.
3. **TL2-003/005/006 / Worker C:** memory/context, executable workflows and collaborative A2A semantics.
4. **TL2-S1 / TL1:** service boundary integration and conformance.
5. **TL2-S2 / TL3:** resource/browser/environment execution adapters and continuity hand-off.
6. **TL2-S3 / TL4:** runtime acceptance, restart/failure/provider/approval/lease test battery.

Where an implementation dependency is absent, define the contract and fixture rather than waiting.

## Integration architecture

```
Native Flauz Service
        │
        ▼
 Durable Agent OS
   ┌────┼────┐
   ▼    ▼    ▼
Tasks  Memory  Providers
   │     │       │
   ├─────┼───────┤
   ▼     ▼       ▼
Approval Workflow A2A
   │     │       │
   └─────┼───────┘
         ▼
 Resource / Execution Ports
    ┌────┼───────────┐
    ▼    ▼           ▼
 Browser Environment Resource
         │
         ▼
      Continuity
         │
         ▼
   Evidence / Decisions
         │
         ▼
   TL4 runtime battery
```

## Hard rules

- Never turn mock providers into fake production claims.
- Keep agent state durable and recoverable.
- Preserve human authorization boundaries.
- Do not couple the runtime to one model vendor.
- Never fabricate checkpoints or evidence.
- TL2 owns Agent OS semantics; borrowed workers must not create competing semantics.
- Reuse TL1/TL3 contracts instead of copying their implementations.
- TL4 tests behavior independently; it does not become the runtime owner.
- Do not add CopilotKit/OpenMuse runtime dependencies; any AG-UI adapter is downstream of the native service protocol.
- No `src/vs` changes are permitted for the surge unless the Architecture Lock explicitly changes.

## Done means

A task survives restart, provider failure, environment changes and human intervention without losing logical state or provenance, and the same execution model works across multiple agents/providers/resources.
