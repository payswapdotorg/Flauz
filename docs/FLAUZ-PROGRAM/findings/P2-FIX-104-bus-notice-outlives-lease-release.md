# P2-FIX-104 — a graph-level lease release does not retract the A2A bus notice (the two enforcement layers diverge until the notice horizon)

Routed from: the TL2-ACC-1 rehearsal's candidate finding CF-J4
(`docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md`),
formalized by P2-002 Worker A (journey runtime) during acceptance routing.

- **Observable behavior:** releasing the durable store lease
  (`lease-released` journal row) leaves the bus's journal-projected claim
  (`activeClaimOf`) in place until the notice's `leaseUntil` horizon. After
  the release, the STORE layer considers the step's lease free while the BUS
  layer still names the released holder — and a subsequent `claimStepLease`
  by a third agent would pass the store-side check but be refused by the
  bus's own enforcement (the two layers disagree about who holds the
  resource). This is the documented v0 posture (the notice is the "watcher
  mirror"; the leaseUntil horizon is advisory), but for the acceptance
  journey's no-orphan-state criterion the divergence is worth routing.
- **Evidence + runtime level:** fixture — the rehearsal's LEG 11 observation
  check `leg11.bus-notice-outlives-release` (green, documenting the
  divergence): after `releaseLease`, the store's lease state for the step is
  `undefined` while `bus.activeClaimOf('flauz-orch/G-001/S-05')` still
  returns the released holder with the pre-release deadline. Confirmed on
  the pinned base `7558680d` (the agentos battery/drill surface carries the
  same contract).
- **Owning domain:** A2A/orchestration lease semantics.
- **Proposed contract change (if any):** either `releaseLease` mirrors the
  release onto the bus (a `resource-claim` release notice) or the composed
  claim path (`claimStepLease`) treats a store-side free lease as
  authoritative over a stale bus notice. Either is a semantic contract
  change — decision first, then implementation.
- **Exact owning TL:** TL2.
- **Acceptance test:** after `releaseLease` + a fresh `claimStepLease` by a
  different claimant, exactly one acquisition row lands and the bus
  projection names the new holder.
- **Architecture-change requirement:** small (a mirror or a precedence rule
  between the two journals; no state-machine change).
