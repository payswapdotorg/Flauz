# TL4-005 Budget Baseline — the honest record

Run date: 2026-09-27 · Branch: `tl4/c-perf-budgets` · Base: `4c96dad50d6fe87ded1599ec561c54d37573e7b1` (numbers produced by the gate as shipped in this branch; the registry values are unchanged by the branch — the branch ADDS the registry/gate/CI).

Reproduce (from the repo root):

```sh
mkdir -p /tmp/bgin
node build/flauz/scripts/perf-log-parse.mjs --parse-timers     test/fixtures/perf-timers/flauz-main.timers.tsv    > /tmp/bgin/flauz.timers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-timers     test/fixtures/perf-timers/upstream-main.timers.tsv > /tmp/bgin/upstream.timers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-markers    test/fixtures/perf-timers/flauz-main.markers.tsv    > /tmp/bgin/flauz.markers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-markers    test/fixtures/perf-timers/upstream-main.markers.tsv > /tmp/bgin/upstream.markers.json
node build/flauz/scripts/perf-log-parse.mjs --parse-process-json test/fixtures/process-shape/eventually.json    > /tmp/bgin/eventually.process.json
node build/flauz/scripts/perf-log-parse.mjs --parse-process-json test/fixtures/process-shape/after-session.json > /tmp/bgin/after-session.process.json
node build/flauz/scripts/budget-gate.mjs --measurements /tmp/bgin --require enforced-ci   # exit 0
```

## Verdicts (actual runs)

| Run | Summary line | Exit |
|---|---|---|
| Mapped perf fixtures, `--require enforced-ci` | `budget-gate: 30 pass / 0 fail / 15 skip / 0 warn` | 0 |
| Violations probe (`after-session.violations.json` mapped, no require) | `budget-gate: 6 pass / 3 fail / 34 skip / 2 warn` — R3 (3 sessions), R4 (3 panes), R5 (1077 MB) fire; R1/R2 `[E]` rows WARN | 1 |
| Registry self-check (no measurements) | `budget-gate: 0 pass / 0 fail / 45 skip / 0 warn` | 0 |
| Fixture matrix (`sh build/flauz/scripts/verify-fixtures.sh`) | `ALL 44 CASES AS EXPECTED (0 deviations)` | 0 |

## Row-level record

Registry: `flauz-budgets.json` v1 — 45 rows: **30 enforced-ci / 3 enforced-in-repo / 3 fixture / 9 pending-runtime** (22 fail-severity, 23 warn-severity).

### Fixture-backed (compared against the repo's perf fixtures — NOT product measurements)

| Row | Measured (fixture) | Budget | Result |
|---|---|---|---|
| startup.tsv.ellapsed.p50.delta | +23 ms (851 vs 828) | <= +75 | pass |
| startup.tsv.ellapsed.p95.delta | +26 ms (884 vs 858) | <= +150 | pass |
| startup.tsv.didStartWorkbench.p95.delta | +26 ms (same measurement) | <= +100 | pass |
| startup.tsv.standard-runs | 10 | >= 5 | pass |
| startup.marker.code/didStartRenderer-code/didStartWorkbench.p95.delta | +18 ms (659 vs 641) | <= +100 | pass |
| startup.marker.code/flauz/willConnectCore-code/flauz/didConnectCore.p95 | 178 ms | <= 500 | pass |
| startup.marker.code/flauz/willRegisterParticipants-code/flauz/didRegisterParticipants.p95 | 92 ms | <= 500 | pass |
| startup.marker.code/flauz/willWarmModels-code/flauz/didWarmModels.p95 | 940 ms | <= 2000 | pass |
| memory.eventually.rss.flauz-core | 128 MB | <= 150 | pass |
| memory.eventually.rss.ext-host-pinned.max / .min | 165 MB | <= 250 / >= 100 `[E]` | pass |
| memory.eventually.count.extra-ext-hosts | 1 | <= 1 | pass |
| memory.eventually.count.agent-sessions | 0 | <= 2 | pass |
| memory.eventually.count.browser-panes | 1 | <= 2 | pass |
| memory.eventually.rss.flauz-added-total | 381 MB | <= 500 | pass |
| memory.eventually.stock.* (4 rows) | 1 each | >= 1 | pass |
| memory.after-session.rss.flauz-core | 140 MB | <= 150 (warn sev) | pass |
| memory.after-session.rss.ext-host-pinned.max / .min | 178 MB | <= 250 / >= 100 `[E]` | pass |
| memory.after-session.count.extra-ext-hosts | 1 | <= 1 | pass |
| memory.after-session.count.agent-sessions | 2 | <= 2 | pass |
| memory.after-session.count.browser-panes | 2 | <= 2 | pass |
| memory.after-session.rss.flauz-added-total | 498 MB | <= 500 | pass |
| memory.after-session.stock.* (4 rows) | 1 each | >= 1 | pass |

These 30 enforced-ci rows are all PASS on the mapped fixtures. **The numbers are
fixture-backed, not measured product numbers** — the fixtures are the repo's perf
artifacts (`test/fixtures/perf-timers/`, `test/fixtures/process-shape/`), which
the deep gates (startup-pair, memory-snapshot) already verify. Real CI-measured
numbers arrive when the `flauz-budgets.yml` mapping is pointed at the
`flauz-perf.yml` job artifacts (promotion ladder step, doctrine section 4) — no
full build exists in worker sandboxes (binding, MIGRATION-PLAN section 5).

### Enforced-in-repo (skipped by the gate with reason; asserted by activation-lint.mjs)

- activation.startup-events.declarers / .off-whitelist / .unauthorized-declarers —
  activation-lint is GREEN on the current tree (2 declarers: flauz.flauz-agent,
  flauz.flauz-workspace; no off-whitelist events).

### Fixture-status (defined contract + provisional `[E]` budget; no measurement yet)

- cpu.startup.seconds.flauz-added · cpu.steady.load.flauz-core ·
  cpu.steady.load.flauz-added-total — skip; sampling driver pending (doctrine 6.3).

### Pending-runtime (defined, not measured — the runtime does not exist yet)

- activation.bridge.activate-resolved.p95 (mark pair not on the CI marker list)
- browser.launch.ttf.cold.p95 · browser.launch.ttf.warm.p95 (TL3 runtime)
- browser.tool-path.overhead.warm.p95 (budget cited from PERF section 5.2 via
  canary C-28; driver WAITING-ON-LANE F)
- model.switch.ready.p95 · model.switch.warmup.p95 (provider runtime)
- multi-agent.rss.per-session · multi-agent.rss.total ·
  multi-agent.eventloop.lag.p95 (workload driver)

Citing any pending-runtime or fixture-status number as a product measurement is
dishonest — they are contracts with provisional `[E]` budgets.
