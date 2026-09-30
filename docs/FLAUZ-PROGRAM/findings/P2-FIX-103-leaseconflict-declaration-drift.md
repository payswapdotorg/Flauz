# P2-FIX-103 — `leaseConflict.d.mts`'s `LeaseConflictFacts` omits the runtime `code` field

Routed from: the TL2-ACC-1 rehearsal's candidate finding CF-J3
(`docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md`),
formalized by P2-002 Worker A (journey runtime) during acceptance routing.

- **Observable behavior:** `leaseConflictFacts()` (runtime,
  `extensions/flauz-agent/core/leaseConflict.mjs`) returns
  `{ code, resource, violation, holder, leaseId, deadline, claimant }`, but
  the hand-written sibling declaration `leaseConflict.d.mts` types the return
  as `LeaseConflictFacts` WITHOUT `code`. Consumers that assert the conflict
  code only compile because of P2-FIX-102 (the batteries are never
  typechecked); a genuinely-compiled consumer gets `TS2339`.
- **Evidence + runtime level:** local-real — the TL2-ACC-1 journey test hit
  exactly this: `Property 'code' does not exist on type
  'LeaseConflictFacts'` under the default tsc until the assertion read the
  field through an explicit structural cast; the runtime value carries the
  code (asserted green in the rehearsal's LEG 10 and in the agentos runtime
  drill's INV-5).
- **Owning domain:** flauz-agent core declarations.
- **Proposed contract change (if any):** add
  `readonly code: 'flauz.a2a.lease-conflict';` to `LeaseConflictFacts` in
  `leaseConflict.d.mts` (one declaration-file line).
- **Exact owning TL:** TL2.
- **Acceptance test:** a consumer compiled under the default config can
  assert `leaseConflictFacts(err)?.code === LEASE_CONFLICT_CODE` without a
  cast.
- **Architecture-change requirement:** no (declaration drift only).
