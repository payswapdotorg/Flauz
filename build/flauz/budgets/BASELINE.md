# TL4-005 Budget Baseline — the honest record

Run date: 2026-09-28 · Branch: `tl4/c-h1-perf-runtime` · Base: `e4717ba8d1374f27b9ef979b9028f225ed33cd90` (pinned; the registry values are unchanged by the branch — TL4-H1 promotes statuses and documents where the numbers come from).

Registry: `flauz-budgets.json` v1 — 45 rows: **31 enforced-ci / 3 enforced-in-repo / 3 fixture / 8 runtime-measured / 0 pending-runtime** (was 30/3/3/0/9 before TL4-H1; 22 fail-severity, 23 warn-severity).

## Reproduce (from the repo root)

```sh
# (1) fixture-backed plumbing (the CI budget job's exact recipe; sandbox-safe)
mkdir -p /tmp/bgin
node build/flauz/scripts/perf-log-parse.mjs --parse-timers     test/fixtures/perf-timers/flauz-main.timers.tsv    > /tmp/bgin/flauz.timers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-timers     test/fixtures/perf-timers/upstream-main.timers.tsv > /tmp/bgin/upstream.timers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-markers    test/fixtures/perf-timers/flauz-main.markers.tsv    > /tmp/bgin/flauz.markers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-markers    test/fixtures/perf-timers/upstream-main.markers.tsv > /tmp/bgin/upstream.markers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-tap       test/fixtures/perf-timers/flauz-main.marks.tap       > /tmp/bgin/flauz.marks-tap.json
node build/flauz/scripts/perf-log-parse.mjs --parse-process-json test/fixtures/process-shape/eventually.json    > /tmp/bgin/eventually.process.json
node build/flauz/scripts/perf-log-parse.mjs --parse-process-json test/fixtures/process-shape/after-session.json > /tmp/bgin/after-session.process.json
node build/flauz/scripts/budget-gate.mjs --measurements /tmp/bgin --require enforced-ci   # exit 0 — 31 pass / 0 fail / 14 skip

# (2) runtime drills (sandbox-safe: model-switch + multi-agent; browser needs
#     a Chromium CDP endpoint — CI provisions pinned Chrome for Testing
#     153.0.8010.12, a sandbox with any local Chromium can launch the same
#     pattern and export FLAUZ_CDP_ENDPOINT)
node --experimental-strip-types extensions/flauz-models/test/canaries/model-switch-runtime.drill.ts --out /tmp/ms.json
node --experimental-strip-types extensions/flauz-agent/test/canaries/multi-agent-runtime.drill.ts --out /tmp/ma.json
chromium --headless=new --no-sandbox --disable-gpu --disable-popup-blocking \
         --remote-debugging-port=9222 --user-data-dir=/tmp/flauz-chrome about:blank &
# webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
  node --experimental-strip-types extensions/flauz-browser/test/canaries/browser-launch-runtime.drill.ts --out /tmp/br.json
node build/flauz/scripts/budget-gate.mjs --measurements /tmp --require runtime-measured   # exit 0 — 8 pass / 0 fail

# (3) the fixture matrix (both directions: a gate that cannot fail is not a gate)
sh build/flauz/scripts/verify-fixtures.sh   # exit 0 — 220 cases as expected
```

## Verdicts (actual runs, this branch, this sandbox)

| Run | Summary line | Exit |
|---|---|---|
| Mapped perf fixtures (+ tap fixture), `--require enforced-ci` | `budget-gate: 31 pass / 0 fail / 14 skip / 0 warn` | 0 |
| Runtime drill records (model-switch + multi-agent + browser), `--require runtime-measured` | `budget-gate: 8 pass / 0 fail / 37 skip / 0 warn` | 0 |
| Runtime records doctored fixture (every value over budget) | `budget-gate: 0 pass / 1 fail / 37 skip / 7 warn` — the fail-severity tool-path row fires; the warn rows report WARN | 1 |
| Registry self-check (no measurements) | `budget-gate: 0 pass / 0 fail / 45 skip / 0 warn` | 0 |
| Fixture matrix (`sh build/flauz/scripts/verify-fixtures.sh`) | `ALL 220 CASES AS EXPECTED (0 deviations)` | 0 |
| startup-pair markers+tap (fixture markers TSV + tap fixture) | `ALL STARTUP GATES GREEN` (flauz pairs from TSV+tap pool; bridge pair from tap) | 0 |
| startup-pair doctored tap (bridge 420ms > 300ms) | gate fires on the bridge pair | 1 |
| Real activation tap receipt (see below) | 8 marks tapped in the documented order, real ext-host clock | 0 |

