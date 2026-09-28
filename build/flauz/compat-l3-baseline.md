# TL4-008 - Compat L3 baseline (the runtime boot smoke)

Status: SHIPPED-STATION-PENDING-CI-EVIDENCE - the lane exists on branch
`tl4/b3-compat-l3` (base `dcec0f8f7c9686a32a497ee39de72ed9cd533c58`); the
first green `compat-l3` run on main flips this to DONE (SOURCE-OF-TRUTH
completion law).

Driver: `build/flauz/scripts/compat-l3-smoke.mjs` (zero-dep, node >= 20)
Tests: `build/flauz/compat-l3-smoke.test.mjs` (17 cases)
Fixtures: `test/fixtures/compat-l3/`
CI: `.github/workflows/flauz-compat.yml` job `compat-l3`
Spec: `docs/FLAUZ-PROGRAM/TL4-COMPAT-BATTERY.md` section 11.

## 1. What L3 proves

Layers 1-2 (compat-battery.mjs) prove Flauz is additive over Code OSS at the
SOURCE and MANIFEST level. L3 proves the runtime half of the claim: the
workbench still BOOTS and the observable pillar surfaces still function with
the flauz extensions active - on a real compiled tree, on a CI runner
(MIGRATION-PLAN section 5: workers never build; the runner compiles + boots).

The honesty law (binding): a row the driver CANNOT observe is reported as
SKIP with the exact reason - NEVER a fake pass. A smoke that boots less but
asserts truly is better than a fake full boot.

## 2. Row catalogue and census (v1, ADDITIVE)

| Row | Observation channel | PASS-capable today | Notes |
|---|---|---|---|
| `boot.cdp-reachable` | CDP HTTP `GET /json/version` | YES | the workbench was launched with `--remote-debugging-port` |
| `boot.workbench-target` | CDP HTTP `GET /json/list` | YES | a `page` target whose url matches `--target-regex` (default `workbench`) - the workbench.html window |
| `boot.http-reachable` | generic HTTP poll of `--http-url` | YES | wired when a non-CDP endpoint is the readiness signal |
| `boot.exit-clean` | child mode (`--cmd`) natural exit code | YES (child mode only) | attach mode SKIPs: the CI harness owns the process and kills it for artifact capture; a SIGTERM death is not a clean exit |
| `workbench.log-clean` | fatal-pattern scan of the log corpus | YES | conservative defaults (`Unresponsive`, `Fatal error`, `terminated unexpectedly`, `uncaught exception`) + additive `--fatal-regex`; the b-policy-canary A2 pattern, widened |
| `ext.host-started` | log corpus marker | YES | default regex `ExtensionService#_doActivateExtension\|Eager extensions activated`, pinned to `src/vs/workbench/api/common/extHostExtensionService.ts:480,818` (info level - present without `--verbose`) |
| `ext.flauz-activated` | log corpus marker | YES | the L3 positive control: `ExtensionService#_doActivateExtension flauz.*` records; detail enumerates the activated `flauz.flauz-*` ids. Absence = FAIL (Flauz vanished at runtime) |
| `pillar.terminal.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/terminal/browser/terminal.contribution.js` contains `TerminalMainContribution` |
| `pillar.scm.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/scm/browser/scm.contribution.js` contains `id: 'scm'` |
| `pillar.palette.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/quickaccess/browser/quickAccess.contribution.js` contains `CommandsQuickAccess` |
| `pillar.settings.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/preferences/browser/preferences.contribution.js` contains `workbench.action.openSettings` |
| `pillar.notebook.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/notebook/browser/notebook.contribution.js` contains `id: 'notebook'` |
| `pillar.debug.compiled` | compiled-output presence | YES | `out/vs/workbench/contrib/debug/browser/debug.contribution.js` contains `id: 'debug'` |
| `pillar.remote.compiled` | compiled-output presence | YES | `out/vs/platform/remote/common/remoteHosts.js` contains `parseAuthority` |
| `pillar.terminal.functional` | - | NO (SKIP) | terminal panel create + shell execute needs UI automation (lane F session driver) |
| `pillar.scm.functional` | - | NO (SKIP) | SCM view render + stage/commit flow needs UI automation and a git workspace |
| `pillar.palette.functional` | - | NO (SKIP) | palette open + stock command execute needs UI automation |
| `pillar.settings.functional` | - | NO (SKIP) | settings editor open needs UI automation |

