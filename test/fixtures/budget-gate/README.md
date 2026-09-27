# test/fixtures/budget-gate — budget-gate.mjs verification matrix (TL4-005)

Every case asserts an EXPECTED outcome (pass OR fail — a gate that cannot fail is
not a gate). Wired into `build/flauz/scripts/verify-fixtures.sh`; run the whole
matrix from the repo root with `sh build/flauz/scripts/verify-fixtures.sh`.

The budget rows here mirror (a subset of) the real registry
`build/flauz/budgets/flauz-budgets.json`; measurement values are derived from the
existing perf fixtures (`test/fixtures/perf-timers/`, `test/fixtures/process-shape/`)
where possible so numbers stay consistent with the rest of the harness. Synthetic
values for pending-runtime rows (browser launch, model switching, multi-agent) are
explicitly labeled `NOT a product measurement` in the record's `source` field.

| Case | Inputs | Expected exit | Proves |
|---|---|---|---|
| clean | `budgets-clean.json` + `measurements-clean.jsonl` | 0 (8 pass) | all rows PASS; pending-runtime rows with a measurement COMPARE (not blind-skip) |
| over-budget | `budgets-over.json` + `measurements-clean.jsonl` | 1 (1 fail) | the gate FIRES on a fail-severity over-budget row |
| skip (no require) | `budgets-with-pending.json` + `measurements-missing.jsonl` | 0 (1 pass / 4 skip) | skip-vs-fail policy: absent measurement = documented SKIP |
| skip (--require) | same + `--require` | 1 | `--require` flips SKIP to FAIL |
| skip (--require enforced-ci) | same + `--require enforced-ci` | 0 | scoped require: only enforced rows are required, the measured one passes |
| malformed budgets | `malformed-budgets.json` | 2 | a malformed registry is a usage error, never a silent pass |
| warn severity | `budgets-warn.json` + `measurements-clean.jsonl` | 0 (1 warn) | over-budget WARN row leaves the exit code alone |
| unknown measurement id | `budgets-clean.json` + `measurements-unknown-id.jsonl` | 0 (1 warn) | a measurement without a budget row is a WARN, never a crash |
| unit mismatch | `budgets-clean.json` + `measurements-unit-mismatch.jsonl` | 0 (1 skip + 1 warn) | apples/oranges comparisons are skipped with a WARN |
| registry self-check | `build/flauz/budgets/flauz-budgets.json`, no measurements | 0 (all skip) | the real registry validates and every row SKIPs with a reason |
| perf-fixture plumbing | perf-timers + process-shape mapped via perf-log-parse into a temp dir, `--require enforced-ci` | 0 (30 pass / 15 skip) | the input plumbing works on real repo data; every enforced-ci row is measured and green |
| violations fixture | `after-session.violations.json` mapped via perf-log-parse | 1 (3 fail) | the unified gate fires on the process-shape violation fixture (R3/R4/R5) exactly like memory-snapshot.mjs |
