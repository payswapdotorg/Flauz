# Flauz Parallel Execution Plan

## Current mode — post-completion hardening

The original four-TL parallel build program is complete at its registered work-order rungs. The current engineering mode is independent hardening and promotion against the canonical `main` tree.

Verified integrated head: `8ddeaae20004f87da5756ab79a07fab577e8827f`.

No TL is a permanent dependency of another. New work enters `WORK-REGISTRY.md` before implementation is treated as program state.

## Stable TL boundaries

| TL | Owns | Must not own |
|---|---|---|
| TL1 | Code OSS substrate, upstream sync, product build, native service seam | Agent semantics, browser provider internals, final UX judgement |
| TL2 | Agent OS, models, orchestration, memory, approvals, workflows, A2A | Browser engine, environment provider implementation, visual design |
| TL3 | Browser runtime/security, environment lifecycle/providers, resource continuity | Agent planner semantics, upstream merge policy, product visual system |
| TL4 | UX, E2E verification, compatibility, performance, accessibility, release quality | Core orchestration semantics or provider implementation |

## Cross-TL contract law

Cross-TL changes flow through stable contracts including:

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

Use additive extension-owned code first. Extract contracts rather than broad-refactoring shared files. A TL may request integration from another TL, but it must keep its own lane independently testable.

## Surge closure

The TL2 surge is closed.

- TL2-S1 (TL1 service integration) — DONE; helper released to TL1.
- TL2-S2 (TL3 resource/execution integration) — DONE; helper released to TL3.
- TL2-S3 (TL4 Agent OS runtime verification) — DONE; helper released to TL4.
- TL2 remains the sole semantic owner of Agent OS.
- No surge work creates new ownership in TL1/TL3/TL4.

## External interoperability

External agent UI frameworks are downstream clients, not alternate Flauz runtimes.

- Native Flauz service protocol remains the boundary.
- CopilotKit is optional client technology, not a runtime dependency.
- OpenMuse is a reference/interoperability target only.
- Any AG-UI support must be an additive projection after the native protocol and must not become a second control plane.

## Hardening execution pattern

For every new hardening item:

1. Start from the actual integrated `main`.
2. Read the registry item and owning TL handoff.
3. Write/confirm the contract and failure model before implementation.
4. Add fixture coverage for failure modes where runtime infrastructure is unavailable.
5. Promote the same contract to runtime coverage where possible.
6. Record exact PR/commit and CI evidence.
7. Update the registry and `CURRENT-STATE.md` in the same merge wave.

Do not convert fixture evidence into runtime claims, or SKIP into PASS by assumption.
