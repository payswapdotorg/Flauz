# Flauz Parallel Execution Plan

## Rule

Use a TL only when that TL can begin substantive work immediately and continue independently using contracts, fixtures or existing platform APIs.

At this program reset, four TLs are justified simultaneously.

## Why all four can work now

### TL1

Can work immediately against current Code OSS source:
- upstream synchronization;
- product metadata/build;
- IPC/service seam;
- fork-critical audit;
- desktop/web packaging.

### TL2

Can work immediately against current Flauz agent/workspace code:
- orchestration;
- real provider adapters;
- memory/context;
- workflows;
- approvals and leases.

Where service contracts are not final, TL2 defines fixtures and protocol contracts.

### TL3

Can work immediately against current browser/environment seams:
- browser runtime prototype;
- browser security;
- environment lifecycle/provider adapters;
- resource graph.

It does not need TL2 to begin; it can operate on stable descriptors and fake agent callers.

### TL4

Can work immediately against the current Code OSS UI plus fixture-backed Flauz surfaces:
- product information architecture;
- premium UX;
- compatibility harness;
- whole-session test harness;
- accessibility/performance/release gates.

TL4 never needs to wait for the actual runtime to build its harness.

## TL boundaries

| TL | Owns | Must not own |
|---|---|---|
| TL1 | Code OSS substrate, upstream sync, product build, client-service integration seam | Agent semantics, browser provider internals, final UX judgement |
| TL2 | Agent OS, models, orchestration, memory, approvals, workflows | Browser engine, environment provider implementation, visual design |
| TL3 | Browser runtime/security, environment lifecycle/providers, resource continuity | Agent planner semantics, upstream merge policy, product visual system |
| TL4 | UX, E2E verification, compatibility, performance, accessibility, release quality | Core orchestration semantics or provider implementation |

## Contract surfaces

Cross-TL changes flow through:
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

## Dependency strategy

Use fan-out then converge:

current main
  -> TL1 substrate/build
  -> TL2 agent OS
  -> TL3 browser/environment
  -> TL4 UX/verification
  -> integrated product

No TL is serialized behind another at the start.

## Merge policy

There is no permanent TL merge order.

Merge the PR that:
- is contract-complete;
- is independently testable;
- has no unresolved architecture violation;
- passes current integration gates.

When two branches touch the same files, prefer:
1. narrow extension-owned directories;
2. additive changes;
3. contract extraction;
4. small conflict-resolution PRs.

TL1 arbitrates only conflicts involving Code OSS substrate/upstream compatibility.

## Healthy parallelism

At any point there should be:
- at least one active work item per active TL;
- no TL with a lane that is purely waiting for another TL;
- fixtures for unavailable upstream dependencies;
- CI exercising cross-TL contracts;
- current state updated as part of each merge wave.


## External interoperability rule

External agent UI frameworks are downstream clients, not alternate Flauz runtimes.

- TL1 must establish the versioned native Flauz service protocol before any AG-UI adapter is implemented.
- AG-UI may later be exposed as an additive adapter/projection; CopilotKit remains optional client technology.
- OpenMuse is a reference/interoperability target only and must not become a runtime dependency or architectural fork.
- No TL is blocked by this decision, and no current TL work should be rebased or reprioritized solely because of it.
