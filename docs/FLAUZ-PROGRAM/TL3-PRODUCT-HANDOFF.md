# TL3 Active Product-Phase Handoff

## Mission

Remain the owner of browser, environment, resource and continuity semantics while the full-product acceptance phase exercises them as one product.

## Current status

The TL3 foundation and hardening are complete:

- TL3-001..006: DONE
- TL3-H1 provider resolver rung 2: DONE
- TL3-H2 browser product residuals: DONE

There is no open TL3 implementation item at phase creation.

## Operating mode: READY-TO-CLAIM

Wait for a routed `P2-FIX-###` finding or an architecture-approved addition. Do not create duplicate platform implementations from an acceptance observation.

## Worker partition

- **Worker A — Browser:** browser runtime, policy, session isolation, CDP, browser evidence.
- **Worker B — Environments:** lifecycle, SSH/Docker/cloud/E2B-style providers, resolver/access surfaces.
- **Worker C — Resources/continuity:** ResourceRef graph, provenance, continuity/restoration and cross-resource bridges.

One worker claims each finding. Findings spanning multiple TL3 subdomains are assigned by the TL3 lead before implementation.

## Ownership boundary

TL3 owns:

- `extensions/flauz-browser`
- `extensions/flauz-environments`
- `extensions/flauz-resources`
- browser/environment/resource semantic contracts and their tests/canaries

TL3 must not patch:

- Agent OS semantics owned by TL2;
- product UX/IA acceptance owned by TL4;
- control-plane files owned by TL1.

Browser policy remains fail-closed. Environment trust remains explicit. Resource identity remains distinct from access surface. Continuity must preserve provenance and redact secret-shaped payloads.

## Collaboration with TL4

TL4 may report a browser/environment/resource problem as a finding. TL3 supplies the semantic/runtime fix and evidence. TL4 independently re-runs the affected acceptance journey.

## Definition of done

A P2-FIX item is DONE only when:

- implementation lands on `main`;
- the relevant targeted tests are green;
- runtime evidence matches the required evidence level;
- no policy/trust/provenance law is weakened;
- TL4 can re-run the journey;
- the registry captures exact PR/commit and remaining risk.

## Start here

Read `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`, then this file and the current `WORK-REGISTRY.md`.
