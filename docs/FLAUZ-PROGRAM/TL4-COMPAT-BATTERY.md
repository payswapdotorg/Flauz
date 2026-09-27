# TL4-003 — Code OSS Compatibility Battery

Status: ACTIVE (Worker B, TL4 lane). Layers 1-2 implemented + fixture-backed;
L3 SHIPPED-STATION-PENDING-CI-EVIDENCE (TL4-008: real `compat-l3` CI lane +
zero-dep driver `build/flauz/scripts/compat-l3-smoke.mjs`, baseline
`build/flauz/compat-l3-baseline.md`; the first green run on main flips it).
Script: `build/flauz/scripts/compat-battery.mjs` · Fixtures: `test/fixtures/compat-battery/`
CI: `.github/workflows/flauz-compat.yml` · Baseline: `build/flauz/compat-baseline.md`

## 1. Problem and decision

Nothing machine-checked "Flauz only ADDS to Code OSS". The fork-critical guard
covers `src/vs` source purity only. The contribution surfaces (commands, views,
menus, keybindings, configuration, viewsContainers, submenus) of the ~100
stock built-in extensions, the product identity (`product.json`) and the root
`package.json` scripts/dependencies had NO regression battery: a Flauz change
could silently delete a stock command or configuration property and nothing
would fail.

Decision: a three-layer battery. Layer 2 (manifest-level contribution diff) is
the core of this task because it runs anywhere (zero-dep, no build, git
plumbing + JSON only) and catches the highest-risk silent-regression class.
Layer 3 (runtime smoke) is spec'd but pending a compiled build on CI.

## 2. Layer model

| Layer | What it proves | Status | Where |
|---|---|---|---|
| L1 source purity | `src/vs` byte-identical to upstream outside `contrib/flauz` | EXISTS (Wave 3 Lane H) | `fork-critical-guard.sh`; the battery INVOKES it (git mode only) |
| L2 contribution-surface diff | every stock manifest entry, product identity, root scripts/deps present at the product side | IMPLEMENTED (this task) | `compat-battery.mjs` |
| L3 runtime smoke | the workbench still boots and the pillar surfaces still function with Flauz extensions active | SHIPPED-STATION-PENDING-CI-EVIDENCE (TL4-008: `compat-l3` job in `flauz-compat.yml`, workflow_dispatch + weekly schedule; driver `compat-l3-smoke.mjs`, baseline `build/flauz/compat-l3-baseline.md`; first green run on main flips it) | `compat-l3-smoke.mjs` + `.github/workflows/flauz-compat.yml` job `compat-l3` |

Declarative contributions inside `src/vs/workbench/**` (e.g. editor
contributions registered in TS) are OUT OF L2 SCOPE by design: they compile
into the workbench binary, cannot be diffed as manifests, and are already
covered by L1 (byte-identical `src/vs`) plus the future L3 boot smoke. This is
not a coverage hole: any change to them is either an L1 violation or a
legitimate adjudicated core patch.

## 3. The L2 contract

### 3.1 The rule

**Flauz may ADD, must never REMOVE, RENAME or RETYPE stock contribution
entries.**

- REMOVED: a stock key exists at the upstream side but not at the product side.
- RENAMED: the id changed — detected as REMOVED of the old key (the new id is
  a mere addition). Example: view `npm` under container `explorer` appears
  under `scm` instead → `views/explorer/npm` is REMOVED.
- RETYPED: the entry moved families (a command id that only survives as a
  keybinding target) — detected as REMOVED from its original family.
- Additions anywhere (new keys, new families on a stock manifest, new
  `product.json` keys, new scripts/deps) are ALLOWED and counted
  (`additionsAllowed`), never failing.

One extra rule beyond pure "stock must survive": an extension manifest ADDED
at the product side OUTSIDE the `flauz-*` namespace is a VIOLATION
(additive-placement law, ARCHITECTURE-LOCK sections 4/6). Flauz code lives in
Flauz paths; a new stock-namespaced extension would silently ride an upstream
sync into conflict. Bless intentional cases via the allowlist (section 7).

### 3.2 Stock vs Flauz — the namespace determination

- Stock = everything at the upstream side (`origin/upstream/main` by default).
- Flauz-owned path prefixes: `extensions/flauz-*/`, `build/flauz/`,
  `src/vs/workbench/contrib/flauz/`, `product.flauz.json` (vs `product.json`),
  `docs/FLAUZ-PROGRAM/`, `test/fixtures/`.
- The battery never falls back to a product branch as the upstream side:
  default is `origin/upstream/main` then `upstream/main` ONLY. Product-vs-
  product would vacuously pass — the single most dangerous misconfiguration
  for this gate, so it is impossible by construction.

### 3.3 Families covered (REQUIRED set) and key normalization

