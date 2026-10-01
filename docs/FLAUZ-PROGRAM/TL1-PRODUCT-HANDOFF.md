# TL1 Active Product-Phase Handoff

## Mission

Keep the Flauz repository self-describing and conflict-free while the product moves from foundation completion into integrated acceptance.

## Active work

### P2-FIX-102 — the TL1-routed acceptance finding
**Status: CLAIMED + IMPLEMENTED, landing deliberately deferred (2026-09-30 — the authoritative claim record and the landing-gate decision record live in `WORK-REGISTRY.md`)**

The dedicated Agent OS/session battery tsconfig receipts compile none of
their named subjects (the inherited base `exclude` removes exactly the files
the dedicated `include` lists — vacuously green receipts). The minimal
two-tsconfig fix (`"exclude": []` in both dedicated configs) is implemented
on branch `flauz-p2fix/p2-fix-102` (pushed head `a5908655`; worker-lane
delivery, independently station-re-verified) and is held out of main by the
cross-TL landing gate: the flip surfaces a latent TL2-owned
battery-instrument drift family (80 diagnostic entries, all in the four
battery-suite files or naming their harness shims; four of them are
P2-FIX-103's `LeaseConflictFacts` drift) that would redden the
`flauz-agentos`/`flauz-session` CI lanes if 102 landed alone. TL1 does not
fix that family (the cross-domain law); 102 lands in the same merge wave
that resolves the family, or after TL4 routes it as findings. When the gate
clears: rebase/update against current main, independently rerun the
acceptance test (`--listFiles` names the subjects AND the merged tree's
dedicated-config compiles are clean), land through a dedicated PR, update
the registry and this handoff in the same merge wave.

### P2-001 — Control-plane reconciliation
**Status: DONE (2026-09-29, this merge wave — see `WORK-REGISTRY.md` for the completion record)**

The reconciliation closed the last stale open-claim (the TL2 surge section
status), added the dated verification record to `CURRENT-STATE.md`, marked
the lane closed in `PARALLEL-EXECUTION.md`, and verified the handoff map is
discoverable from `AGENTS.md`, `FLAUZ-START-HERE.md` and
`.agents/PRODUCT-PHASE.md`. No product code or historical evidence changed.

TL1's remaining phase role: substrate maintenance, `P2-FIX-*` findings
routed to the TL1 domain (Code OSS/upstream/packaging/service seam/control
plane), and canonical control-plane integration for other TLs' registry
text. Do not invent TL1 product work outside a routed finding.

Delivered scope (the original P2-001 deliverables, all met):

- reconcile `CURRENT-STATE.md` — delivered (the dated P2-001 verification record);
- reconcile completion/hardening references in active control-plane docs — delivered (the surge section status was the last stale open-claim; audit covered every FLAUZ-PROGRAM doc);
- make the active phase and handoff map obvious from `AGENTS.md` and `FLAUZ-START-HERE.md` — verified already true (established by `c27de198`); no edit needed;
- keep `WORK-REGISTRY.md` authoritative for status — delivered (P2-001 DONE row + completion record in the same merge wave);
- keep `PARALLEL-EXECUTION.md` aligned with the product-acceptance phase — delivered (lane table updated);
- preserve historical evidence rather than deleting it — held (old handoffs, the surge record and all landing records untouched below their banners).

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

P2-001 ran while TL4 performs P2-002/P2-003; it is now closed and does not gate them.

When TL4 discovers a TL1-domain finding, it creates a P2-FIX finding and routes it to TL1. Do not silently fold it into the documentation reconciliation work item.

## Definition of done — P2-001 self-check

- all active control-plane documents describe the same current phase — **met** (all six control-plane files + PRODUCT-PHASE + the four product handoffs describe the Product Acceptance phase);
- no stale document claims a known-completed hardening item is still open — **met** (full FLAUZ-PROGRAM scan; the surge section was the last instance);
- the active TL handoff map is machine-findable from root instructions — **met** (AGENTS.md + FLAUZ-START-HERE.md + .agents/PRODUCT-PHASE.md);
- no product architecture is changed by documentation cleanup — **met** (docs-only diff);
- exact commit/PR is recorded in `WORK-REGISTRY.md` — **met** (the P2-001 completion record).

## Start here

Read:

1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/SOURCE-OF-TRUTH.md`
3. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file
