# TL2 Handoff — Agent OS

## Mission

Turn the current Flauz agent/workspace vertical slices into a durable multi-agent system while preserving Code OSS native agent, chat, model and tool capabilities.

## First reads

- SOURCE-OF-TRUTH.md
- ARCHITECTURE-LOCK.md
- CURRENT-STATE.md
- WORK-REGISTRY.md
- PARALLEL-EXECUTION.md
- extensions/flauz-agent/README.md
- extensions/flauz-models/README.md
- extensions/flauz-workspace/README.md
- extensions/flauz-workflow/README.md

## Three workers

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

## First sprint

Start TL2-001 through TL2-006 using protocol fixtures where integrations do not yet exist.

The current flauz-agent implementation is a v0 golden path. Do not mistake it for a finished orchestration runtime.

## Hard rules

- Never turn mock providers into fake production claims.
- Keep agent state durable and recoverable.
- Preserve human authorization boundaries.
- Do not couple the runtime to one model vendor.
- Never fabricate checkpoints or evidence.

## Done means

A task survives restart, provider failure, environment changes and human intervention without losing logical state or provenance.
