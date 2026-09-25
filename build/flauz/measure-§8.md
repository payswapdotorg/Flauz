# Closing PERFORMANCE-PLAN §8 — measurement map

Wave-3 Lane H's CI jobs exist to MEASURE, not just to gate. This file maps each
open measurement question in PERFORMANCE-PLAN §8 to the exact job, run command,
and output that closes it. A question is "closed" when the named artifact
carries the measured number and the related **[E]** budgets are recalibrated
(or confirmed) from it — a DECISION-LOG entry records the recalibration.

Reference tree @ `9bf9ae764da` throughout; all script paths under
`build/flauz/scripts/`; workflows under `.github/workflows/flauz-*.yml`.

---

## §8 q1 — Absolute stock baseline on the CI runner class (marks table)

**Why needed**: every **[E]** ms budget in §1.3 is provisional until the first
CI baseline pair exists; the *deltas* are the contract, but absolute guards
need absolute numbers.

**Closed by**: `.github/workflows/flauz-perf.yml` → job `startup-pair`, PLUS
the stock snapshot of the memory job.

- The pair's **upstream side** (10 × `--prof-append-timers` +
  `--prof-duration-markers` runs of the pristine `main` tree) IS the absolute
  stock baseline on the pinned runner class (`ubuntu-24.04` — DL-16 candidate).
- Artifacts: `flauz-perf-pair` upload — `upstream.timers.tsv` (per-run
  ellapsed + standard-start verdict + perfBaseline + heap) and
  `upstream.markers.tsv` (per-pair durations incl. the
  `code/didStartRenderer-code/didStartWorkbench` segment).
- Recalibration act: replace the **[E]** markers on §1.3 absolute targets with
  `upstream.p95 + <delta budget>` as hard gates in
  `startup-pair.mjs` (`STARTUP_BUDGETS` / row constants) — a one-commit change
  once the first baseline is in.

## §8 q2 — AHP prewarm contribution to `code/didStartWorkbench` (providers on vs off)

**Why needed**: PERF §1.2 rule 5 leaves the AHP prewarm decision
(`chat.agentHost.claudeAgent.enabled` / `…codexAgent.enabled`,
`src/vs/platform/agentHost/common/agentService.ts:186,196`) as a measured call;
Flauz's default profile disables built-in providers (DL-3) which also removes
their prewarm cost.

**Closed by**: the same `startup-pair` job, run twice on the SAME runner class
(workflow_dispatch, `runs` input):

1. Run A (default profile, providers OFF — the stock pair): deltas as usual.
2. Run B (providers ON): re-run with test settings
   `--prof-append-timers` after setting
   `chat.agentHost.claudeAgent.enabled=true`,
   `chat.agentHost.codexAgent.enabled=true` in the user-data settings — the
   workflow accepts a settings-JSON env (`FLAUZ_PERF_PROVIDER_SETTINGS`,
   same shape as chat-perf.yml's `test_settings` input) and writes it into the
   run's user-data-dir `settings.json` before boot.
3. The comparison `didStartWorkbench_p95(B) − didStartWorkbench_p95(A)` on the
   upstream tree isolates the prewarm contribution (same runner, N=10 each);
   on the flauz tree it confirms the Flauz default profile actually sheds the
   cost.

**Note**: step 2-3 are specified as the workflow's optional "prewarm variant"
(to be enabled by uncommenting the settings-echo block in the run step — kept
minimal in Wave 3 to avoid speculative knobs); the measurement itself is
two dispatches with different `FLAUZ_PERF_PROVIDER_SETTINGS`, no code change.

## §8 q3 — Pinned ext-host RSS delta via `resolveProcesses()` (R1/R3 table numbers)

**Why needed**: §3.2's Agent Bridge row (100-250 MB RSS **[E]**) and the
floor-case ~500 MB total need measured numbers from a pinned host.

**Closed by**: `.github/workflows/flauz-perf.yml` → job `memory-snapshot` +
`memory-snapshot.mjs`:

- Capture at `LifecyclePhase.Eventually` (ps snapshot during the self-exiting
  prof run's 15 s telemetry window) and, once lane F's session driver lands,
  after a scripted agent session (C-23 shared harness).
- The assertion report prints the pinned host's measured RSS (`R1 … RSS <n>MB`)
  and the flauz-added total (`R5 … total <n>MB`) — those two numbers close the
  **[E]** marks in the §3.2 rows (escalate `--enforce` once calibrated).
- The stock-tree snapshot (uploaded as `stock-baseline-eventually.ps.txt` when
  no flauz processes exist yet) additionally provides the stock per-process
  baseline (main/renderer/shared/pty/watcher/agent-host) — the §3.1 table's
  measured counterpart.
- Capture-path note: the PERF §6.1 surface is `resolveProcesses()`; the CI job
  captures the equivalent process tree via ps(1) today (zero product code) and
  the `--json` path in `memory-snapshot.mjs` consumes the
  `resolveProcesses()`-shaped payload the moment lane F ships the dump — same
  assertion layer, so the measurement contract does not change.

## §8 q4 — Browser tool 4-process path overhead, cold vs warm shared process

**Why needed**: §5.2 budgets browser tools at ≤ 250 ms p95 overhead EXCLUDING
tool work, on the path ext host → renderer → shared process ('playwright'
channel) → main (CDP) → Chromium; the cold/warm split (shared-process bring-up
+ Chromium spawn vs steady-state) is unmeasured.

**Closed by**: `.github/workflows/flauz-canaries.yml` → job `c28-browser-tools`,
per `build/flauz/canaries/C-28.md` §Steps-5..8:

- COLD: first browser tool call end-to-end from a fresh boot (request →
  screenshot part rendered) — includes shared-process + Chromium spawn.
- WARM: immediate repeat — isolates the steady-state 4-process path overhead.
- Budget application: WARM is the §5.2 ≤ 250 ms p95 number; COLD feeds the
  §5.5-class "first-use" UX expectation and the §3.2 pane-renderer policy
  (idle disposal after 10 min trades memory against re-paying COLD).
- The timings land in the canary artifact (`flauz-canary-c28` upload) and the
  sync canary report; once ≥3 syncs of data exist, promote WARM to a hard gate
  in the canary step (grep the recorded ms from the driver log, assert ≤ 250).

---

## Cross-cutting notes

- All four closures ride artifacts that upload `if: always()` — a failed gate
  still yields the measurement (gates and data are separated by design).
- Runner-class pinning (`ubuntu-24.04` for perf) is a DL-16 candidate: the
  absolute numbers are only meaningful per runner class; deltas are the
  portable contract.
- N=10 per side (nearest-rank p50/p95 — see `perf-log-parse.mjs` header) is the
  Wave-3 default; the workflow's `runs` input allows larger N for tighter
  confidence at sync checkpoints.
