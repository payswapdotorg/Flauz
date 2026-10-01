# P2-FIX-109 — executor ops have no cancellation ports: an in-flight lifecycle op always runs to completion

Observed by the TL3-P2 partition-B readiness audit (worker chat ac5e6776)
on the pinned base `c27de198e1`; routed as P2-FIX-109 by TL4 (2026-10-01
routing record), TL3 — an architecture decision for a future wave.

- **Observable behavior:** with the landed one-mutating-op-per-environment
  guard (D1, PR #73 — typed pre-flight `OP_IN_FLIGHT`), a second op issued
  while one is in flight is rejected (never interleaved) — but the
  in-flight op itself always runs to completion. A "destroy aborts a slow
  start mid-effect" semantic is impossible without a cancellation port on
  `EnvironmentExecutor`.
- **Evidence + runtime level:** local-real — the D1 regression probes
  (landed, PR #73) pin the rejection behavior; the completion-inevitability
  is direct executor-semantics inspection (all four executor kinds).
- **Owning domain:** environments architecture (TL3) — a cancellation port
  changes the `EnvironmentExecutor` contract (partial-effect reconciliation
  rules), gated on TL adjudication of the partial-effect semantics.
- **Proposed contract change (if any):** a cancellation port on
  `EnvironmentExecutor` (typed `OP_CANCELLED` outcome + partial-effect
  reconciliation rules — what a cancelled start leaves on disk, who reaps
  the child, how the ledger records the cancellation), per the TL3 claim
  record's decision-first posture: the DECISION is recorded with this wave;
  the implementation belongs to the wave that needs cancellation semantics.
- **Acceptance test (when implemented):** a destroy issued while a slow
  start is mid-effect lands a cancelled start and a terminal `destroyed`
  envelope, with the ledger recording both honestly and no orphan child.
- **Architecture impact:** medium — new executor port + partial-effect
  reconciliation semantics; deferred to a future wave by the claim record.
