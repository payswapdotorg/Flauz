# build/flauz/ — Flauz CI harness, perf gates, and canaries

Wave 3, Lane H (worker `flauz-H4-w3`). Everything in this tree is **additive
product code** for the Flauz mirror (DL-12: `src/vs` stays pristine; the
FORK-CRITICAL ledger stays empty). Nothing here builds the repo inside a
worker sandbox — full builds happen only on CI runners (MIGRATION-PLAN §5,
binding).

Authoritative inputs: `docs/PERFORMANCE-PLAN.md` + `docs/MIGRATION-PLAN.md`
(flauz-code-lab branch `wave2/e-perf-migration`), `DECISION-LOG.md` (branch
`tl/decision-log`), `docs/CODE-OSS-INTEGRATION-MATRIX.md` (branch
`wave1/c-capability-matrix`). Reference tree: `payswapdotorg/Flauz` @
`9bf9ae764da438b1234a8243dc9e47173ef58ee7`.

---

## 1. CI job map (MIGRATION-PLAN §5 jobs 1-6 · PERF §6.3 gates)

| MIGRATION §5 job | Workflow (`.github/workflows/`) | Jobs | PERF §6.3 gates enforced | PERF §8 question closed |
|---|---|---|---|---|
| **1. Build + upstream hygiene** | `flauz-hygiene.yml` | `hygiene` | — (compile/eslint/unit subset are upstream hygiene; shaped on upstream `pr.yml`) | — |
| FORK-CRITICAL guard (§5.1 item 1, §6 gate 1) | `flauz-hygiene.yml` (first steps) + pre-commit hook variant | `hygiene` | src/vs pristine outside `contrib/flauz` (DL-12/DL-10) | — |
| Activation lint (§2.2) | `flauz-hygiene.yml` | `hygiene` | activation budget table rows 1-3 (no `*`; ≤2 on `onStartupFinished`, bridge+workspace only; whitelist events) | — |
| **2. Startup perf pair** | `flauz-perf.yml` | `startup-pair` | §1.3 rows 1-3 (TSV p50/p95 deltas + duration-marker budgets), mark-pair integrity (R6), phase gate (§1.3 row 4) | q1 (absolute baseline), q2 (prewarm on/off) |
| **3. Memory snapshot** | `flauz-perf.yml` | `memory-snapshot` | §3.2 rows R1-R6 at `Eventually` + after scripted session | q3 (pinned ext-host RSS), q1 (stock baseline) |
| **4. Upstream-sync canaries (every sync — DL-11)** | `flauz-canaries.yml` | `c20-default-agent`, `c23-parallel-sessions`, `c24-subagents-steering`, `c28-browser-tools` | canary specs `build/flauz/canaries/C-20|23|24|28.md` (C's gated rows + U-1) | q4 (browser-tool path, C-28 job) |
| **5. Proposed-API rota** | `flauz-rota.yml` | `rota` | DL-4 union-vs-inventory drift gate + baseline deltas (D-3) | — |
| **6. Checkpoints** | `flauz-rota.yml` (checkpoint-reminder step; tag by sync runbook) | `rota` | DECISION-LOG diff reminder at every `flauz/sync/<date>` tag; rota `--snapshot` baseline committed at the tag | — |

All four workflows: `ubuntu-latest` class (perf pair pins `ubuntu-24.04` —
DL-16 candidate), **no secrets** (public repo, read-only perms), gated on
paths `extensions/flauz-*/**`, `build/flauz/**`, `product.flauz.json`,
`.github/workflows/flauz-*` + `workflow_dispatch`, actions pinned to the SHAs
upstream's own workflows use.

## 2. Scripts (`build/flauz/scripts/`)

All zero-dependency (node >= 20 stdlib / POSIX sh). Every script has `--help`
with exit codes documented in its header. Never `npm install` to run them.

| Script | Purpose | Key modes | Exit codes |
|---|---|---|---|
| `fork-critical-guard.sh` | FORK-CRITICAL ledger gate (DL-12/DL-10) | `--base/--head` refs (CI), `--staged`/`--pre-commit` (hook), `--worktree`, `--name-only`, `--quiet` | 0 empty · 1 divergence · 2 usage |
| `activation-lint.mjs` | PERF §2.1/§2.2 manifest discipline | `--root/--manifests-glob`, `--allow-event`, `--max-startup`, `--startup-allowed`, `--max-affinity-slots`, `--require-manifests` | 0 clean/SKIP · 1 violation · 2 usage |
| `proposed-api-rota.mjs` | DL-4 proposed-API churn rota (job 5) | `--repo-root`, `--baseline`, `--snapshot`, `--report <dir>`, `--no-fail`, `--require` | 0 clean/SKIP · 1 drift · 2 usage |
| `startup-pair.mjs` | §1.3 startup gates + R6 mark integrity | `--timers-flauz/--timers-upstream`, `--markers-flauz/--markers-upstream`, `--check-marks --src-root`, `--phase-gate --src-root`, `--pairs-file`, `--min-runs` | 0 pass/SKIP · 1 violation · 2 usage |
| `memory-snapshot.mjs` | §3.2 memory budget gate | `--json` (resolveProcesses shape) / `--status` / `--ps`, `--scenario eventually|after-session`, `--enforce`, `--pattern name=regex` | 0 pass · 1 violation · 2 usage |
| `perf-log-parse.mjs` | shared parsers (single source of truth) | `--parse-timers/--parse-markers/--parse-process-json/--parse-status`, `--selftest`; importable module | 0 ok · 1 parse error · 2 usage |
| `verify-fixtures.sh` | the in-sandbox verification matrix (§5) | (no flags) / `--quiet` | 0 all cases as expected · 1 deviation · 2 env error |

**Skip-vs-fail policy** (important): while lanes F/G are in flight, the
zero-dep gates SKIP with a recorded reason instead of failing (empty flauz
union, no flauz manifests, no flauz sources). CI stays green during the
merge window; `--require*` flags flip the skips to failures (used by the
fixture verification below to prove the rules fire).

## 3. Canary specs (`build/flauz/canaries/`)

`C-20.md`, `C-23.md`, `C-24.md`, `C-28.md` — scripted-boot assertion specs for
C's gated rows (matrix `wave1/c`): setup, steps, expected assertions
(boot-level automated today; interactive steps marked **WAITING-ON-LANE F**
riding the golden-path smoke suite), tree citations re-verified @ 9bf9ae76,
drift trip-wires per canary. C-20 cross-refs Worker F's
`build/flauz/canaries/default-agent-checklist.md` when it lands.

## 4. Local runs (no CI, no IDE — sandbox-safe)

```sh
# FORK-CRITICAL guard (refs mode; base auto-resolves upstream/main→origin/main→main)
sh build/flauz/scripts/fork-critical-guard.sh --head HEAD

# pre-commit hook install (MIGRATION §5.1 item 1)
cp build/flauz/scripts/fork-critical-guard.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

# activation lint against the real tree (SKIP notice while lanes are in flight)
node build/flauz/scripts/activation-lint.mjs --root .

# proposed-API rota against the real tree (180 d.ts files at HEAD)
node build/flauz/scripts/proposed-api-rota.mjs --repo-root . --report /tmp/rota

# perf gates against FIXTURES (see §5 receipts for the full matrix)
node build/flauz/scripts/startup-pair.mjs \
  --timers-flauz test/fixtures/perf-timers/flauz-main.timers.tsv \
  --timers-upstream test/fixtures/perf-timers/upstream-main.timers.tsv \
  --markers-flauz test/fixtures/perf-timers/flauz-main.markers.tsv \
  --markers-upstream test/fixtures/perf-timers/upstream-main.markers.tsv

node build/flauz/scripts/memory-snapshot.mjs \
  --json test/fixtures/process-shape/eventually.json --scenario eventually

node build/flauz/scripts/perf-log-parse.mjs --selftest
```

Real IDE boots / real CI execution are OUT OF SCOPE in worker sandboxes
(MIGRATION §5 binding) — the jobs run on GitHub runners once merged.

## 5. Fixture-verification receipts (in-sandbox, 2026-09-25)

Run the whole matrix with one command (expects each case's outcome — a gate
that cannot fail is not a gate):

```sh
sh build/flauz/scripts/verify-fixtures.sh
# → ALL 29 CASES AS EXPECTED (0 deviations)
```

Summary (command class → exit code):

| Check | Result |
|---|---|
| `perf-log-parse.mjs --selftest` | 0 (14 checks) |
| startup-pair timers PASS case | 0 (deltas +23.0/+26.0/+26.0 ms vs budgets +75/+150/+100) |
| startup-pair markers PASS case | 0 (all 4 budget pairs green) |
| startup-pair regressed case (timers+markers) | 1 (row 1 p50 +220 ms, p95 +247 ms; marker delta +154 ms; handshake 678 ms > 500 ms; absent pair) |
| startup-pair too-few-runs case | 1 (invalid measurement, 3 standard runs < 5) |
| check-marks src-ok / src-missing / no-sources | 0 / 1 (3 marks without emit sites) / 0 (SKIP) |
| phase-gate src-ok / src-phase-bad | 0 / 1 (BlockRestore registration) |
| memory-snapshot eventually / after-session / violations / violations+--enforce / --status / --ps | 0 / 0 / 1 (R3+R4+R5) / 1 (+R1) / 0 / 0 |
| activation-lint good / bad (12 files) / bad-set / empty+--require | 0 / 1 (R1-R8 all fired) / 1 (R3 only) / 0 / 1 |
| proposed-api-rota clean / dirty+baseline / real mirror (no lanes) | 0 / 1 (2 absent + registry mismatch + rename signature) / 0 (SKIP) |
| fork-critical-guard refs/staged/name-only vs forbidden src/vs divergence | 1 / 1 / 1 (paths listed) |
| fork-critical-guard on `flauz/wave3/perf-ci` vs `upstream/main` | 0 (EMPTY) |
| `git diff --name-only 9bf9ae764da..HEAD` | ONLY new paths under `build/flauz/`, `test/fixtures/`, `.github/workflows/flauz-*` |
| Workflow YAML validation (python3 + pyyaml 6.0.3) | 4/4 OK + structural checks (triggers/paths/permissions/timeouts/steps, no secrets) |

## 6. Capture contract (memory job)

The PERF §6.1 surface for memory snapshots is `resolveProcesses()`
(`src/vs/platform/process/electron-main/processMainService.ts:26-41`).
`memory-snapshot.mjs --json` consumes exactly that shape **with `mem` fields
already in MB** (the Linux `ProcessItem.mem` is percent-of-total in the raw
tree — converters must apply `os.totalmem() * mem/100`, as
`diagnosticsService.ts` does for `--status`). Until a dump command exists
(lane F), the CI memory job captures the equivalent tree via ps(1) (`--ps`) or
the `--status` text — name-based classification makes the three paths
interchangeable, so the §3.2 assertion layer never changes.

## 7. Measurement closures

See `build/flauz/measure-§8.md` — each PERFORMANCE-PLAN §8 open question
mapped to the exact job + measurement + recalibration act that closes it.

## 8. Known follow-ups (honest list)

- The canaries' interactive assertions (A5/A6 in C-20; A3+ in C-23/24/28) ride
  lane F's session driver — specs marked WAITING-ON-LANE, jobs PROBE-ONLY
  until then.
- The `flauz-perf.yml` prewarm variant (§8 q2 run B) is a workflow_dispatch
  recipe, not a separate knob — see measure-§8.md §q2.
- Runner-class pinning (`ubuntu-24.04` for the pair) is proposed as DL-16.
- `GITHUB_TOKEN` is deliberately NOT passed to the upstream compile&hygiene
  line (no-secrets constraint); if an upstream sub-step ever requires it, the
  job fails loudly → DECISION-LOG proposal for the narrow exception.
