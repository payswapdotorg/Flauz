# P2-FIX-110 — `SshCliExecutor.remotePidAlive` reads a spawn failure as "not alive" (single-invocation unverifiable window)

Observed by the TL3-P2 partition-B readiness audit (worker chat ac5e6776)
on the pinned base `c27de198e1`; routed as P2-FIX-110 by TL4 (2026-10-01
routing record), TL3.

- **Observable behavior:** a binary vanishing in the single-invocation
  window between a successful state read and the `kill -0` liveness probe
  is classified by `SshCliExecutor.remotePidAlive` as "not alive" — a
  live-but-unverifiable pid reads as gone. The direction is fail-closed
  verdicts, never healthy — but "unverifiable" is being collapsed into
  "gone", which is a stronger claim than the evidence supports (the window
  is one invocation inside one op).
- **Evidence + runtime level:** local-real — executor-seam inspection
  (`extensions/flauz-environments/src/lifecycle/sshCli.ts`); the D3
  teardown-honesty drills (landed, PR #73) cover the adjacent
  binary-vanish class at the destroy seam; this is the liveness-probe seam.
- **Owning domain:** environments provider seams (TL3).
- **Proposed contract change (if any):** distinguish `spawnError`
  (unverifiable) from a clean exit-status "not alive" verdict in
  `remotePidAlive`, surfacing a typed `UNVERIFIABLE` outcome rather than
  "gone"; the consuming op verdicts fail closed on `UNVERIFIABLE` (never
  healthy, never a fabricated teardown).
- **Acceptance test:** a `kill -0` that spawn-fails (binary gone) while
  other probes in the same op worked yields `UNVERIFIABLE`, not "not
  alive", and the op outcome fails closed; a clean exit-status probe still
  reads "not alive"; the environments suite green (new regression test
  fails on base, passes on fix).
- **Architecture impact:** small — one typed-outcome addition inside the
  ssh executor seam; no state-machine change.