Census: 14 PASS-capable rows, 4 always-SKIP functional rows (the honest
distance, section 6). The compiled rows are the spec section 11.3 rung for
notebook/debug/remote (the B-POLICY canary A3 compile-grep pattern) extended
to terminal/scm/palette/settings as the weaker-but-true rung while the
functional smokes wait for the lane F driver; the markers are pinned to
strings present in the pinned source files, so an upstream sync that moves
them FAILs the row (sync-drift tripwire) and updates this table in the same
commit.

## 3. Observation mechanisms (why these are honest)

- **CDP HTTP only, no WebSocket.** The driver speaks `GET /json/version` and
  `GET /json/list` over plain HTTP (node >= 20 global fetch). Target-list
  presence proves the BrowserWindow loaded the workbench page; it does NOT
  prove the DOM composed - that stronger claim needs CDP
  `Runtime.evaluate` over WebSocket (distance list, section 6).
- **Log corpus.** `--log` (the boot stdout/stderr capture - `scripts/code.sh`
  exports `ELECTRON_ENABLE_LOGGING=1` itself) plus `--log-dir` (the
  `--user-data-dir/logs` tree: renderer.log, exthost logs, main.log). The
  extension-host and activation markers are info-level `logService` lines
  from the pinned source, so they land in the logs tree on every default
  boot; the driver polls the corpus during the settle window (activation is
  asynchronous, `onStartupFinished` fires after the workbench is up).
- **Compiled-output greps.** File-exists + marker-substring under
  `--compile-root` (CI wires `out`). Proves the pillar contribution compiled
  into the booted tree - not that it functions (the functional rows say so,
  as SKIP).
- **Child mode.** `--cmd/--arg/--env/--cwd` launches the subject in its own
  process group (detached spawn, group kill SIGTERM then SIGKILL), captures
  stdout/stderr into the corpus automatically and evaluates the natural exit
  code. `boot.exit-clean` PASSes ONLY on a natural exit 0 - a driver-killed
  subject FAILs honestly.

## 4. CI wiring (job `compat-l3` in `.github/workflows/flauz-compat.yml`)

Trigger policy: `workflow_dispatch` (opt-in - the job compiles) PLUS one
weekly `schedule` canary (Mondays 04:23 UTC, off the hour per the
css-order-scan convention) so the runtime claim stays continuously proven;
NEVER on push/PR (compile cost). The weekly schedule also re-runs the cheap
zero-dep L1+L2 job on main - one honest canary of the whole lane. Job 1's
steps are untouched.

Steps (the proven preamble, copied from the sibling lanes):

1. checkout (pinned v7.0.1 SHA, `fetch-depth: 1` - the L3 gate observes
   runtime state, not git history; matches the boot lane it reuses),
   setup-node per `.nvmrc` (pinned v7.0.0 SHA).
2. `restore-node-modules` composite cache (flauz-hygiene.yml shape).
3. apt natives + xvfb/electron libs - the b-policy-canary line (the hygiene
   natives plus `xvfb libgtk-3-0 libgbm1`).
4. `node build/npm/preinstall.ts` then `npm install` (job-level
   `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`,
   `VSCODE_QUALITY=oss`; the install step carries ONLY the auto-provided
   workflow token - the DL-20/DL-28 adjudicated narrow exception, identical
   to flauz-hygiene.yml and flauz-browser.yml).
5. `node build/npm/electronTypes.ts`, then the hygiene compile line verbatim
   (`npm exec -- npm-run-all2 -l core-ci hygiene eslint
   valid-layers-check define-class-fields-check vscode-dts-compile-check
   tsec-compile-check`) - type checks, eslint, layer checks, the CI compile
   bundles. NOTE: `core-ci` emits `out-build`/`out-vscode-min`, NOT the dev
   `out/` tree - so the lane then runs `npm run compile`
   (compile-client: `src` -> `out`), the exact compile step of the proven
   boot lane (flauz-browser.yml b-policy-canary).
6. `bundle-extensions.mjs` + `--verify` - esbuilds the flauz built-ins to
   `extensions/flauz-*/dist/` so boots ACTIVATE them (canary lines).
7. `setup-electron` composite action (arch x64) - puts the electron binary
   at `.build/electron/`.
