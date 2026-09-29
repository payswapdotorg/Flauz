# TL1 Active Product-Phase Handoff

## Mission

Keep the Flauz repository self-describing and conflict-free while the product moves from foundation completion into integrated acceptance.

## Active work

### P2-001 — Control-plane reconciliation
**Status: ACTIVE**

Make the repository's active handoff documents agree with the current integrated `main`, especially older completion-era text that still lists already-closed findings.

Deliverables:

- reconcile `CURRENT-STATE.md`;
- reconcile completion/hardening references in active control-plane docs;
- make the active phase and handoff map obvious from `AGENTS.md` and `FLAUZ-START-HERE.md`;
- keep `WORK-REGISTRY.md` authoritative for status;
- keep `PARALLEL-EXECUTION.md` aligned with the product-acceptance phase;
- preserve historical evidence rather than deleting it.

## Worker partition

- **Worker A — CURRENT STATE:** owns `CURRENT-STATE.md` reconciliation and current evidence summary.
- **Worker B — PROGRAM INDEX:** owns source-of-truth/work-registry/parallel-execution consistency checks and proposed control-plane text.
- **Worker C — AGENT BOOTSTRAP:** owns `AGENTS.md`, `FLAUZ-START-HERE.md` and handoff discoverability.

Workers must not edit the same control-plane file concurrently.

## Ownership boundary

TL1 owns:

- Code OSS substrate;
- upstream sync;
- product build/packaging;
- native service seam;
- fork-critical accounting;
- control-plane documents.

TL1 does **not** implement TL2/TL3 semantic findings or decide the final UX acceptance verdict.

## Parallel behavior

P2-001 can run while TL4 performs P2-002/P2-003.

When TL4 discovers a TL1-domain finding, it creates a P2-FIX finding and routes it to TL1. Do not silently fold it into the documentation reconciliation work item.

## Definition of done

- all active control-plane documents describe the same current phase;
- no stale document claims a known-completed hardening item is still open;
- the active TL handoff map is machine-findable from root instructions;
- no product architecture is changed by documentation cleanup;
- exact commit/PR is recorded in `WORK-REGISTRY.md`.

## Start here

Read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
3. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file
