# P2-FIX-113 — unkeyed hash chains: a consistent whole-tail ledger rewrite is beyond unkeyed tamper-evidence (informational)

Observed by the TL3-P2 partition-C readiness audit (worker chat 3aaa6b2a)
on the pinned base `c27de198e1`; routed as P2-FIX-113 by TL4 (2026-10-01
routing record), TL3 — informational.

- **Observable behavior:** the landed per-row `prev` chain (TL3C-04, PR #74)
  detects every single-record, reorder, delete, truncate and digest edit —
  the realistic lazy-tamper class — on both the resources provenance
  ledger and the continuity ops ledger. An attacker who rewrites an entire
  tail consistently (recomputing every `prev` link + the digests) AND the
  envelope together is beyond unkeyed tamper-evidence; the final record's
  metadata is covered by its digests but not by a successor link. A
  hard-crash window in restore Phase 3 (detectable, not auto-healed) is
  the same class of residual.
- **Evidence + runtime level:** local-real — the tamper-evidence
  regression battery (landed, PR #74) enumerates the detected classes; the
  undetectable class is construction-level.
- **Owning domain:** evidence-ledger architecture (TL3 + the station's
  DL-20 record names the signed-checkpoint hook as the Wave-4-pattern
  future).
- **Proposed contract change (if any):** the signed-checkpoint hook (DL-20
  pattern) — periodic keyed checkpoints anchoring the chain tail. The
  key-holding boundary (where the signing key lives) is an architecture
  decision attached to that future wave.
- **Acceptance test (when implemented):** a consistently-rewritten tail
  without the checkpoint key fails verification at the first checkpoint
  boundary.
- **Architecture impact:** medium — new key-holding boundary; recorded
  informational, no action this wave.