Extraction from each stock `extensions/*/package.json` (both sides via
`git show <ref>:<path>`, or direct reads in fixture tree-mode):

| Family | Manifest shape | Battery key |
|---|---|---|
| `commands` | `contributes.commands[].command` | `commands/<command-id>` |
| `keybindings` | `contributes.keybindings[]` | `keybindings/<command>\|<key>\|<mac>\|<linux>\|<win>\|<when>` (absent fields = `''`) |
| `menus` | `contributes.menus` object keys | `menus/<menu-location>` |
| `views` | `contributes.views` = `{container: [{id}]}` | `views/<container>/<view-id>` |
| `viewsContainers` | `contributes.viewsContainers` = `{location: [{id}]}` | `viewsContainers/<location>/<container-id>` |
| `configuration` | object form `{properties}` OR array form `[{properties}]` | `configuration/<property-path>` |
| `submenus` | `contributes.submenus[].id` | `submenus/<submenu-id>` |

Plus manifest-level rows: `manifest` (present + parses / deleted / added
outside flauz-*), and the rows of sections 4-5.

## 4. Identity rows

### 4.1 product.json (spec: one row per top-level stock key, `identity/<key>`)

Flauz intentionally renames identity keys. The battery does NOT hardcode the
allowed set — it EXTRACTS it from `product.flauz.json` at the product side
(the overlay is the single source of Flauz identity truth; current set:
`nameShort`, `nameLong`, `version`, `extensionEnabledApiProposals`,
`defaultChatAgent`):

- stock key identical at product side → PASS;
- changed BUT inside the overlay identity set → PASS (recorded);
- changed outside the set → FAIL (`fail-product-identity` fixture);
- REMOVED at product side → PASS only if the overlay sets it to `null`
  (merge-product.mjs null-deletes semantics — the overlay is the only blessed
  way to delete a stock product key); otherwise FAIL;
- key order differences do not count (stable deep-compare).

### 4.2 Positive control (spec section 5)

The battery FAILS if Flauz itself vanished: `product.flauz.json` must exist
and each of the six built-ins (`flauz-agent`, `flauz-browser`,
`flauz-environments`, `flauz-models`, `flauz-workflow`, `flauz-workspace`)
must have a manifest at the product side. The six-name list is a positive
control constant: extend it and this spec in the same commit when Flauz grows
a seventh built-in.

### 4.3 Root package.json

`scripts`, `dependencies`, `devDependencies` — NAME-PRESENCE rows only
(`package.json/<section>/<name>`). Removing a stock script or dependency name
is a violation; version/value changes are NOT flagged (they ride the upstream
sync). Additions are allowed. Deeper root-package drift (engines, scripts
content) is deferred (section 12).

## 5. Coverage matrix — Code OSS pillar → battery rows

| Pillar (ARCHITECTURE-LOCK §2) | L1 | L2 rows protecting it today | L3 spec (section 11) |
|---|---|---|---|
| Editor & language tooling | ✓ | `configuration/*` (css/ts/json languages…), `commands/*` of editor-carrying exts | boot + open/edit/save smoke |
| Terminal | ✓ | terminal ext manifests: `terminal*` families deferred; `commands`, `configuration` covered | terminal panel opens, shell executes |
| SCM (git) | ✓ | git ext: 24 commands, 111 config props, 2 keybindings, 10 menu locations, 5 submenus (L2 baseline) | stage/commit flow smoke |
| Debugging | ✓ | debug-auto-launch / debug-server-ready manifests (`commands`, `configuration`) | launch.json run smoke |
| Tasks/launch | ✓ | taskDefinitions family deferred (§12); `configuration`/`commands` of contributing exts covered | task run smoke |
| Extensions | ✓ | ALL 96 stock manifests `manifest` rows (deletion = FAIL); positive control (six flauz built-ins) | extension list + activation smoke |
| Notebooks | ✓ | notebook ext manifests: `commands`, `configuration`, `views` covered; notebookRenderer family deferred | notebook open/execute smoke |
| Settings/profiles | ✓ | `configuration/*` (762 props, L2 baseline) across 25 exts | settings editor smoke |
| Accessibility | ✓ | settings surface rows (above); a11y runtime = L3 | screen-reader load smoke |
| Command palette | ✓ | `commands/*` (495 ids) + `menus/commandPalette` + `submenus/*` (L2 baseline) | palette open/execute smoke |
| Remote/workspace | ✓ | remote-ish ext manifests (ssh/tunnel server config via `configuration` rows); L1 keeps src/vs pristine | remote authority boot smoke |

Every L2 row class in this table has a fixture proving it can FAIL
(section 9); L1 has its own fixture cases (Wave 3 receipts). L3 rows are the
promotion ladder rung that converts these static guarantees into runtime ones.

## 6. Layer 1 in the battery

