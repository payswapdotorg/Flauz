# Flauz core-change budget (TL1-004)

Owner: TL1. Generated 2026-09-27 by Worker A (second dispatch), branch
`feat/tl1-004-core-budget`, base `main @ bfeb5e2df916ff220e750e93ae89e7412d109f19`.

Reference line (READ-ONLY): `upstream/main @ 9bf9ae764da438b1234a8243dc9e47173ef58ee7`
(the preserved Code OSS reference line). At the audited head the product line is
**124 commits ahead, 0 behind**; `git merge-base upstream/main HEAD` is
`9bf9ae764da4` itself, so every diff below is the full accumulated divergence.

Instruments: `build/flauz/scripts/fork-critical-guard.sh` (the FORK-CRITICAL
gate) and `build/flauz/scripts/sync-upstream.mjs --report` (the TL1-001 delta
census; committed copy `build/flauz/UPSTREAM-DELTA.md`). Both zero-dep.

## 1. What this ledger is (the budget law)

ARCHITECTURE-LOCK §4 places Flauz behavior in this preferred order: existing
stable Code OSS API → built-in Flauz extension → separate Flauz service →
additive `src/vs/workbench/contrib/flauz` integration → core/platform patch.
The target is **zero FORK-CRITICAL changes** unless a concrete product
requirement cannot be implemented otherwise.

This ledger is the budget for the LAST two rows — every change to a surface
upstream also owns. Two classes are budget-bearing:

- **SHARED-FILE CHANGE** — an upstream file modified on the product line
  (including `.eslint-allowed-javascript-files`, `.github/workflows`
  modifications of upstream files, any `src/vs` path). Each requires a record
  with the four mandatory ARCHITECTURE-LOCK §4 fields (§3 below).
- **FORK-CRITICAL** — any `src/vs` divergence outside the single additive
  escape hatch `src/vs/workbench/contrib/flauz`. Requires a TL-adjudicated
  DECISION-LOG entry with a demotion alternative before merge; CI fails
  otherwise (the guard is the gate, §5).

Additive paths (files upstream does not have) are **not** budget-bearing —
that is the additive-placement law working as intended — but they are counted
in the census so the budget book balances (§2).

## 2. The upstream-delta census (2026-09-27, @ bfeb5e2df91)

Method (run at the pinned base; `upstream/main` materialized locally at
`9bf9ae764da4` for verbatim ref spelling — in CI the same object is
`origin/upstream/main`):

```sh
git diff --name-status upstream/main...HEAD        # the census input gate
node build/flauz/scripts/sync-upstream.mjs --report --base upstream/main
```

**Headline: 888 paths — 886 ADDITIVE (A) / 2 SHARED-FILE CHANGE (M) /
0 deleted / 0 renamed.** Verdict from the TL1-001 instrument:
`UPSTREAM-DELTA: CLEAN — 886 flauz-owned path(s) added; 2 shared-file
change(s) allowlisted; 0 unallowlisted divergence(s).` (exit 0, enforcing
mode). Every one of the 888 paths is classified by its verified git status
class: `A` = ADDITIVE, `M` = SHARED-FILE CHANGE. The per-path enumeration is
machine-checkable by re-running either command above; families are enumerated
below and the arithmetic is explicit.

### 2.1 Census summary table (path → class → record ref)

