# Flauz Parallel Execution Plan — Two-TL Program

## Current mode

**Two-TL Product Completion and Engineering Lab**

### Active lanes

| Lane | Owner | Can run now? |
|---|---|---|
| Product completion / productionization | TL-A | YES |
| Engineering Lab / adaptive optimization | TL-B | YES |
| Cross-TL integration | joint, contract-first | Only at explicit integration gates |

## TL-A worker lanes

- A1 Runtime completion and inherited P2-FIX tail
- A2 Product/release and deployment
- A3 Dogfood, operations, beta and production

## TL-B worker lanes

- B1 Workload/task/world-model
- B2 Agent Body / organization / model / capability search
- B3 Lab product, calibration and real-task bridge

## Independence law

TL-A must remain runnable without TL-B.

TL-B must remain runnable without TL-A.

When the other side is incomplete:

- define the contract;
- provide a fixture/mock/fake adapter;
- continue;
- integrate only after the contract is stable.

## Shared-file law

- TL-A owns canonical program/control-plane files during the transition.
- TL-B owns Engineering Lab module code and Lab-specific specs.
- Neither TL edits the other's active handoff during implementation.
- Cross-TL changes are proposed as contract updates in the registry before implementation.

## Branch law

- all work branches from current `main`;
- all product PRs target `main`;
- no worker branch is product state;
- no cherry-picking another TL's worker branch;
- rebase/update from current `main` before final merge.

## Evidence law

Use:

`fixture | simulated | local-real | runtime-real | live-provider | production-real`.

A lower evidence level may never be described as a higher one.

## Completion

A work item is DONE only when implementation, tests, evidence, registry state and remaining-risk statement agree on `main`.