Git mode (both sides git refs): the battery runs
`sh build/flauz/scripts/fork-critical-guard.sh --repo <root> --base <upstream> --head <product>`
and maps guard exit 0 → L1 PASS row, exit 1 → L1 FAIL row (offending paths in
the detail), anything else → FAIL (guard could not run). Tree mode (fixture
sides): L1 emits a documented SKIP (no git history to diff); `--require`
escalates that SKIP to a failure. L1 divergence can NEVER be suppressed by
the compat allowlist — src/vs divergence is adjudicated by the fork-critical
DECISION-LOG process, not by this battery.

## 7. Allowlist — `build/flauz/compat-allowlist.json`

Intentional L2 divergences ONLY. Format (empty at delivery):

```json
{ "entries": [ { "path": "extensions/git/package.json", "key": "commands/git.commit",
                 "reason": "<why stock was intentionally changed>", "date": "YYYY-MM-DD" } ] }
```

- Matching is exact on `(path, key)` against FAIL rows of layer 2.
- A matched row becomes PASS with `allowlisted: true` and the reason recorded.
- Malformed entries or file → usage error (exit 2): an allowlist that cannot
  be parsed must never silently no-op.
- Unused entries are reported (count) — hygiene signal to prune stale entries.
- Review rule: every entry needs a justification a TL can re-read later; the
  date enables stale-entry sweeps at sync checkpoints (DL-11 cadence).

## 8. Script reference

```
node build/flauz/scripts/compat-battery.mjs
  [--root <dir>] [--upstream <git-ref|dir>] [--product <git-ref|dir>]
  [--allowlist <file>] [--json] [--layer 1|2|all] [--no-fail] [--require]
```