| # | Path / namespace | Class | Status | Record |
|---|---|---|---|---|
| 1 | `.eslint-allowed-javascript-files` | SHARED-FILE CHANGE | M (+32/−0) | CB-1 (§3.1) |
| 2 | `AGENTS.md` | SHARED-FILE CHANGE | M (+39/−3) | CB-2 (§3.2) |
| A1 | `.github/workflows/flauz-browser.yml`, `flauz-budgets.yml`, `flauz-canaries.yml`, `flauz-compat.yml`, `flauz-environments.yml`, `flauz-hygiene.yml`, `flauz-perf.yml`, `flauz-resources.yml`, `flauz-rota.yml`, `flauz-security.yml`, `flauz-session.yml`, `flauz-workflow.yml` (12 files) | ADDITIVE | A | — additive namespace (F2-family rule applies if an *upstream* workflow file is ever touched) |
| A2 | `extensions/flauz-agent` (36), `flauz-browser` (44), `flauz-environments` (38), `flauz-models` (21), `flauz-resources` (21), `flauz-workflow` (27), `flauz-workspace` (27) — 214 files | ADDITIVE | A | — preferred placement rows 1–2 of the §4 order |
| A3 | `build/flauz/**` — 44 files (scripts 21, canaries 10, budgets 3, specs 1, README/SYNC-RUNBOOK/UPSTREAM-DELTA 3, allowlists/baselines 6) | ADDITIVE | A | — build/harness namespace |
| A4 | `test/fixtures/**` — 595 files in 18 fixture families: compat-battery 205, resources 75, workflow 62, environments 62, ia-gate 48, browser-policy 30, environments-lifecycle 24, manifests 19, rota 17, premium-ux-gate 14, budget-gate 10, security-gate 7, perf-timers 7, process-shape 5, marks 4, browser-session-journal 4, session-battery-doctored 1, session-battery 1 | ADDITIVE | A | — fixture matrices wired into `verify-fixtures.sh` |
| A5 | `docs/` — 16 files: `FLAUZ-PROGRAM/` (15: ARCHITECTURE-LOCK, CURRENT-STATE, PARALLEL-EXECUTION, SOURCE-OF-TRUTH, WORK-REGISTRY, TL1–TL4 handoffs, TL4-IA-SPEC, TL4-PREMIUM-UX, TL4-COMPAT-BATTERY, TL4-PERF-BUDGETS, TL4-SECURITY-GATE, TL4-SESSION-BATTERY) + `FLAUZ-PRODUCT-LINE-AUTONOMOUS-HANDOFF.md` | ADDITIVE | A | — program control plane |
| A6 | `flauz-delivery/f-agent-bridge/README.md`, `flauz-delivery/f-agent-bridge/REPORT.md`, `flauz-delivery/k-workflow-envelope/REPORT.md` (3 files) | ADDITIVE | A | — transit-staging report artifacts |
| A7 | `product.flauz.json` | ADDITIVE | A | — the product overlay (see §2.2 note) |
| A8 | `FLAUZ-START-HERE.md` | ADDITIVE | A | — repo-root program entry |

Arithmetic: 2 shared-file + 886 additive = 888 rows; A1..A8 sum to
12+214+44+595+16+3+1+1 = 886. Verified by status-class count
(`886 A / 2 M`) and by the TL1-001 instrument verdict.

### 2.2 Classification notes (honest corrections)

- **The wave-3 receipt (`build/flauz/README.md` §5) is stale, and was
  incomplete about the wave-3 head it described.** It recorded "ONLY new
  paths under `build/flauz/`, `test/fixtures/`, `.github/workflows/flauz-*`"
  for `git diff --name-only 9bf9ae764da..HEAD` — true for the wave-3
  integration head of 2026-09-25 (wave3/perf-ci), but the current head has
  six more additive namespaces (A2, A5, A6, A7, A8) and **two shared-file
  changes** (rows 1–2). The TL4 merge-wave note (WORK-REGISTRY 2026-09-27)
  already taught the `.eslint-allowed-javascript-files` lesson; this census
  enumerates **every** shared-file case at the current head: exactly the two
  allowlisted ones. No other upstream file is modified; no upstream workflow
  file is modified (all 12 `.github/workflows` entries are new flauz-*
  files); `src/vs` contributes zero rows (§5).
- **`product.flauz.json` (A7) is additive by path, and its runtime effects
  are realized by the overlay merge** (`build/flauz/merge-product.mjs`,
  null-deletes semantics; decisions DL-16/DL-17/DL-18 recorded in the Lane F
  report) — it is not a core patch and carries no record. Upstream
  `product.json`, `package.json` and every other upstream root file are
  untouched (0 rows in the census).
- **The committed census `build/flauz/UPSTREAM-DELTA.md` is one generation
  stale**: generated 2026-09-27T09:31Z at head `4cee31ec504` (674 added
  paths, 2 shared-file). The current head shows 886/2. Regeneration is the
  TL1-001 lane's own procedure (`sync-upstream.mjs --report --out`); recorded
  as follow-up F-3 (§9). The ledger's numbers above are from the fresh
  instrument run at `bfeb5e2df91`, not from the committed copy.

## 3. Budget records (one per SHARED-FILE CHANGE)

Both records carry the four mandatory ARCHITECTURE-LOCK §4 fields. Both are
registered in `build/flauz/sync-allowlist.json` (the TL1-001 census
suppresses them as intentional divergences — the allowlist entry IS the
machine-readable half of each record).

