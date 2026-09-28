# TL3 Handoff — Browser and Environment OS

## Mission

Make browser and execution environments first-class Flauz resources without forking Electron or duplicating Code OSS remote infrastructure unnecessarily.

## First reads

- SOURCE-OF-TRUTH.md
- ARCHITECTURE-LOCK.md
- CURRENT-STATE.md
- WORK-REGISTRY.md
- PARALLEL-EXECUTION.md
- extensions/flauz-browser/README.md
- extensions/flauz-environments/README.md
- the INTEGRATION-GAP files in both extensions

## Three workers

### Worker A — Browser runtime
Own:
- Chromium/CDP control;
- tabs/navigation;
- screenshots;
- console/network capture;
- user versus agent session separation;
- first-class browser UI;
- recovery.

The existing browser policy engine is security infrastructure, not the complete browser product.

### Worker B — Environment runtime
Own:
- create/start/stop/attach/detach/snapshot/destroy;
- local/SSH/container/cloud/E2B-style providers;
- capability/trust declarations;
- provider health and recovery.

### Worker C — Resource/continuity layer
Own:
- ResourceRef/access-surface model;
- environment/browser/resource continuity;
- cross-environment restoration;
- identity/provenance of resource mutations.

## First sprint

Start TL3-001 through TL3-006 immediately using mock drivers/adapters where real providers are unavailable.

## Hard rules

- Browser policy remains fail-closed.
- Do not bypass trust boundaries to make demos easier.
- Do not embed credentials in browser/environment descriptors.
- Do not reimplement remote authorities that Code OSS already provides.
- Keep resource identity distinct from access surface.

## Done means

An agent and a human can use a browser and an execution environment as first-class task resources, with policy, provenance, recovery and continuity.

## Temporary TL2 secondment — Worker C

TL3 remains the owner of Browser/Environment OS and its completed contracts. Until the Agent OS surge exits, one TL3 worker is temporarily seconded to TL2 as **TL2-S2 — Resource/Execution Integration**.

Scope:
- connect Agent OS execution plans to BrowserSessionDescriptor/Manager, EnvironmentExecutor/provider ports, ResourceRef and Continuity;
- define resource acquisition/release semantics and hand-off metadata without changing TL3 ownership;
- provide fixtures/adapters for browser/environment/resource execution when TL2 needs them;
- preserve trust, provenance, fail-closed and continuity guarantees.

Boundaries:
- do not redesign Browser/Environment OS;
- do not bypass TL3 policy/trust gates;
- prefer additive TL2-side integration adapters;
- changes to TL3-owned runtime contracts require TL3 approval and an explicit compatibility note;
- coordinate before touching TL2 Worker A files.

Acceptance:
- a durable Agent OS task can reference and operate a browser/environment/resource through the existing contracts;
- teardown/recovery semantics are explicit;
- continuity metadata survives hand-off;
- no resource or trust invariant regresses.

When TL2-S2 completes its bounded work-order, Worker C returns to TL3 residuals/maintenance.
