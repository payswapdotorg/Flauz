# TL4-005 — Performance and Resource Budget Doctrine

Status: ACTIVE (Worker C, TL4 lane; TL4-H1 runtime promotion landed 2026-09-28).
Registry: `build/flauz/budgets/flauz-budgets.json`
(schema: `flauz-budgets.schema.json`). Gate: `build/flauz/scripts/budget-gate.mjs`.
CI: `.github/workflows/flauz-budgets.yml` (budget job + the TL4-H1
`flauz-budgets-runtime` drills lane). Honest baseline:
`build/flauz/budgets/BASELINE.md`.

This document is decision-first: it states WHAT is budgeted, WHERE each budget is
enforced, and what is honestly NOT yet measured. Numbers in the registry that have
no measured basis are marked provisional `[E]` and carry warn severity — they can
never silently fail CI, and they can never be cited as product measurements.

## 1. Problem being closed

Before TL4-005 the perf stack MEASURED (startup-pair, memory-snapshot,
activation-lint — all fixture-verified and CI-wired) but:

- there was NO single machine-checkable budget-definition file;
- there was NO unified gate comparing measurements to budgets across metric groups;
- the TL4-005 product metrics — browser launch, model switching, multi-agent
  workload — had NO budgets at all;
- budgets were scattered as hardcoded thresholds inside individual scripts.

TL4-005 adds the registry (single source of truth), the unified gate (one verdict,
skip-vs-fail policy), fixtures proving the gate fires, CI wiring over real repo
data, and this doctrine. The existing single-domain gates REMAIN authoritative
for their depth semantics (pair diffing, mark integrity, phase gate, process-tree
classification): the unified gate mirrors their budget rows and adds the missing
product metrics on top.

## 2. Registry and gate mechanics

- `flauz-budgets.json` — one row per budget. Row fields: `id`, `metric`
  (measurement id; multiple rows may share one metric — e.g. PERF §1.3 rows 1+2
  re-gate the same ellapsed p95 at +150/+100 ms), `budget` (number, `null`
  catalogue-only, or string form `">=100"`/`"<=250"` for absolute floor/ceiling
  rows), `unit`, `comparison` (`<=`, `>=`, `delta<=` — the measurement record must
  carry `baseline` for delta rows), `severity` (`fail` = over budget exits 1,
  `warn` = over budget reports and exit stays 0), `status` (promotion ladder,
  §4), `source`, `notes`.
- `budget-gate.mjs` — zero-dep node. Inputs: measurement records (JSON/JSONL) and
  the exact JSON shapes emitted by `perf-log-parse.mjs --parse-timers /
  --parse-markers / --parse-process-json` (plus the raw TSV forms), mapped to
  budget ids per the `--help` mapping. Exit codes: 0 pass/SKIP, 1 violation,
  2 usage/malformed registry/unrecognized input. Summary line:
  `budget-gate: X pass / Y fail / Z skip / W warn`.
- Skip-vs-fail (binding, build/flauz/README.md): absent measurement => documented
  SKIP with a status-specific reason, NEVER a silent pass. `--require [scope]`
  flips SKIPs to FAILs — the CI budget job uses `--require enforced-ci` so every
  enforced row must actually be measured by the mapped inputs. Unknown measurement
  ids are WARN rows, never crashes. Unit mismatches skip with a WARN (no
  apples/oranges comparisons).
- Drift trip-wire: when a script-side constant changes (`STARTUP_BUDGETS`,
  `FIRST_PAINT_*`, memory §3.2 numbers), the registry row must change in the same
  PR — the fixture matrix runs both gates over the same data and the CI budget
  job re-derives everything from the mapped fixtures.

## 3. Metric catalogue

Budget / method / status per metric group. "enforced-on-CI" rows are compared by
the `flauz-budgets.yml` budget job over the perf artifacts that job maps
(`flauz-perf.yml` also keeps its own deep gates); "enforced-in-repo" rows are
asserted by activation-lint.mjs (wired into `flauz-hygiene.yml` and
`flauz-perf.yml`), with the registry carrying the same numbers for catalogue
completeness.

### 3.1 Startup (PERF §1.3) — enforced-on-CI