## Runtime-measured rows (TL4-H1) — REAL sandbox measurements, this branch

Measured 2026-09-28 in the worker sandbox (node v24.21.0, Linux; browser leg over the
sandbox's local Chromium 143.0.7499.4 headless via the documented launch pattern —
CI re-measures on every run of the `flauz-budgets-runtime` job over pinned
Chrome for Testing 153.0.8010.12 on ubuntu-24.04; the CI numbers are the
recurring product evidence, these are the first recorded real numbers):

| Row | Measured | Budget | Result | Exact scope (never cite wider) |
|---|---|---|---|---|
| model.switch.ready.p95 | 0.1 ms (n=30) | <= 500 | pass | the fabric provider seam: switch command -> target provider's model list (`providerFor -> provideLanguageModelChatInformation`), alternating flauz-openai-compat <-> flauz-mock, vendor endpoint = LOCAL mock. NOT the picker UI round trip, NOT a live vendor. |
| model.switch.warmup.p95 | 17.4 ms (n=15) | <= 2000 | pass | the switch-triggered auth+handshake probe (`adapter.health()`, GET /models with the env-resolved credential) over the registry-resolved openai-compat config against the local mock endpoint. Live-vendor recalibration stays with TL2-H1. |
| multi-agent.rss.per-session | 52.5 MB (n=4) | <= 150 | pass | mean VmRSS (/proc/<pid>/status) of 4 concurrent REAL core/service.mjs subprocesses after a real workload window (2 executing a real task journey, 2 idle). |
| multi-agent.rss.total | 209.9 MB (n=4) | <= 800 | pass | the sum over the same 4 real sessions. |
| multi-agent.eventloop.lag.p95 | 5.7 ms | <= 50 | pass | the DRIVER loop (monitorEventLoopDelay in the drill process driving the 4 sessions). NOT the booted ext-host / workbench loop — that is the documented residue. |
| browser.launch.ttf.cold.p95 | 195.5 ms (n=5) | <= 2500 | pass | fresh CdpEndpointHost+BrowserSessionManager per run over a real Chromium: transport dial + browser attach + first target + TL3-002 hardening + committed navigation + first screenshot bytes. The Chromium spawn-to-listening cost is OUTSIDE t0..t1 (the launcher owns it; CI run 1 rides the freshest state). |
| browser.launch.ttf.warm.p95 | 182.8 ms (n=5) | <= 400 | pass | the immediate repeat of the open path on a warm host/manager (new sessions). |
| browser.tool-path.overhead.warm.p95 | 17.3 ms (n=5) | <= 250 | pass | the SEAM SHARE of the C-28 A5 path: warm (manager.navigate + manager.screenshot) minus the raw-CDP twin (Page.navigate + frameNavigated + loadEventFired + captureScreenshot) per pair on warm attached targets. The ext-host -> renderer -> shared-process legs remain WAITING-ON-LANE F. |

The model-switch ready number is genuinely sub-millisecond: the drill measures the
in-process fabric seam (registry-resolved config, provider cache, adapter
construction after first use) — the mock vendor and local HTTP make the WARMUP
row (17.4 ms) the realistic one. Both numbers are honest for the documented
scope; the live-vendor and picker-UI recalibration are named residues, not
hidden ones.

## The bridge row (activation.bridge.activate-resolved.p95) — enforced-ci via the TL4-H1 tap

