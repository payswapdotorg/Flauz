# TL4-004 — Whole-Session Acceptance Battery

Status: fixture rung delivered (this document is the binding spec).
Owner: TL4 (product-quality lane). Gate: `build/flauz/scripts/session-battery.mjs`.
Suite: `extensions/flauz-workflow/test/session-battery.test.ts`.
CI: `.github/workflows/flauz-session.yml` (zero-dep job) + the compiled
unit-test subset in `flauz-hygiene.yml` (the same suite as compiled `.js`).

## 1. The quality question

"A green unit-test suite is not a green product" (TL4 handoff, hard rules).
The unit suites pin individual services; nothing pinned the WHOLE session —
a user sitting down, creating a task, running an agent tool, opening a
browser pane, booting an environment, verifying the result, signing off,
crashing, restarting and CONTINUING. TL4-004 is that pin.

The question this battery answers, machine-checked, on every Flauz-relevant
change: **can a user complete, recover from and continue a whole Flauz
session, with every observable outcome landing on disk?**

## 2. The journeys (J1–J4)

Each journey drives the REAL modules (not mocks of them) with ports
injected: the `flauz.tasks/v0` state machine (`flauz-workspace`
TaskService), the evidence ledger, the workflow envelope
(`flauz-workflow` WorkflowService), the browser session manager
(`flauz-browser` BrowserSessionManager over the FakeCdpTransport, with the
real policy engine and the real on-disk journal), and the environment
lifecycle manager (`flauz-environments` EnvironmentLifecycleManager behind
the SimulatedRemoteExecutor).

| id | journey | asserts (the load-bearing subset) |
| --- | --- | --- |
| J1 | golden whole-session | create task → submit plan → approve → tool step (artifact + ledger row) → browser leg (agent session opens, allowed navigation commits, journal records open/close) → environment leg (create → start → describe healthy → stop → destroy, ops journaled) → verify-pass → sign-off → save fragment; `W-001` validates, tool + evidence distilled |
| J2 | recovery re-run | `run()` with replay approvals creates a NEW task whose `workflow-start` carries `derivedFrom` → the ORIGINAL task; NEW evidence rows append (chain grows); fragment history records the re-run; verdict `completed` |
| J3 | fail-closed | a navigation outside every allowlist is DENIED with ZERO `Page.navigate` commands sent (the FakeCdpTransport sent-command log is the assertion surface); an actor-less environment lifecycle op is a TYPED rejection (`ACTOR_REQUIRED`), never a silent no-op |
| J4 | continuity | a full restart (fresh service instances on the SAME root): task list, workflow index, environment lifecycle state and browser journal all recover from disk; a re-run on the recovered services completes; nothing is lost |

## 3. The transcript contract (fixture discipline)

After each journey the suite distills the OBSERVABLE outcomes into a
transcript document (`flauz.session-battery/v1`): task event sequences
(actor:type), ledger row counts + kinds + uris, artifact sha256, navigation
verdicts, environment op sequences + final state, fragment id/tool count/
evidence refs/history length, journal event sequence, continuity counts.
Volatile values (random session/tab ids, partitions, timestamps) are
normalized to stable markers or distilled to counts. The assembled
document is `deepStrictEqual` against the pinned fixture
`test/fixtures/session-battery/golden-transcript.json`.

- **Regeneration**: `FLAUZ_SESSION_BATTERY_RECORD=1` (with
  `FLAUZ_SESSION_BATTERY_FIXTURES=<dir>`) re-pins the fixture — a
  promotion-ladder tool, not an everyday escape hatch: a regenerated
  fixture must be REVIEWED diff-by-diff in the PR that lands it.
- **Failability**: `test/fixtures/session-battery-doctored/` carries a
  one-value-doctored copy (the golden ledger row count claims 2). The
  battery MUST fail against it (exit 1) — pinned in
  `verify-fixtures.sh` and probed in CI. A gate that cannot fail is not
  a gate.

## 4. Runner model + the promotion ladder

The suite is a `node:test` file importing the real `.ts` extension
sources:

- **fixture rung (shipped)**: `node --experimental-strip-types --test`
  (node >= 22.6) via the gate; on older nodes the gate reports SKIP
  (exit 0) unless `--require` promotes it to FAIL (CI evidence mode).
  The browser leg runs the FakeCdpTransport; the environment leg runs
  the SimulatedRemoteExecutor (test infrastructure by TL3-003's own
  marking).
- **compiled rung (already wired, free)**: the OSS build compiles the
  suite into `out/` and the flauz-hygiene unit-test subset step runs it
  as `.js` — two runners, one battery.
- **runtime rung (follow-up, honest)**: real CDP against a booted
  Chromium (the `flauz-browser` CDP transport), the LocalProcessExecutor
  for the environment leg, and a booted workbench for the UI seams. This
  rung activates when the product runtime exposes a CI-driveable seam
  (TL3's runtime work + TL2's workbench integration); the journey
  catalogue and transcript contract stay IDENTICAL — only the ports
  change. The promotion decision lives in the TL4 work-registry entry.

## 5. CI wiring

`flauz-session.yml` (this PR): zero-dep job, node 22, three steps —
`session-battery.mjs --require`, the doctored-fixture fires-the-gate
probe, and the full `verify-fixtures.sh` matrix. Gated on Flauz paths +
`test/fixtures/session-battery*/**` + workflow_dispatch.

## 6. Coverage matrix (fixture rung)

| surface | J1 | J2 | J3 | J4 |
| --- | --- | --- | --- | --- |
| task state machine (create/plan/approve/evidence/report/verify/sign-off) | ✓ | ✓ | — | ✓ (recovered) |
| evidence ledger (append, chain, derivedFrom linking) | ✓ | ✓ | — | ✓ (recovered) |
| workflow envelope (save, distill, re-run, replay approvals, history) | ✓ | ✓ | — | ✓ (recovered + re-run) |
| browser session manager (open, navigate, close, journal) | ✓ | — | ✓ (deny path) | ✓ (journal recovered) |
| policy engine (driver allowlist gating, zero-command deny) | ✓ | — | ✓ | — |
| environment lifecycle (create/start/stop/destroy, provenance law) | ✓ | — | ✓ (typed rejection) | ✓ (state recovered) |
| artifacts on disk (uri + sha256) | ✓ | ✓ | — | ✓ |

Deferred families (documented honestly): multi-agent concurrent sessions,
model/provider switching mid-session, task branching, snapshot/restore of
environments — these need the runtime rung or TL2 surfaces; the transcript
schema reserves room for them (additive journeys, never silent edits).