| Row id | Budget | Method | Status |
|---|---|---|---|
| `startup.tsv.ellapsed.p50.delta` | delta <= +75 ms | p50 of the `ellapsed` column over standard_start runs, flauz vs upstream TSV pair (`startup-pair.mjs --timers-*`) | enforced-ci |
| `startup.tsv.ellapsed.p95.delta` | delta <= +150 ms | same, p95 | enforced-ci |
| `startup.tsv.didStartWorkbench.p95.delta` | delta <= +100 ms | §1.3 row 2 tighter re-gate of the same p95 | enforced-ci |
| `startup.tsv.standard-runs` | >= 5 | standard_start runs per side (measurement validity, `--min-runs` default) | enforced-ci |
| `startup.marker.code/didStartRenderer-code/didStartWorkbench.p95.delta` | delta <= +100 ms | nearest-rank p95 of the marker pair (`--markers-*`) | enforced-ci |
| `startup.marker.code/flauz/willConnectCore-code/flauz/didConnectCore.p95` | <= 500 ms | §1.3 row 3 core handshake | enforced-ci |
| `startup.marker.code/flauz/willRegisterParticipants-code/flauz/didRegisterParticipants.p95` | <= 500 ms | §6.2 registration window | enforced-ci |
| `startup.marker.code/flauz/willWarmModels-code/flauz/didWarmModels.p95` | <= 2000 ms | §1.3 row 6 / §5.1 LM warm-up, off interactive path | enforced-ci |

Semantics note (inherited from startup-pair.mjs): the append-timers TSV has one
timing column, `ellapsed` = workbench-done duration; row 1's "first-paint" naming
follows the plan's row vocabulary, and the renderer-start segment granularity
comes from the marker rows. Deltas are same-runner flauz-minus-upstream.

### 3.2 Activation (PERF §2.1/§2.2) — enforced-in-repo

| Row id | Budget | Method | Status |
|---|---|---|---|
| `activation.startup-events.declarers` | <= 2 | count of flauz-* manifests declaring `onStartupFinished` (activation-lint R3) | enforced-in-repo |
| `activation.startup-events.off-whitelist` | <= 0 | activation events outside the §2.2 whitelist, incl. `*` (R1+R2) | enforced-in-repo |
| `activation.startup-events.unauthorized-declarers` | <= 0 | onStartupFinished declarers outside {flauz.flauz-agent, flauz.flauz-workspace} (R3 ids, DL-19) | enforced-in-repo |
| `activation.bridge.activate-resolved.p95` | <= 300 ms | §1.3 row 5 via the `willActivateBridge-didActivateBridge` mark pair, measured from the TL4-H1 mark tap (flauz-agent marks.ts, env `FLAUZ_PERF_MARKS_FILE`; startup-pair.mjs `--tap-flauz`; the budget job maps the tap-converted markers shape) | enforced-ci (TL4-H1: the renderer relay snapshots marks BEFORE onStartupFinished activation — extHostExtensionService.ts:647-663 — so the tap is the capture point; same fixture-backed posture as the sibling marker rows until the boot-lane tap files carry the product numbers) |

### 3.3 Memory (PERF §3.2) — enforced-on-CI

Per-process-class RSS + counts at scenario `eventually` (LifecyclePhase.Eventually)
and `after-session` (after a scripted agent session), from the process snapshot
(`memory-snapshot.mjs`; the unified gate consumes the resolveProcesses-json path).

| Row ids (per scenario) | Budget | §3.2 row | Status |
|---|---|---|---|
| `rss.flauz-core` | <= 150 MB (fail @eventually / warn @after-session) | R2 | enforced-ci |
| `rss.ext-host-pinned.max` / `.min` | <= 250 / >= 100 MB (warn, `[E]`) | R1 range | enforced-ci |
| `count.extra-ext-hosts` | <= 1 (fail) | R1 structure | enforced-ci |
| `count.agent-sessions` | <= 2 (fail) | R3 | enforced-ci |
| `count.browser-panes` | <= 2 (fail) | R4 | enforced-ci |
| `rss.flauz-added-total` | <= 500 MB (fail) | R5 floor-case total | enforced-ci |
| `stock.shared-process` / `.pty-host` / `.watcher` / `.agent-host` | >= 1 (warn — R6 "never fatal" posture) | R6 | enforced-ci |

### 3.4 CPU — fixture

Defined contracts, provisional `[E]` budgets (warn severity), no measured
baseline exists. See §6.3 for the sampling shapes and the promotion path.