- The renderer mark relay is a ONE-TIME snapshot taken BEFORE onStartupFinished
  extensions activate (extHostExtensionService.ts:647-663 — verified in-repo at
  the pinned base), so the flauz mark pairs can NEVER appear in
  `--prof-duration-markers` TSVs. That was the flauz-perf R6 drift.
- The closure is an observational tap inside flauz-agent's own `mark()`
  (env `FLAUZ_PERF_MARKS_FILE`, fail-open, zero I/O when unset): the boot lane
  sets it per run, `startup-pair.mjs --tap-flauz` consumes the tap files as
  duration-marker runs (pair duration = did.now - will.now on the ext-host
  clock), and the budget job maps the tap-converted markers shape (the bridge
  row joins its sibling marker rows in the enforced-ci fixture-backed posture).
- Sandbox receipt (harness-driven, REAL activation code + REAL service.mjs
  handshake, `FLAUZ_PERF_MARKS_FILE` set): all 8 marks tapped in the documented
  emission order; first-run pair durations connectCore=71.8 ms (real subprocess
  handshake), registerParticipants=0.44 ms, warmModels=0.32 ms (harness has no
  models), bridge=73.4 ms. The PRODUCT numbers arrive with the first CI boot
  runs of the wired lane (tap files land in the `flauz-perf-pair` artifact).
- Fixture plumbing: `flauz-main.marks.tap` (bridge 178.4 ms) feeds the budget
  job through `--parse-tap`; the doctored variant (bridge 420 ms) proves the
  gate fires.

## Fixture-backed rows (compared against the repo's perf fixtures — NOT product measurements)

Unchanged by TL4-H1 (30 rows at the pinned base; the bridge row joins them as
the 31st): startup.tsv.* deltas (p50 +23 ms, p95 +26 ms, standard-runs 10),
startup.marker.* (renderer pair +18 ms; flauz pairs 178/92/940 ms from the
markers fixture), memory.eventually.* / memory.after-session.* (128-498 MB
range). **The numbers are fixture-backed, not measured product numbers** — real
CI-measured numbers arrive when the budget job's mapping is pointed at the
`flauz-perf.yml` job artifacts (the drills' records already flow through the
runtime lane). No full build exists in worker sandboxes (binding,
MIGRATION-PLAN §5).

## Enforced-in-repo (skipped by the gate with reason; asserted by activation-lint.mjs)

activation.startup-events.declarers / .off-whitelist / .unauthorized-declarers
— activation-lint GREEN on this branch's tree (2 declarers; no off-whitelist
events; R7 affinity-pin WARN is the pre-existing documented posture).

## Fixture-status (defined contract + provisional `[E]` budget; no measurement yet)

cpu.startup.seconds.flauz-added · cpu.steady.load.flauz-core ·
cpu.steady.load.flauz-added-total — skip; sampling driver pending (doctrine
§6.3; unchanged by TL4-H1).

## Honest residues (named, never hidden)

1. **Live vendors**: the model-switch rows measure the seam with the LOCAL
   mock vendor endpoint. Live-provider recalibration (auth classes, retries,
   provenance) is TL2-H1's lane.
2. **Booted-workbench loops**: multi-agent.eventloop.lag.p95 measures the
   DRIVER loop; the workbench main-process loop needs the booted driver (same
   class as the session-battery workbench seam). The browser tool-path rows
   carry the seam share only (the 4-process workbench legs are
   WAITING-ON-LANE F per canary C-28).
3. **Chromium spawn cost**: outside the browser ttf t0..t1 by construction
   (the launcher owns spawn-to-listening; the CI job launches a fresh pinned
   Chromium so run 1 rides the coldest browser state).
4. **Boot-lane numbers**: the startup/bridge rows' real numbers arrive with
   the first CI runs of the wired lanes (the sandbox cannot boot the
   workbench — binding MIGRATION-PLAN §5); the fixture plumbing + the
   real-activation tap receipt above are the sandbox evidence.

Citing any fixture-backed number as a product measurement is dishonest; the
runtime-measured rows above ARE real measurements, for exactly the scopes in
the table.