### 3.1 CB-1 — `.eslint-allowed-javascript-files` (family F2)

Classification: SHARED-FILE CHANGE, upstream hygiene-config data file.
Diff vs `upstream/main`: **+32/−0** — pure line-append in four comment
blocks at the file tail; no upstream line removed or reordered. Flauz-added
allowlist entries: **23** (13 wave-3, 2 wave-4 Lane J, 3 TL4 gates, 5 the
TL1/TL4 batch that includes the upstream-sync lane's own script).

- **Why extension/service APIs are insufficient:** this is not a product
  feature but repo build hygiene. Upstream's ESLint rule
  `local/code-no-new-javascript-files` (`eslint.config.js:3010`, `'error'`)
  fails the hygiene pipeline on any `.js`/`.mjs` file not listed in this
  allowlist — and Flauz's zero-dep gate scripts are `.mjs` (ESM imports,
  `node:test`). No extension or service API can satisfy an ESLint rule; the
  allowlist file **is** upstream's own designed integration point for
  exactly this case (the in-file precedent: upstream's own harness entries).
  The rule fires in the same `Compile & Hygiene` CI step the product line
  inherits from upstream `pr.yml`.
- **Upstream alternative considered:** (a) write the gates in TypeScript
  through the upstream build pipeline — rejected: the gates must run
  fail-fast BEFORE `npm install` (the hygiene workflow runs them first,
  zero-dep), and gating the pipeline with the pipeline inverts the trust
  direction; (b) host gate scripts outside the repo — rejected: gates must
  version with the tree they gate; (c) POSIX `.sh` only — used where it
  fits (`fork-critical-guard.sh` needs no allowlist line), but the census,
  battery and budget tools need ESM imports and `node:test`, i.e. `.mjs`;
  (d) the allowlist line — chosen because upstream itself provides this
  mechanism for new JS files, with the same-PR discipline stated in the TL4
  merge-wave note (WORK-REGISTRY 2026-09-27: every new zero-dep `.mjs` gate
  merged to main must land with its allowlist line in the same PR).
- **Maintenance/merge burden:** per-sync re-check of the Flauz-added lines:
  (i) each line must still map to a live file — dead lines are hygiene debt
  (audit at this head: **23/23 lines map to existing files**, 0 stale);
  (ii) the conflict surface is the tail-append region only — upstream
  edits above it merge cleanly; (iii) every new `.mjs` gate adds one line
  (same-PR rule). Current size: 23 lines of a ~200-line file.
- **Rollback path:** drop the Flauz lines when the scripts are demoted —
  per-line (retire one script → delete its one line in the same PR) or
  wholesale (delete the four blocks; the file reverts to byte-upstream and
  the next eslint run proves it). No product behavior is attached to this
  file, so rollback is pure hygiene mechanics.

Verdict: **KEEP** (§4).

### 3.2 CB-2 — `AGENTS.md` (family F3)

Classification: SHARED-FILE CHANGE, upstream documentation file.
Diff vs `upstream/main`: **+39/−3** — the upstream header block (title
"VS Code Agents Instructions" + 2-sentence intro pointing at
`.github/copilot-instructions.md`) is replaced by the Flauz agent
instructions; the upstream pointer is preserved semantically at the bottom
("For general Code OSS coding/style/testing rules, also follow
`.github/copilot-instructions.md`"). All added content is Flauz program
operating pointers (read order, branch rules, autonomous operation,
architecture, quality).

- **Why extension/service APIs are insufficient:** `AGENTS.md` is the
  repo-root instruction document consumed by AI coding agents that
  auto-load it by cross-tool convention. The file **is** the API — there is
  no extension or service surface that can redirect that discovery. Left
  at upstream content on the product line, every convention-following
  coding agent would operate as if this were stock VS Code: no branch
  policy (main is the product line), no completion law, no work registry,
  no architecture lock.
- **Upstream alternative considered:** (a) keep `AGENTS.md` untouched and
  rely on `FLAUZ-START-HERE.md` alone — rejected as the sole mechanism:
  agents that auto-read `AGENTS.md` would never see a non-conventional
  entry file; (b) symlink to a Flauz doc — rejected: checkout/platform
  fragility for zero gain; (c) append-only pointer under the upstream
  title — considered and superseded by the landed form: the replaced
  header makes the product line's authority order unambiguous from the
  first line an agent reads, while the upstream instructions remain
  reachable through the preserved bottom pointer.
- **Maintenance/merge burden:** upstream `AGENTS.md` is a live (low-churn)
  upstream doc; every sync must re-examine the header region — a
  3-deleted/39-added conflict surface. Because the upstream content is
  semantically preserved (the copilot pointer survives at the bottom),
  most merges resolve to "both sides point at the same instructions";
  worst case is a small manual three-way of the header block. The census
  instrument re-derives this row on every run, so drift cannot land
  silently.
- **Rollback path:** one-commit revert restoring the upstream 3-line
  header (`git checkout upstream/main -- AGENTS.md` shape). Zero product
  code impact; `FLAUZ-START-HERE.md` keeps carrying the program pointers
  independently, so product-line agents retain a (weaker) discovery path.

Verdict: **KEEP** (§4).

## 4. Retirement verdicts

Audited candidates: every budget record (CB-1, CB-2), the escape hatch, and
every `src/vs` row.

| Candidate | Verdict | Action / rationale |
|---|---|---|
| CB-1 `.eslint-allowed-javascript-files` | **KEEP** | Mechanism is upstream's own integration point; 23/23 lines map to live scripts (0 stale — nothing to prune); the lines carry zero product behavior, so there is nothing behavioral to retire. Retirement is mechanical and per-line when a script is demoted; no script is a demotion candidate at this head. |
| CB-2 `AGENTS.md` | **KEEP** | Discovery/redirect function for convention-following coding agents on the product line; upstream pointer preserved; burden small and census-re-derived. Demotion alternative recorded (restore upstream header, rely on FLAUZ-START-HERE.md) for the Lead if the agent-convention audience is ever judged not worth 3 upstream lines — a judgment call, not a defect. |
| Escape hatch `src/vs/workbench/contrib/flauz` | **NOT PRESENT** | The directory does not exist at this head — the hatch is unused; nothing to audit or retire. |
| `src/vs` (all) | **ZERO DIVERGENCE** | 0 census rows; guard PASS (§5). Nothing to retire. |

**Expected-today check, verified honestly: nothing behavioral to retire.**
How verified: (1) `src/vs` is untouched — guard exit 0 and 0 census rows;
(2) both shared-file changes are non-runtime — one is hygiene-gate *data*
(allowlist lines), the other is *documentation*; neither ships in a compiled
product artifact nor changes any Code OSS capability; (3) the allowlist
audit found no dead line (a dead line would be the one mechanical retire
available — none exists); (4) the additive namespace (886 paths) is not
core-patch surface and is out of retirement scope by the placement law.
No retirement is proposed for execution in this PR; none is needed.

## 5. ZERO-FORK-CRITICAL assertion (evidence)

```
$ sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD
fork-critical-guard: PASS — src/vs divergence outside contrib/flauz is EMPTY (upstream/main...HEAD).
fork-critical-guard: FORK-CRITICAL ledger stays EMPTY (DL-12/DL-10).
(exit code 0)
```

Corroborated by the census (0 `src/vs` rows of 888) and by the TL1-001
instrument's independent re-derivation: `PRISTINE src/vs divergence outside
contrib/flauz: NONE (assertion PASS)`. The FORK-CRITICAL ledger is EMPTY at
`bfeb5e2df91`; the escape hatch is unused. **src/vs is pristine.**

## 6. Guard integrity fix (`flauz-hygiene.yml`) — defects found and fixed

The program reset (2026-09-27) moved the product line to `main` with the
Code OSS reference at `upstream/main`, but the CI wiring still described the
pre-reset topology. Two defects, both fixed surgically in
`.github/workflows/flauz-hygiene.yml` only:

- **(a) Push-trigger bypass.** `on.push.branches` was `[flauz/main]` only.
  Post-reset, `main` is the product line and `flauz/main` is a compatibility
  alias (CURRENT-STATE §Branch state) — so **every direct push to `main`
  bypassed the entire hygiene gate** (fork-critical guard, activation lint,
  IA gate, premium-UX gate, compile + upstream hygiene, Flauz unit subset).
  Only PRs targeting `main` exercised the lane.
  **Fix:** `branches: [flauz/main, main]` (dated comment in-file).

- **(b) Wrong "pristine base" identity.** The "Fetch pristine base" step
  fetched `origin main` (pre-reset that WAS the upstream mirror — the old
  step name says "main = upstream mirror, DL-12") and ran the guard with
  `--base origin/main`. Post-reset `origin/main` is the **product branch**:
  on a push event `origin/main...HEAD` is empty (guard passes vacuously);
  on a PR it is the PR delta only. In neither case did CI ever check the
  product line's **accumulated** `src/vs` divergence vs upstream — the exact
  thing the guard exists to enforce (DL-12/DL-10, MIGRATION-PLAN §5.1). Note
  the guard script's own default chain (`upstream/main → origin/main →
  main`) has the same trap in CI: the short name `upstream/main` does not
  resolve on a runner (there is no remote named `upstream`; the reference is
  the origin branch `upstream/main`, materialized as
  `refs/remotes/origin/upstream/main`), so the chain settles on
  `origin/main` = product. The workflow's explicit `--base origin/main`
  masked this.
  **Fix:** the step now fetches the true reference with the exact pattern
  the workflow's own `upstream-sync` job already uses
  (`git fetch --no-tags origin upstream/main:refs/remotes/origin/upstream/main`,
  belt-and-braces over the `fetch-depth: 0` checkout) and the guard runs
  `--base origin/upstream/main --head HEAD` — the same ref spelling
  `flauz-compat.yml` already uses for its pristine side. The step name now
  states the true identity. With merge-base = `9bf9ae764da` (0 behind),
  `origin/upstream/main...HEAD` is the full accumulated divergence, so the
  guard finally measures what it asserts.

**Everything else untouched:** `pull_request` triggers, path filters,
`workflow_dispatch`, permissions (`contents: read`), concurrency, env, both
jobs' step lists and order (hygiene 16 steps, upstream-sync 4 steps), and
all five sibling CI workflows (out of scope by the work order's hard
constraint — see F-1 in §9).

**YAML verification** (python3 + pyyaml 6.0.3, the README §5 receipt
method): parse OK plus structural checks — push branches
`[flauz/main, main]`, pull_request unchanged `[flauz/main, main]`, paths
unchanged (4), `workflow_dispatch` present, permissions `contents: read`,
2 jobs (hygiene 16 steps / upstream-sync 4 steps, timeouts 60/10), guard
step `--base origin/upstream/main`, fetch step byte-mirrors the
upstream-sync job's fetch, compile line and the pre-existing deliberate
auto-token exception unchanged. Verbatim gate:
`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/flauz-hygiene.yml')); print('YAML OK')"`
→ `YAML OK`.

## 7. Per-family template for future core patches

A core-patch proposal is a filled record, not a blank page. Copy the form,
fill every field, append under §3 as CB-<n>, add the census-table row, and
land the `sync-allowlist.json` entry in the same PR.

```markdown
### CB-<n> — <path> (family <F#>, <one-line what>)

Classification: SHARED-FILE CHANGE | FORK-CRITICAL (family F#)
Diff vs upstream/main @ <base sha>: +<adds>/−<dels> (shape: line-append |
header-replace | edit | new-file-in-shared-dir)

- Why extension/service APIs are insufficient:
  <concrete attempt at API/extension/service placement and why each fails
  for THIS requirement — cite the surface tried>
- Upstream alternative considered:
  <the upstream mechanism evaluated (overlay, allowlist, config, stable API)
  and why it was rejected or chosen>
- Maintenance/merge burden:
  <conflict surface in lines; per-sync re-check duty; who re-audits (this
  ledger + sync census); growth rate>
- Rollback path:
  <the one-commit revert or line-drop that removes the divergence; proof
  that no product behavior depends on it>
- Guard impact: fork-critical-guard.sh outcome at the head (verbatim);
  escape-hatch involvement (src/vs/workbench/contrib/flauz) if any
- Sync-allowlist entry: { path, reason, date } — required in the same PR
- Approval: <TL/Lead sign-off: PR # / DECISION-LOG entry> — a FORK-CRITICAL
  record additionally requires the DECISION-LOG entry with a named demotion
  alternative BEFORE merge (the guard enforces this)
```

Family rules (the bar each family must clear):

| Family | Surface | Bar / discipline |
|---|---|---|
| **F1** | `src/vs/workbench/contrib/flauz` (the escape hatch) | Guard-clean but budget-bearing: only when rows 1–3 of the placement order are proven insufficient; requires a DECISION-LOG entry with a demotion alternative; additive files only inside the dir; this ledger records it even though the guard passes it. |
| **F2** | Upstream hygiene/config data files (`.eslint-allowed-javascript-files` class) | Line-append only, never remove/reorder upstream lines; same-PR discipline (TL4 merge-wave note); per-sync liveness re-check of every line. |
| **F3** | Upstream documentation files (`AGENTS.md` class) | Semantically preserve the upstream content's function; state the preserved pointer; keep the conflict surface as small as the redirect requires. |
| **F4** | Upstream CI/workflow files (non-flauz `.github/workflows/*`) | Preserve upstream action-SHA pinning and the no-secrets policy; prefer a NEW `flauz-*.yml` (additive, A1 family) over editing an upstream workflow — editing one requires this record plus a TL decision. |
| **F5** | Upstream root manifests (`product.json`, `package.json` class) | Use the overlay (`product.flauz.json` + `merge-product.mjs`, decisions DL-16/17/18) — direct manifest edits are the last resort and need both the record and a merge-conflict plan for every upstream manifest bump. |

## 8. Evidence — verification gates (verbatim, 2026-09-27)

```
$ git diff --name-status upstream/main...HEAD | head -80
M	.eslint-allowed-javascript-files
A	.github/workflows/flauz-browser.yml
... (80-line head of the 888-row census; full classification in §2)
$ sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD
fork-critical-guard: PASS — src/vs divergence outside contrib/flauz is EMPTY (upstream/main...HEAD).
fork-critical-guard: FORK-CRITICAL ledger stays EMPTY (DL-12/DL-10).      (exit 0)
$ python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/flauz-hygiene.yml')); print('YAML OK')"
YAML OK                                                                  (+ structural checks, §6)
$ sh build/flauz/scripts/verify-fixtures.sh
verify-fixtures: ALL 105 CASES AS EXPECTED (0 deviations)                 (exit 0)
```

TL1-001 gates (the sync lane landed at this base — run and cited per the
work order):

```
$ node build/flauz/scripts/sync-upstream.mjs --report --base upstream/main
UPSTREAM-DELTA: CLEAN — 886 flauz-owned path(s) added; 2 shared-file change(s) allowlisted; 0 unallowlisted divergence(s).   (exit 0)
$ node --test build/flauz/sync-upstream.test.mjs
ℹ tests 12  ℹ pass 12  ℹ fail 0                                        (exit 0)
```

(The 105-case fixture count vs the 104 recorded in the TL4-006 note: the
matrix's fork-critical refs case activates when a local `upstream/main` ref
exists — the TL1-001 README §5 addendum documents this conditional case;
81-without/105-with at this head.)

## 9. Known limitations and follow-ups (for the Lead)

- **F-1 — sibling push triggers.** All 11 other `flauz-*.yml` workflows
  still carry the stale `push: branches: [flauz/main]` (verified by scan at
  this head) — the same defect (a) fixed here for `flauz-hygiene.yml`. Out
  of this work order's scope by the hard constraint (one surgical workflow
  fix); each is a one-line change plus a dated comment. The Lead should
  schedule them as one small PR family.
- **F-2 — machine-checkable ledger validator.** This ledger is
  human-auditable and census-cross-checked, but no script validates
  "every shared-file change has a record with the four fields" (e.g. a
  `core-budget-gate.mjs` consuming the census + `sync-allowlist.json` +
  this document's CB records). Recorded as follow-up per the work order;
  it must land with its `.eslint-allowed-javascript-files` line in the
  same PR (CB-1 discipline).
- **F-3 — refresh `build/flauz/UPSTREAM-DELTA.md`.** The committed census
  is one generation stale (674 paths @ `4cee31ec504` vs 886 @
  `bfeb5e2df91`). Regenerate via the TL1-001 procedure
  (`sync-upstream.mjs --report --out`) on the next sync-lane touch.
- **F-4 — path-filter residual gap.** The hygiene lane's `paths` filters
  (unchanged, per the surgical scope) mean a change touching ONLY
  non-filtered paths (e.g. `src/vs`) still triggers no flauz CI lane.
  Mitigations today: the PR review gate, the pre-commit hook variant of
  the guard, and the sync census. Closing it (adding `src/vs/**` to the
  filters) changes CI cost/behavior and is a Lead decision, not a
  surgical fix.
- **F-5 — AGENTS.md header judgment.** The demotion alternative for CB-2
  (restore the upstream header, rely on FLAUZ-START-HERE.md alone) is
  recorded in §3.2; whether the agent-convention audience is worth 3
  upstream lines is a standing Lead call, re-openable at any sync.