| Row id | Budget | Status |
|---|---|---|
| `cpu.startup.seconds.flauz-added` | <= 15 s (cumulative CPU-seconds of flauz-added classes at Eventually) | fixture |
| `cpu.steady.load.flauz-core` | <= 5 % (p95 of per-snapshot class-mean load) | fixture |
| `cpu.steady.load.flauz-added-total` | <= 10 % (same shape, flauz-added classes) | fixture |

### 3.5 Browser launch — runtime-measured (TL4-H1 drill; TL3 seam)

| Row id | Budget | Status |
|---|---|---|
| `browser.launch.ttf.cold.p95` | <= 2500 ms | runtime-measured (TL4-H1 drill; `[E]` budget standing until 3 CI syncs recalibrate, then severity/status promotion per §6.1) |
| `browser.launch.ttf.warm.p95` | <= 400 ms | runtime-measured (TL4-H1 drill; `[E]` standing, same recalibration path) |
| `browser.tool-path.overhead.warm.p95` | <= 250 ms (fail) | runtime-measured — the SEAM SHARE of PERF §5.2 / canary C-28 A5 (the flauz-browser layer over raw CDP); the ext-host -> renderer -> shared-process legs remain WAITING-ON-LANE F (booted workbench driver; documented residue, never cite the seam share as the full-path number) |

### 3.6 Model switching — runtime-measured (TL4-H1 drill)

| Row id | Budget | Status |
|---|---|---|
| `model.switch.ready.p95` | <= 500 ms | runtime-measured (TL4-H1 drill over the real fabric seam; `[E]` standing; vendor endpoint = local mock — live-vendor recalibration stays with TL2-H1) |
| `model.switch.warmup.p95` | <= 2000 ms (§5.1 warm-up ceiling — the willWarmModels mark anchors the startup-side twin) | runtime-measured (TL4-H1 drill: the auth+handshake health probe on the registry-resolved adapter config) |

### 3.7 Multi-agent workload — runtime-measured (TL4-H1 drill; TL2-006 workload shape)

| Row id | Budget | Status |
|---|---|---|
| `multi-agent.rss.per-session` | <= 150 MB at N=4 | runtime-measured (TL4-H1 drill; `[E]` standing; VmRSS of real core/service.mjs subprocesses) |
| `multi-agent.rss.total` | <= 800 MB at N=4 | runtime-measured (TL4-H1 drill; `[E]` standing) |
| `multi-agent.eventloop.lag.p95` | <= 50 ms | runtime-measured (TL4-H1 drill) — DRIVER loop measurement (the doctrine says the driver owns the monitor); the booted workbench loop is the documented residue |

## 4. Promotion ladder (explicit, no optimism)

```
static  ->  fixture  ->  CI-measured  ->  runtime-measured (driver-dependent rows)
```

- **static**: rule checkable without any measurement (activation rows —
  enforced-in-repo today).
- **fixture**: contract + provisional budget exercised by fixtures only. Current
  rows: the three CPU rows. Promotion requires a CI capture step (see §6.3).
- **CI-measured (enforced-ci)**: the CI budget job maps real artifacts and the
  gate compares with `--require enforced-ci`. Current rows: all startup and
  memory rows (TL4-H1 adds the bridge row, measured via the mark tap). IMPORTANT
  honesty note: in the CURRENT job the mapped artifacts are the repo's perf
  FIXTURES (no full build exists in sandboxes; binding MIGRATION-PLAN §5 — real
  boots happen on CI runners via `flauz-perf.yml`). The budget job's plumbing
  is production-shaped; the numbers it compares today are fixture-backed,
  recorded as such in BASELINE.md. Real measured baselines arrive when the
  perf-pair/memory jobs' artifacts are fed to the gate (next rung: point the
  budget job's mapping at `artifacts/` of `flauz-perf.yml`).