- Sides: git ref (resolved in `--root`'s repo) or a plain directory tree
  (fixture mode — required so fixtures need no git history).
- Defaults: `--root` = the script's own repo; `--upstream` =
  `origin/upstream/main` (then `upstream/main`); `--product` = `HEAD`;
  `--allowlist` = `<root>/build/flauz/compat-allowlist.json` when present.
- Exit codes: 0 clean/SKIP-only (or `--no-fail`) · 1 violations (or SKIPs
  under `--require`) · 2 usage/bad side/malformed allowlist.
- `--json`: full machine table — meta (resolved sides, identity set,
  allowlist stats, counts) + rows `{layer, path, key, status, detail}`.
- Human mode: header, per-layer summaries, FAIL rows (capped at 50 + pointer
  to `--json`), verdict line.

## 9. Fixture matrix (test/fixtures/compat-battery/)

A fixture = two minimal fake repo trees (`upstream/` + `product/`; the
product side carries the six flauz built-ins + `product.flauz.json` unless
the case removes them). All wired into `verify-fixtures.sh`:

| Fixture | Divergence | Expected exit |
|---|---|---|
| `clean-additive` | new flauz ext + additive stock commands/config/scripts/deps/product keys | 0 |
| `fail-removed-command` | stock `git.commit` deleted | 1 |
| `fail-removed-config` | stock `git.autofetch` deleted | 1 |
| `fail-removed-keybinding` | stock keybinding tuple deleted | 1 |
| `fail-removed-menu` | stock `scm/title` menu location deleted | 1 |
| `fail-removed-submenu` | stock `git.commit` submenu deleted | 1 |
| `fail-retyped-view` | stock view `npm` moved `explorer` → `scm` | 1 |
| `fail-removed-viewscontainer` | stock `npm-explorer` container deleted | 1 |
| `fail-deleted-extension` | stock extension manifest missing | 1 |
| `fail-product-identity` | `urlProtocol` changed outside identity set | 1 |
| `fail-root-script-removed` | stock script + dependency removed | 1 |
| `fail-non-flauz-addition` | new manifest outside `flauz-*` | 1 |
| `flauz-vanished` | no flauz exts, no overlay (positive control) | 1 |
| `allowlist-case` | same as removed-command + allowlist entry (plus the same case WITHOUT the list → 1) | 0 / 1 |

Plus matrix rows for `--require` escalation (tree SKIP → 1), `--no-fail`
(violations → 0), usage error (→ 2) and the real-repo run
(`origin/upstream/main` vs `HEAD` `--require` → 0 on current main).

## 10. CI wiring — `.github/workflows/flauz-compat.yml`

Follows `flauz-hygiene.yml` conventions: ubuntu-latest, actions pinned to the
same SHAs, no secrets, `permissions: contents: read`, path filters
(`build/flauz/**`, `test/fixtures/compat-battery/**`, `extensions/**`,
`product*.json`, the workflow itself) + `workflow_dispatch`. Checkout uses
`fetch-depth: 0` so `origin/upstream/main` resolves. Steps: battery
`--require` against `origin/upstream/main` vs `HEAD`, then the full fixture
matrix via `verify-fixtures.sh`. The `compat-l3` job (TL4-008) is the real
runtime gate per section 11: it compiles on the runner (the hygiene compile
line + the dev `out/` compile + flauz bundling), boots the workbench
headless under xvfb (the b-policy-canary launch pattern) and runs
`compat-l3-smoke.mjs --require` against the booted instance, gated to
`workflow_dispatch` + a weekly `schedule` canary (compile cost), never on
push/PR.

## 11. L3 runtime smoke - spec (SHIPPED-STATION-PENDING-CI-EVIDENCE)

Promotion requirements (all now hold on the TL4-008 lane; they were the
gating checklist before any assertion wired into CI):

1. A CI job that compiles the workbench (upstream pipeline: `npm install` +
   `npm run compile` + flauz extension bundling, as `flauz-browser.yml`
   already demonstrates) — NOT possible in worker sandboxes (MIGRATION-PLAN
   §5 binding).
2. Boot the product headless/under xvfb with a temp user-data-dir and the
   flauz extensions active.
3. Pillar smoke assertions (one per pillar row in section 5): workbench
   window up (no `Unresponsive|Fatal error` in the log), terminal panel
   creates + executes a shell, SCM view renders with a git repo open,
   command palette executes a stock command, settings editor opens,
   notebook + debug + remote rows start as PROBE-ONLY greps of the compiled
   output (the B-POLICY canary A3 pattern) until a driver exists.
4. Fixture-first: each L3 assertion gets a fixture-checked parser (the
   `perf-log-parse.mjs --selftest` pattern) BEFORE it gates CI.

Promotion record (TL4-008, branch `tl4/b3-compat-l3`, base `dcec0f8f7c9`):
the lane shipped. `compat-l3` in `.github/workflows/flauz-compat.yml`
compiles (hygiene compile line + `npm run compile` for the bootable `out/`
+ `bundle-extensions.mjs --verify`), boots under xvfb via
`./scripts/code.sh` with a temp user-data-dir and the flauz built-ins
active, and runs the zero-dep driver
`build/flauz/scripts/compat-l3-smoke.mjs --require` (CDP readiness +
workbench target, log-corpus fatal scan, extension-host + flauz activation
markers source-pinned to extHostExtensionService.ts:480,818, compiled
pillar rows in the B-POLICY A3 pattern). The driver's honesty law: a row it
CANNOT observe is SKIP with the exact reason, never a fake pass - the v1
census (14 PASS-capable rows, 4 functional SKIP rows) and the additive
distance ladder live in `build/flauz/compat-l3-baseline.md` (sections 2
and 6). Driver logic is fixture-backed: `test/fixtures/compat-l3/` +
`build/flauz/compat-l3-smoke.test.mjs` (17 cases) + the
`verify-fixtures.sh` matrix. Trigger policy: `workflow_dispatch` (opt-in)
+ one weekly `schedule` canary, never per-push (compile cost).

Status today: the lane exists and is fixture-backed; the FIRST green CI
run on main flips this section and the layer table to DONE-for-the-rung.
Honest ladder position: L1/L2 = fixture-backed and CI-enforced; L3 =
lane-shipped, pending first runner evidence (section 5 of the baseline is
the record to fill).

## 12. Deferred families and follow-ups (honest list)

Deferred L2 families (documented, not silently ignored — additions in these
families are allowed; removals are NOT yet caught):

- `languages`, `grammars`, `snippets`, `themes`, `iconThemes`,
  `productIconThemes`, `colors` — asset-registry families; removal hides UI
  surface without breaking boot. Next battery revision.
- `taskDefinitions`, `problemMatchers`, `problemPatterns`, `breakpoints`,
  `debuggers` — task/launch registration families (pillar: tasks/launch).
- `notebookRenderer`, `customEditors`, `walkthroughs`, `viewsWelcome`,
  `chatParticipants`, `languageModelTools` and other chat/model families —
  newer surfaces with churning shapes; wait for the L2 schema to stabilize
  upstream before pinning key normalization.
- Root `package.json` deeper sections (engines, main, scripts CONTENT).

Follow-ups:

- L3 evidence + deepening: the first green `compat-l3` run on main fills
  `build/flauz/compat-l3-baseline.md` section 5 and flips the section 11
  status; then the additive ladder (baseline section 6): CDP-WebSocket DOM
  assertions, the four functional pillar rows via the lane F session
  driver, exit-clean in the CI wiring, browser-mode boot.
- Family sweep for the deferred list, each landing WITH its fail fixture.
- Allowlist staleness sweep wired into the sync-checkpoint reminder (rota
  job 6 pattern).
- Cross-check the identity set: battery could additionally verify the merged
  product (merge-product.mjs output) against the committed product.json
  posture — currently the battery verifies the checked-in file only, which
  matches the v0 packaging story (overlay applied at build time).
