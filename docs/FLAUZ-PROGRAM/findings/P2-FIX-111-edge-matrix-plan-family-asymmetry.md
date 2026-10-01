# P2-FIX-111 — edge-matrix vs plan-family vocabulary asymmetry: `RESTORABLE_KINDS` admits kinds with no v0 restoration family

Observed by the TL3-P2 partition-C readiness audit (worker chat 3aaa6b2a)
on the pinned base `c27de198e1`; routed as P2-FIX-111 by TL4 (2026-10-01
routing record), TL3 + TL2 joint.

- **Observable behavior:** `EDGE_LEGALITY`'s `RESTORABLE_KINDS`
  (`extensions/flauz-resources/src/api.ts`) admits `task`, `agent-session`
  and `workflow` as `restored-from`/`snapshot-of` from-kinds, but
  `ContinuityService` (`src/continuity.ts` `FAMILY_BY_KIND`) has no v0
  restoration family for them — the typed error documents the closed set.
  Restoring such a snapshot is expressible in the graph grammar but
  unexecutable in the service.
- **Evidence + runtime level:** local-real — the partition-C audit's C2/C4
  checklist probes (landed evidence pins, PR #74) pin both sides of the
  asymmetry.
- **Owning domain:** TL3 lead jointly with the flauz-workspace (task
  envelope) and Agent OS (agent sessions) lanes — minting those plan
  families would duplicate the owning lanes' contracts prematurely
  (INTEGRATION-GAP rows 1/3 mark them Wave-next); the legality matrix is a
  DL-R2 deliberate joint update (matrix + tests + fixtures together).
- **Proposed contract change (if any):** when the workspace/Agent-OS lanes
  define their restoration families, the joint update extends
  `FAMILY_BY_KIND` + the matrix + fixtures in one DL-R2-shaped change. No
  unilateral minting by either co-owner before that wave.
- **Acceptance test (when the joint wave lands):** a `restored-from` edge
  on a `task`-kind ref resolves to a real restoration family (or the
  matrix stops admitting the kind).
- **Architecture impact:** small — but deliberately deferred to the owning
  lanes' wave per the routing record and the claim record's joint-deferral
  posture.