- **runtime-measured (TL4-H1)**: the measuring RUNTIME DRIVER exists — a drill
  under `extensions/*/test/canaries/*-runtime.drill.ts` plus the
  `flauz-budgets.yml flauz-budgets-runtime` CI lane. The driver measures AT
  RUNTIME (it runs the workload and emits measurement records in the exact
  budget-gate envelope shape); the CI lane requires its rows with
  `--require runtime-measured` (a SKIPped drill is a FAILED lane there — the
  browser is the lane's own infrastructure, not an external dependency). The
  gate still SKIPs these rows with a named reason wherever a measurement is not
  provided (local runs, non-Linux RSS). Current rows: the browser launch trio,
  the model-switch pair, the multi-agent trio. The drills keep exit-0 SKIP law
  for local runs lacking resources; `--require` is what enforces on CI.
- **pending-runtime**: the measuring runtime does not exist. Zero rows remain
  (TL4-H1 landed every driver; the CPU rows' sampling driver is the remaining
  `fixture` rung). Fixtures prove the rows compare correctly when a measurement
  IS provided.

Status counts at the honest baseline (BASELINE.md): 31 enforced-ci, 3
enforced-in-repo, 3 fixture, 8 runtime-measured, 0 pending-runtime — 45 rows
total.

## 5. Enforcement policy

| Gate | Where | What | Fails how |
|---|---|---|---|
| `budget-gate.mjs` | CI (`flauz-budgets.yml`), local | unified registry comparison over mapped measurements; `--require enforced-ci`; the `flauz-budgets-runtime` lane requires the runtime rows with `--require runtime-measured` | exit 1 on any fail-severity violation or required-skip |
| `startup-pair.mjs` | CI (`flauz-perf.yml` job 2), local | §1.3 pair diff + R6 mark integrity + phase gate (deep semantics) | exit 1 |
| `memory-snapshot.mjs` | CI (`flauz-perf.yml` job 3), local | §3.2 process-tree assertions, all three capture paths | exit 1 |
| `activation-lint.mjs` | CI (`flauz-hygiene.yml` job 1 + `flauz-perf.yml`), local | §2.1/§2.2 manifest discipline (the enforced-in-repo rows) | exit 1 |
| `verify-fixtures.sh` | CI (`flauz-budgets.yml` step b), local | the whole fixture matrix incl. every budget-gate behavior (a gate that cannot fail is not a gate) | exit 1 on deviation |

Severity policy: `fail` rows are hard gates (exit 1). `warn` rows are the
memory-snapshot `[E]`/R6 posture — reported, never exit-fatal, promoted to fail
by recalibration PR once a measured baseline exists. Budget revision procedure:
PR changing `flauz-budgets.json` (+ the mirroring script constant when
applicable) + a WORK-REGISTRY note under TL4-005 + BASELINE.md re-run; posture
changes (severity/status promotions) additionally need a DECISION-LOG entry per
the existing convention (e.g. DL-5/DL-19 precedent).

## 6. Runtime-pending measurement contracts

Each contract defines WHO measures, WHAT the numbers are, and the promotion act.

### 6.1 Browser launch (TL3-001 real browser runtime)

- **ttf (time-to-first-frame)**: t0 = user-visible "open browser surface"
  command issued (or agent `openBrowserTab` tool call); t1 = first frame of the
  browser surface rendered (paint event / first screenshot part rendered for the
  agent path). COLD = first open after fresh boot (Chromium spawn +
  shared-process bring-up included); WARM = immediate repeat.
- Runs: N >= 5 per variant, same runner class as the perf pair, nearest-rank p95
  (perf-log-parse stats). Measurement records: `browser.launch.ttf.cold.p95`,
  `browser.launch.ttf.warm.p95` (ms).
- Landed (TL4-H1): the driver is
  `extensions/flauz-browser/test/canaries/browser-launch-runtime.drill.ts`
  (real CdpEndpointHost + BrowserSessionManager over a REAL Chromium; CI
  provisions pinned Chrome for Testing 153.0.8010.12 and the
  flauz-budgets-runtime lane requires the rows). First real numbers in
  BASELINE.md (this branch's sandbox). Recalibration path unchanged: first 3 CI
  syncs of data recalibrate the `[E]` numbers, then severity -> fail and
  status -> enforced-ci in one PR. Documented scope: cold = fresh host/attach/
  first target/navigation/screenshot (the Chromium spawn-to-listening cost is
  the launcher's); the tool-path row measures the SEAM SHARE (the flauz-browser
  layer over raw CDP) — the 4-process workbench legs stay WAITING-ON-LANE F.

### 6.2 Model switching (flauz-models provider seam)

- `ready`: t0 = switch command (model picker selection of another provider);
  t1 = new provider connection confirmed ready (auth + handshake complete).
  Model INFERENCE time is excluded (first-token latency is a vendor property).
- `warmup`: vendor warm-up triggered by the switch, must stay off the
  interactive path (same rule as §5.1 startup warm-up, 2 s ceiling).
- Runs: N >= 30 alternating vendor switches (both directions; doctrine floor 5).
- Landed (TL4-H1): the driver is
  `extensions/flauz-models/test/canaries/model-switch-runtime.drill.ts` — the
  REAL fabric seam (bootstrapFabric + registry + providerFor) with the vendor
  endpoint a LOCAL mock (OpenAI list-models wire shape, env-resolved
  credential). `ready` = switch command -> the target provider's model list
  (the interactive path); `warmup` = the switch-triggered auth+handshake
  health probe (adapter.health(), GET /models). Inference is excluded by
  contract. Live-vendor recalibration (auth classes, retries, provenance)
  stays with TL2-H1. Promotion to enforced-ci follows the same 3-sync
  recalibration as 6.1.

### 6.3 CPU (fixture today, promotion path defined)

- **steady-state sampling shape**: >= 10 process snapshots at 1 s intervals
  inside the Eventually window (the same window the memory job already uses);
  per snapshot compute the class-mean `load` (resolveProcesses rows, or ps
  `pcpu`); the measurement is the nearest-rank p95 of the per-snapshot series.
  A single snapshot is NOT a valid sample (the gate never synthesizes these rows
  from one snapshot — that is why they are fixture-status).
- **startup CPU shape**: cumulative CPU-seconds of the flauz-added classes at
  the Eventually snapshot, captured by adding the `time` column to the memory
  job's ps invocation (`ps -eo pid,ppid,rss,pcpu,time,args`) and summing per
  class.
- Promotion: add the capture to the memory job (one workflow step + a
  measurement-record emitter), recalibrate `[E]` budgets from the first
  baseline, flip status to enforced-ci.

### 6.4 Multi-agent workload (TL2-006)

- Workload: N=4 concurrent agent sessions (2 executing + 2 idle) driven by the
  scripted session driver (C-23 shared harness), then the after-session capture
  path. Records: `multi-agent.rss.per-session` (mean session RSS), 
  `multi-agent.rss.total`, `multi-agent.eventloop.lag.p95`.
- **event-loop lag shape**: `monitor_eventLoopDelay` histogram in the main
  process, p95 over the workload window, reported by the session driver
  (zero product code in the gate; the driver owns the monitor).
- Landed (TL4-H1): the driver is
  `extensions/flauz-agent/test/canaries/multi-agent-runtime.drill.ts` — N=4
  concurrent REAL SeamClient.start sessions (real core/service.mjs
  subprocesses, real handshakes, real .flauz state; ceil(N/2) executing a real
  task journey, the rest idle). RSS = per-session VmRSS from
  /proc/<pid>/status after the workload window (Linux; non-Linux emits the
  eventloop row only). HONESTY NOTE: the driver's monitor measures the DRIVER
  loop (this drill process), not the booted workbench main process — the
  workbench-loop measurement needs the booted session driver and is the
  documented residue (same class as the session-battery workbench seam).
- Note: at <= 2 sessions the §3.2 floor-case total (500 MB) already applies and
  is enforced-ci TODAY; the N=4 ceiling is the scaled workload row.

## 7. Relationship to the measurement closures

`build/flauz/measure-§8.md` maps the PERF §8 open questions to jobs. TL4-005
complements it: the registry is where the recalibration acts LAND (a `[E]` warn
row becoming a calibrated fail row is the machine-checkable form of "question
closed"). The budget job's artifact (`flauz-budget-gate-report`) is the
per-row evidence a DECISION-LOG recalibration entry can cite.

## 8. Honest statements

- No number in the registry is a product measurement until CI measures it; the
  current CI budget job compares fixture-backed numbers and says so
  (BASELINE.md). The runtime lane (`flauz-budgets-runtime`) measures its rows
  FOR REAL on every run.
- TL4-H1 promoted the runtime rows to real, reproducible measurements with
  exactly-documented scopes (BASELINE.md table): the model-switch rows carry a
  LOCAL mock vendor (live-vendor recalibration is TL2-H1's), the eventloop row
  is the DRIVER loop (not the booted workbench loop), the tool-path row is the
  SEAM SHARE of the C-28 A5 path (the workbench legs are WAITING-ON-LANE F),
  and the browser cold number excludes the Chromium spawn cost by
  construction. Citing any of them wider than their documented scope is
  dishonest.
- The unified gate does not replace the deep gates; divergence between them is
  a bug and the fixture matrix tests both over the same data (220 cases,
  both directions).
