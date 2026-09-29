# TL2 Active Product-Phase Handoff

## Mission

Remain the semantic owner of Agent OS while absorbing only the Agent-domain findings that emerge from the full-product acceptance phase.

## Current status

The Agent OS foundation and hardening are complete:

- TL2-001..006: DONE
- TL2-S1/S2/S3: DONE
- AO-H1..H4: DONE
- TL2-H1 live-provider verification: DONE
- runtime census: 8 PASS / 0 FAIL / 0 SKIP

There is no open TL2 implementation item at phase creation.

## Operating mode: READY-TO-CLAIM

TL4 is the acceptance owner. Do not invent new Agent OS product work merely because the platform can be extended.

Wait for a routed `P2-FIX-###` finding or an architecture-approved addition.

## Worker partition

- **Worker A — Agent runtime:** orchestration, cancellation/retry/lease/recovery semantics.
- **Worker B — Model fabric:** provider routing, live-provider behavior, tool policy, model context.
- **Worker C — Collaboration/state:** memory, workflows, A2A, approval/takeover and execution integration.

Only one worker claims a finding. If a finding spans two TL2 subdomains, TL2 lead assigns the owner before implementation.

## Ownership boundary

TL2 owns:

- `extensions/flauz-agent`
- `extensions/flauz-models`
- `extensions/flauz-workflow`
- `extensions/flauz-execution`
- Agent OS semantic contracts and their tests/canaries
- model/provider evidence

TL2 must not patch:

- browser implementation/security internals owned by TL3;
- environment/resource implementation owned by TL3;
- product UX/IA acceptance owned by TL4;
- control-plane files owned by TL1.

When a finding crosses a boundary, create/route the finding instead of editing the neighboring TL's path.

## Collaboration with TL4

TL4 can reproduce and document a TL2 finding. TL2 implements the semantic fix and provides the acceptance evidence requested by the finding. TL4 retains the final acceptance verdict.

## Definition of done

A P2-FIX item is DONE only when:

- the semantic behavior is implemented on a branch based on current `main`;
- fixture/contract coverage exists where appropriate;
- runtime evidence is collected when the finding is runtime-dependent;
- provenance/security laws remain intact;
- TL4 can re-run the acceptance scenario;
- the finding and registry are updated in the same merge wave.

## Start here

Read `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`, then this file and the current `WORK-REGISTRY.md`.
