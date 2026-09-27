# TL4-005 — Performance and Resource Budget Doctrine

Status: ACTIVE (Worker C, TL4 lane). Registry: `build/flauz/budgets/flauz-budgets.json`
(schema: `flauz-budgets.schema.json`). Gate: `build/flauz/scripts/budget-gate.mjs`.
CI: `.github/workflows/flauz-budgets.yml`. Honest baseline: `build/flauz/budgets/BASELINE.md`.

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
| `activation.bridge.activate-resolved.p95` | <= 300 ms | §1.3 row 5 via the `willActivateBridge-didActivateBridge` mark pair (BRIDGE_ACTIVATION_MARKS) | pending-runtime (pair not on the CI --prof-duration-markers list; emit sites exist, runtime measurement does not) |

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

### 3.5 Browser launch — fixture-pending-runtime (TL3)

| Row id | Budget | Status |
|---|---|---|
| `browser.launch.ttf.cold.p95` | <= 2500 ms | pending-runtime, `[E]` |
| `browser.launch.ttf.warm.p95` | <= 400 ms | pending-runtime, `[E]` |
| `browser.tool-path.overhead.warm.p95` | <= 250 ms (fail) | pending-runtime — budget CITED from PERF §5.2 (canary C-28 A5); measurement WAITING-ON-LANE F |

### 3.6 Model switching — fixture-pending-runtime

| Row id | Budget | Status |
|---|---|---|
| `model.switch.ready.p95` | <= 500 ms | pending-runtime, `[E]` |
| `model.switch.warmup.p95` | <= 2000 ms (§5.1 warm-up ceiling — the willWarmModels mark anchors the startup-side twin) | pending-runtime |

### 3.7 Multi-agent workload — fixture-pending-runtime (TL2-006)

| Row id | Budget | Status |
|---|---|---|
| `multi-agent.rss.per-session` | <= 150 MB at N=4 | pending-runtime, `[E]` |
| `multi-agent.rss.total` | <= 800 MB at N=4 | pending-runtime, `[E]` |
| `multi-agent.eventloop.lag.p95` | <= 50 ms | pending-runtime, `[E]` |

## 4. Promotion ladder (explicit, no optimism)

```
static  ->  fixture  ->  CI-measured  ->  (runtime-measured for driver-dependent rows)
```

- **static**: rule checkable without any measurement (activation rows —
  enforced-in-repo today).
- **fixture**: contract + provisional budget exercised by fixtures only. Current
  rows: the three CPU rows. Promotion requires a CI capture step (see §6.3).
- **CI-measured (enforced-ci)**: the CI budget job maps real artifacts and the
  gate compares with `--require enforced-ci`. Current rows: all startup and
  memory rows. IMPORTANT honesty note: in the CURRENT job the mapped artifacts
  are the repo's perf FIXTURES (no full build exists in sandboxes; binding
  MIGRATION-PLAN §5 — real boots happen on CI runners via `flauz-perf.yml`).
  The budget job's plumbing is production-shaped; the numbers it compares today
  are fixture-backed, recorded as such in BASELINE.md. Real measured baselines
  arrive when the perf-pair/memory jobs' artifacts are fed to the gate (next
  rung: point the budget job's mapping at `artifacts/` of `flauz-perf.yml`).
- **pending-runtime**: the measuring runtime does not exist (TL3 browser
  runtime; provider switching; multi-agent workload driver; the bridge
  activation mark pair not yet on the CI marker list). The gate SKIPs these rows
  with that reason until a measurement exists — "defined, not measured".
  Fixtures prove the rows compare correctly when a measurement IS provided.

Status counts at the honest baseline (BASELINE.md): 30 enforced-ci, 3
enforced-in-repo, 3 fixture, 9 pending-runtime — 45 rows total.

## 5. Enforcement policy

| Gate | Where | What | Fails how |
|---|---|---|---|
| `budget-gate.mjs` | CI (`flauz-budgets.yml`), local | unified registry comparison over mapped measurements; `--require enforced-ci` | exit 1 on any fail-severity violation or required-skip |
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
- Promotion: when TL3's runtime lands, the C-28-style driver emits the records;
  first 3 syncs of data recalibrate the `[E]` numbers, then severity -> fail and
  status -> enforced-ci in one PR.

### 6.2 Model switching (flauz-models provider seam)

- `ready`: t0 = switch command (model picker selection of another provider);
  t1 = new provider connection confirmed ready (auth + handshake complete).
  Model INFERENCE time is excluded (first-token latency is a vendor property).
- `warmup`: vendor warm-up triggered by the switch, must stay off the
  interactive path (same rule as §5.1 startup warm-up, 2 s ceiling).
- Runs: N >= 5 switches per provider pair on the CI runner; p95. Promotion as
  6.1, driven by the TL2-002 adapter work.

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
  current CI job compares fixture-backed numbers and says so (BASELINE.md).
- Browser launch, model switching and multi-agent budgets are DEFINED, NOT
  MEASURED — citing them as product performance would be dishonest.
- The unified gate does not replace the deep gates; divergence between them is
  a bug and the fixture matrix tests both over the same data.