8. Boot + smoke: xvfb as a service (DISPLAY=:10, the canary + upstream
   pr.yml pattern), `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`,
   then `DISPLAY=:10 ./scripts/code.sh --verbose --user-data-dir <tmp>
   --extensions-dir <tmp> --disable-gpu --disable-telemetry --skip-welcome
   --skip-release-notes --disable-updates --disable-experiments
   --disable-workspace-trust --remote-debugging-port=9333 <empty workspace>
   > artifacts/compat-l3-boot.log 2>&1 &` - then
   `node build/flauz/scripts/compat-l3-smoke.mjs --require --cdp-port 9333
   --log artifacts/compat-l3-boot.log --log-dir <ud>/logs --compile-root out
   --boot-timeout 120000 --settle-timeout 60000 --json
   --out artifacts/compat-l3-report.json` - then the process tree is killed
   ALWAYS (kill + pkill sweep on the user-data-dir path), even on failure.
9. Artifacts upload `if: always()` (pinned v5.0.0-preview SHA): the boot
   log, the pid file, the JSON report. 14-day retention.

The `--extensions-dir` points at an EMPTY temp dir: it isolates user
extension state (no gallery, no downloads). The flauz built-ins activate
from the compiled + bundled in-repo extensions - the canary-proven path
(`npm run compile` + `bundle-extensions.mjs`, built-ins ship in the product;
see the A2 note in flauz-browser.yml).

## 5. First-run record (to be filled by the first CI execution)

| Field | Value |
|---|---|
| First `compat-l3` run URL | _(pending - record the Actions run link)_ |
| Run date / head SHA | _(pending)_ |
| Verdict (exit 0?) | _(pending)_ |
| Row outcomes (PASS/FAIL/SKIP counts) | _(pending - expect 12 PASS / 0 FAIL / 6 SKIP in the CI wiring: cdp 2, exit-clean 1, functional 4 SKIP; log-clean + ext 2 + compiled 7 PASS)_ |
| Boot time to CDP ready | _(pending - expect 10-40 s after first boot)_ |
| Settle time to flauz activation | _(pending - expect 2-15 s)_ |
| Notes / divergences | _(pending - e.g. log-format drift on the ext markers would surface here; tune the default regexes + fixtures in the same commit)_ |

## 6. Honest distance list (the additive ladder)

1. **In-page DOM assertions** - CDP `Runtime.evaluate` over WebSocket
   (`document.querySelector('.monaco-workbench')`, workbench composed).
   Needs a minimal zero-dep WS client in the driver (node stdlib `net` +
   `crypto` masking). Row candidate: `boot.dom-composed`.
2. **Functional pillar rows** - terminal create + shell execute, SCM render
   + stage/commit, palette open + stock command execute, settings editor
   open (spec section 11.3). Need the lane F session driver (key injection);
   the four `pillar.*.functional` rows SKIP until then.
3. **`boot.exit-clean` in CI** - attach mode SKIPs by design (the harness
   kills the tree). A graceful `app.quit()` via CDP (or a child-mode natural
   shutdown) would make the row PASS-capable in the CI wiring.
4. **Editor/a11y/tasks pillars** - no rows yet: their v1 proxy is
   boot + log-clean + the compiled tree (any boot regression surfaces); the
   spec section 5 rows name their real smokes (screen-reader load, task
   run) - all driver-dependent.
5. **Browser-mode boot** (`scripts/code-web` / server build) - not wired;
   the electron-under-xvfb path is the repo's proven boot lane. A
   `boot.http-reachable`-based wiring is the natural extension.
6. **`ext.flauz-activated` depth** - asserts at least one `flauz.flauz-*`
   activation record (the `onStartupFinished` class: agent, workspace, ...).
   Per-view activations (`onView:flauz.*`) are not asserted; opening the
   flauz views needs the driver (item 2).

## 7. Local verification (no build, no boot - sandbox-safe)

```sh
# the driver against the fixture matrix (exit codes pinned)
node build/flauz/scripts/compat-l3-smoke.mjs \
  --log test/fixtures/compat-l3/logs-clean/boot.log \
  --log-dir test/fixtures/compat-l3/logs-clean/userdata-logs \
  --compile-root test/fixtures/compat-l3/fake-out --settle-timeout 300

# the content-level suite (fake CDP servers, child stubs - 17 cases)
node --test build/flauz/compat-l3-smoke.test.mjs

# the whole harness matrix (adds the CLI-level expect cases)
sh build/flauz/scripts/verify-fixtures.sh
```

Real boots remain CI-only (MIGRATION-PLAN section 5 binding). The first
runner run fills section 5; a FAIL on the first run is evidence, not an
embarrassment - record it, fix forward, and flip the spec status only on a
green run.
