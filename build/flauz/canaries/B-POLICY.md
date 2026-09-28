# Canary B-POLICY — policy-gated browser pane: blocked at ALL layers

- **Lane (wave 4 / I)**: browser policy engine + partition model +
  blocked-at-all-layers verification story
  (`extensions/flauz-browser`, branch `flauz/wave4/browser-policy`).
- **Spec basis**: `docs/BROWSER-ARCHITECTURE.md` section 5 (flauz-code-lab
  branch `wave1/b-browser-ux`) — the B1c finding: **CDP-initiated
  navigations BYPASS `will-navigate`**, `webRequest` cancels content
  (`ERR_BLOCKED_BY_CLIENT`) but the URL still commits, therefore layered
  gates are mandatory; partition naming `persist:<workspace>` proven live.
  DL-6 (browser adoption posture: driver-side allowlist AUTHORITATIVE +
  webRequest + will-navigate + per-workspace/agent partitions);
  `docs/SECURITY-MODEL.md` section 4 (layer table L1-L7, hardening F1-F4).
- **Tree evidence (verified @ 67b0b081de0a, src/vs pristine per DL-12)**:
  - L1 driver gate: `src/vs/workbench/contrib/browserView/electron-browser/tools/navigateBrowserTool.ts:62-116`
    (`prepareToolInvocation` -> `getBrowserNetworkPolicyError` throws BEFORE
    navigation, `:100-103`; re-checked in `invoke`, `:134-137`) +
    `tools/browserToolHelpers.ts:226-242`.
  - L2 webRequest: `src/vs/platform/browserView/electron-main/browserSession.ts:310-330`
    (`updateNetworkFilter` installs `webRequest.onBeforeRequest` on
    Agent-scope sessions only, `:311`); propagation
    `browserViewMainService.ts:81-83` -> `browserSession.ts:119-129`;
    filter semantics `src/vs/platform/networkFilter/common/networkFilterService.ts:103-127`
    + `domainMatcher.ts:257-275`.
  - L3 will-navigate (UX only, by design): `src/vs/platform/browserView/electron-main/browserView.ts:328-344`.
  - L4 partitions: `browserSession.ts:134-180` (global `persist:vscode-browser`
    `:135`, workspace path-backed `:143-148`, ephemeral `:153-162`, agent
    in-memory `vscode-browser-agent-<sha256(identity)>` `:165-180`).
  - Settings surface: `chat.agent.networkFilter` / allowed/denied domains at
    `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts:1548-1590`
    (default false, APPLICATION scope, restricted, enterprise policy
    `ChatAgentNetworkFilter`).
  - Proposed extension-driven control: `src/vscode-dts/vscode.proposed.browser.d.ts:64-91`
    (`window.openBrowserTab`, `BrowserTab.startCDPSession`).
- **Extension under test**: `extensions/flauz-browser` (policy engine
  `src/policy.ts`, command surface `src/extension.ts`, policy source
  `.flauz/browser-policy.json`, schema `flauz.browser-policy/v0`; as of
  TL3-001 also the browser RUNTIME — `src/cdp/`, `src/runtime/` — sessions,
  policy-gated navigation, capture, recovery).
- **Owner CI**: `.github/workflows/flauz-browser.yml` -> job `b-policy-canary`
  (+ job `b-policy-unit` for the zero-dep `node --test` suites, which include
  the TL3-001 runtime suites; and the A-class driver drill
  `test/canaries/policy-gated-navigation.drill.ts` in the unit job).
- **WORKBENCH BOOT DRILL (TL3-H2)**: job `b-policy-boot-drill` in the same
  workflow — the REAL workbench driver that closed the A4/A6/A10
  "stays boot-level" notes as far as the architecture allows. See the
  "Workbench boot drill" section below (the driver mechanism, the row
  catalogue, the honest SKIP rows).
- **OPTIONAL real-endpoint drill (TL3-003, NOT CI-required)**:
  `extensions/flauz-browser/test/canaries/real-chromium-hardening.drill.ts`
  — the real-Chromium verification of the runtime + hardening the fake drill
  cannot provide ("the FakeCdpTransport pins the shapes, not Chromium's
  behavior"). See the "Optional real-endpoint drill" section below.

## Setup

1. Same build recipe as C-20 (`npm run compile`, then
   `node build/flauz/scripts/bundle-extensions.mjs` so boots ACTIVATE the
   flauz built-ins — the round-16 first-CI finding).
2. Preconditions (glob-probed): `extensions/flauz-browser/package.json`
   present (PROBE-ONLY mode until the lane merges), `product.flauz.json`
   present.
3. Workspace fixture: a temp folder carrying
   `.flauz/browser-policy.json` with a RESTRICTIVE driver allowlist
   (`*.example.com`) and matching webRequest/willNavigate rules — the
   exact matrix of `test/fixtures/browser-policy/cdp-bypass-cases.json`
   policy `base`. The boot opens this folder.

## Steps (scripted boot + layered-gate run)

1. Boot with verbose logging, the fixture workspace, a fresh user-data-dir,
   and the networkFilter default-on posture for the canary profile:
   settings.json in the user-data-dir pins
   `"chat.agent.networkFilter": true` (canary scope only; the product default
   flip is flauz-defaults config, INTEGRATION-GAP.md G3/P1).
2. Pre-boot zero-dep engine assertion: the workspace fixture policy parses
   cleanly through the REAL engine (`node --input-type=module` importing
   `extensions/flauz-browser/src/policy.ts` -> `parsePolicyText`) and a CDP
   nav to `https://evil.org/pay` under it yields
   `deny/driver/agent-tool` — the same matrix the unit job pins without a
   browser.
3. Assert the boot-level surface (automated today):
   - boot is clean with the flauz-browser extension installed and the
     workspace open (no `Unresponsive`/`Fatal error`);
   - `build/flauz/scripts/bundle-extensions.mjs --verify` passes (the
     `dist/extension.js` main exists for EVERY flauz-* extension, including
     flauz-browser — the round-16 first-CI finding class);
   - the networkFilter service compiled in
     (`out/vs/platform/networkFilter/common/networkFilterService.js`);
   - the browserView contrib compiled in (same assertion as C-28 A1).
   NOTE the activation discipline makes plain-boot log lines IMPOSSIBLE by
   design: flauz-browser activates lazily on the first
   `onCommand:flauz.browser.*` invocation (no `onStartupFinished` — the cap
   of 2 is reserved for the bridge + workspace extensions, activation-lint
   R3), so the `flauz.browser: effective policy ...` log-line greps belong
   to the driver steps below (the driver invokes the command surface).
4. **[LANDED at the unit level by TL3-001; BOOT-VERIFIED by the TL3-H2
   workbench boot drill]**
   The Flauz runtime now exists (`src/runtime/`): the session manager opens
   agent/human browser sessions, and the navigation pipeline consults the
   driver-side verdict BEFORE any `Page.navigate`. The
   `flauz.browser.*` command surface (activation still command-only,
   activation-lint R2-clean) is invoked by any driver/bridge. Boot-level
   verification of the WORKBENCH surface (real `window.openBrowserTab` with
   the product grant) is LANDED as the TL3-H2 boot drill — see the
   "Workbench boot drill" section below.
5. **[LANDED at the unit level]** The DRIVER layer blocks it: a
   policy-denied navigation sends ZERO CDP `Page.navigate` commands — pinned
   in `test/runtime-tabs.test.ts` (asserted on the FakeCdpTransport
   sent-command log) and re-asserted by the driver drill
   (`test/canaries/policy-gated-navigation.drill.ts`, the A5/A5b rows). The
   partition used for the attempt is the flauz-derived
   `persist:flauz-<hash>[-agent]` name (pinned in
   `test/session-manager.test.ts` + the drill's A9 row).
6. **[LANDED at the unit level]** The WEBREQUEST layer blocks content: with
   the policy's driver layer kill-switched, the navigation issues and the
   post-commit reconciliation flags the violating committed URL
   (`reconcileCommittedUrl`) with the `about:blank` forced-reset
   recommendation — pinned in `test/runtime-tabs.test.ts` (the
   commitUrlMapper redirect drill) and the drill's A7/F2 row. The
   `ERR_BLOCKED_BY_CLIENT` LOG LINE is a real-browser surface and remains a
   workbench-level assertion.
7. **[LANDED at the unit level]** The WILL-NAVIGATE layer stays OUT of the
   agent path: agent sessions consult driver+webRequest only (B1c firing
   model) — pinned BOTH directions in `test/session-manager.test.ts`
   (agents denied where humans are allowed; humans denied by willNavigate
   rules where agents are allowed) — and the committed-URL residual is
   recorded as a reconciliation evidence row (`toEvidenceRow` shape).
8. **[LANDED at the unit level]** Kill-switch matrix: unchanged — the
   cdp-bypass-cases.json matrix stays pinned by the unit job (96 legacy
   cases, unmodified); the runtime additionally re-gates RECOVERED state
   against the CURRENT policy (`test/recovery.test.ts`).
9. **[LANDED at the unit level]** User-path variant: human sessions consult
   willNavigate + webRequest (the agent allowlist NEVER gates humans) —
   pinned in `test/session-manager.test.ts` + the drill's A9-user row.
10. Ledger the denied attempts: the runtime produces the exact
   `toEvidenceRow` evidence rows for denied navigations, post-commit
   violations, and recovery re-checks (shape pinned in
   `test/runtime-tabs.test.ts` / `test/capture.test.ts`); the actual
   `flauz.workspace.appendEvidence` LEDGER APPEND stays product-side (the
   Agent Bridge seam, INTEGRATION-GAP section 5) — boot-level as before.

## Expected (assertions)

| # | Assertion | Mechanism | Status |
|---|---|---|---|
| A1 | Fixture policy parses through the real engine; CDP nav to evil.org = `deny/driver/agent-tool` | zero-dep `node --input-type=module` step (step 2) | boot-level, automated |
| A2 | Boot clean with flauz-browser installed + workspace open; every flauz-* dist main exists (`--verify`) | boot log greps + `bundle-extensions.mjs --verify` (step 3) | boot-level, automated |
| A3 | networkFilter service + browserView contrib compiled in | `grep -rq` on `out/vs/platform/networkFilter/` + `out/vs/workbench/contrib/browserView/` | boot-level, automated |
| A4 | Extension activates on first command; policy-file log lines present | unit: activation + log-line cases (`test/extension.test.ts`, unchanged); runtime: command surface registered (`flauz.browser.openSession` et al.) | **BOOT-VERIFIED (TL3-H2, job `b-policy-boot-drill`)**: the test-driver extension invokes `flauz.browser.openSession` through the REAL onCommand activation machinery in the BOOTED workbench — the ExtensionService activation record, the command-surface registration, and the runtime log lines (host selection + openSession) are asserted on the real log corpus (the channel is log-backed since TL3-H2, so the `flauz.browser:` lines land at `<logs>/<ext-id>/<name>.log`). Unit-level rows unchanged. |
| A5 | CDP nav to non-allowlisted host blocked at the driver layer (tool error, no navigation) | `test/runtime-tabs.test.ts` + `test/session-manager.test.ts` + the driver drill (unit job step) | **LANDED (unit level) by TL3-001** (fake-driver drill: ZERO `Page.navigate` sent) |
| A6 | With driver kill-switched: CDP nav issues, content blocked (`ERR_BLOCKED_BY_CLIENT` in log) | reconciliation half LANDED (unit level: the post-commit violation + about:blank reset, `test/runtime-tabs.test.ts` commitUrlMapper drill); the `ERR_BLOCKED_BY_CLIENT` log line itself is a real-browser (Electron webRequest) surface | **BOOT-VERIFIED as far as the architecture allows (TL3-H2)**: the workbench boot drill asserts the runtime's typed denial at boot (`driver.deny-start-typed` / `driver.navigate-denied`: deny + zero CDP sends + evidence row, in the booted workbench). The `ERR_BLOCKED_BY_CLIENT` LOG LINE stays an honest SKIP row in the drill — exact reason: the runtime's driver-layer deny is authoritative BEFORE the wire (zero CDP commands, so no request exists for the in-tree L2 webRequest filter to cancel); observing the line would require a real agent-scope content cancellation under the canary settings — recorded as the remaining boundary, never faked. The unit-level reconciliation rows are unchanged. |
| A7 | will-navigate never fires for the CDP nav; overall verdict still deny; reconciliation row recorded | `test/session-manager.test.ts` (both-direction separation) + `test/runtime-tabs.test.ts` (reconciliation row) + drill A7/F2 row | **LANDED (unit level) by TL3-001** |
| A8 | Each layer individually kill-switched: the others still deny (B1c insurance, 3 variants + user-path variant) | the legacy 96-case matrix (`test/cdpBypass.test.ts`, unchanged) + runtime re-gating (`test/recovery.test.ts`) | **LANDED (unit level)** (engine matrix unchanged; the runtime adds post-recovery re-gating) |
| A9 | Partition name in the verdicts matches `persist:flauz-<16hex>` and the workspace hash | `test/session-manager.test.ts` (partition shapes per initiator) + drill A9 rows | **LANDED (unit level) by TL3-001** |
| A10 | Denied attempts land as evidence rows; ledger verifies | evidence-row production LANDED (unit level: `test/runtime-tabs.test.ts`, `test/capture.test.ts`, drill A10 row); the `flauz.workspace.appendEvidence` ledger append + `verifyLedger` check stays product-side (Agent Bridge seam) | **BOOT-VERIFIED at the runtime boundary (TL3-H2)**: the workbench boot drill asserts the evidence rows at boot (the denied-start + denied-navigation rows in the driver report) AND the PIN-1 session journal the booted runtime writes (`.flauz/browser-sessions.jsonl`: the agent session's opened/closed records carrying the `persist:flauz-<16hex>-boot-drill` partition). The `flauz.workspace.appendEvidence` ledger append REMAINS product-side (Agent Bridge seam) — exact reason: the append is the bridge's command flow, not the browser runtime's. |

## Workbench boot drill (TL3-H2 — job `b-policy-boot-drill`)

The A4/A6/A10 "stays boot-level" notes asked for a REAL driver invoking the
command surface in a BOOTED workbench. The TL3-H2 drill delivers exactly
that. CI job `b-policy-boot-drill` (`.github/workflows/flauz-browser.yml`;
trigger policy = the compat-l3 precedent: `workflow_dispatch` + ONE weekly
schedule canary, because the job compiles the workbench) boots the compiled
+ bundled flauz build under xvfb with the fixture policy workspace and the
test-driver extension installed, then the zero-dep evaluator
`build/flauz/scripts/b-policy-boot-drill.mjs` asserts both sides.

**The driver mechanism (and why a test-driver extension).** The
architecture-allowed invocation path for `flauz.browser.*` is
`vscode.commands.executeCommand` — the product extension activates lazily
`onCommand:flauz.browser.*` and registers NO other invocation surface
(no URI handler, no CLI surface; adding one would WEAKEN the
command-driven activation discipline this canary exists to protect). The
driving options evaluated:

1. a TEST-DRIVER EXTENSION installed into the canary profile's
   `--extensions-dir` — CHOSEN: it is CI test infrastructure exactly like
   the fixture workspaces (source under `test/fixtures/
   browser-policy-driver/`, the compat-l3 fixture hygiene precedent), it
   carries NO flauz- prefix, it never touches the activation-lint's
   built-in caps (the lint scans `extensions/flauz-*` only), and it
   invokes the command surface through the REAL activation machinery;
2. a workbench URI/CLI invocation path — REJECTED: flauz-browser
   deliberately registers none (the activation discipline is invariant);
3. renderer CDP `Runtime.evaluate` — REJECTED: it drives internal page
   state, not the extension API contract (not a product-surface
   verification).

The driver (activates `onStartupFinished`, which is lawful for CI test
infrastructure that is not a flauz-* built-in) waits for
`flauz.flauz-browser` in the registry, then exercises the command surface
and writes `<workspace>/.flauz/boot-drill/driver-report.json`.

**One extension-side change makes the A4 runtime log lines boot-greppable**
(the legitimate boot-drill support this lane ships): the output channel is
created LOG-BACKED (`createOutputChannel('Flauz Browser Policy',
{ log: true })`) — every `flauz.browser:` line ALSO lands in the workbench
log corpus at `<logsLocation>/flauz.flauz-browser/<name>.log`
(`src/vs/workbench/api/common/extHostOutput.ts:190-200`), which is what
the drill greps. A plain output channel never reaches the log corpus; the
channel surface itself is unchanged (`appendLine`).

**Row catalogue** (evaluator rows; driver rows mirror the
`driver.*` ids in the report):

| Row | What it asserts | Status |
|---|---|---|
| `boot.cdp-reachable` | CDP `/json/version` answered (boot readiness, the compat-l3 pattern) | PASS-capable (SKIP when no port wired) |
| `boot.driver-report` | the driver report appeared + parses + schema matches | PASS-capable |
| `boot.log-corpus` / `boot.log-clean` | the corpus is non-empty; no fatal patterns | PASS-capable |
| `boot.flauz-activated` | `ExtensionService#_doActivateExtension flauz.flauz-browser` in the corpus (the lazy onCommand activation record) | PASS-capable |
| `boot.proposal-grant-live` | NO proposal trip-wire fired (`DOES NOT EXIST` / `CANNOT use API proposal: browser` / `CANNOT USE these API proposals`, `extensionsProposedApi.ts:48,73,112` + `extensions.ts:332`); the grant is exercised live by the session-open row (the API call itself runs `checkProposedApiEnabled` under the grant) | PASS-capable |
| `boot.runtime-host-log-line` | `flauz.browser: runtime host = workbench (proposed browser API, posture P0)` in the corpus (log-backed channel) | PASS-capable |
| `boot.openSession-log-line` | `flauz.browser: openSession flauz:browser:<id> initiator=agent partition=persist:flauz-<16hex>-boot-drill state=active` in the corpus | PASS-capable |
| `boot.err-blocked-by-client` | the A6 Electron webRequest log line | **PASS when observed; honest SKIP otherwise** — exact reason: the runtime's driver deny is authoritative BEFORE the wire (zero CDP commands, so no request exists for the in-tree L2 webRequest filter to cancel); observing the line needs a real agent-scope content cancellation under the canary settings |
| `driver.flauz-extension-present` | the built-in is in the workbench registry | PASS-capable |
| `driver.deny-start-typed` | a policy-DENIED startUrl fails the session BEFORE any host interaction (typed `flauz.browser.policy.deny` + deny/driver/agent-tool verdict + evidence row) — the A5-at-boot assertion, network-free | PASS-capable |
| `driver.activation-triggered` | the first `executeCommand` activated the extension (isActive) | PASS-capable |
| `driver.command-surface` | all ten `flauz.browser.*` commands registered after activation | PASS-capable |
| `driver.session-open-workbench` | an agent session OPENS through the real workbench host adapter: `window.openBrowserTab` (about:blank) + `BrowserTab.startCDPSession` + the TL3-002 hardening commands over the REAL session, partition `persist:flauz-<16hex>-boot-drill` — the P0 posture boot fact, network-free | PASS-capable |
| `driver.navigate-denied` | a policy-DENIED navigation on the LIVE session: `sent=false` + typed deny verdict + evidence row (zero CDP sends) | PASS-capable |
| `driver.navigate-allowed` | the allowed navigation SENDS `Page.navigate` over the real workbench session (`sent=true` — the wire fact, network-independent); the COMMIT observation is network-dependent and is RECORDED, never gated, never faked | PASS-capable (commit recorded as observed) |
| `driver.sessions-audit` / `driver.session-close` | the audit list carries the session; closeSession seals it | PASS-capable |
| `boot.journal-records` | the booted runtime wrote `.flauz/browser-sessions.jsonl` with the agent session's opened/closed records carrying the flauz partition (PIN-1 runtime file evidence) | PASS-capable |

**Honesty law** (the compat-l3 discipline): SKIP rows carry exact reasons;
the drill FAILS loudly on every real defect; the allowed-navigation commit
state is observed data, never a gated claim. If a REAL browser surface
(Electron browserView) proves unreachable in a CI environment, the
session-open/denial rows FAIL with the typed error text — that is the
drill doing its job (the boundary must be PROVEN, not assumed).

## Optional real-endpoint drill (TL3-003 — NOT CI-required)

`extensions/flauz-browser/test/canaries/real-chromium-hardening.drill.ts` is
an OPTIONAL drill that drives the REAL runtime (`CdpEndpointHost` +
`BrowserSessionManager` + the TL3-002 hardening + the popup gate + the
recovery) against a REAL Chromium over a real CDP WebSocket. It runs ONLY
when a real endpoint is reachable; otherwise it SKIPs with exit 0 (never
fail a gate for lacking a browser):

```sh
chromium --headless=new --no-sandbox --disable-gpu --disable-popup-blocking \
         --remote-debugging-port=9222 --user-data-dir=/tmp/flauz-chrome about:blank
# --disable-popup-blocking: Runtime.evaluate runs without a user gesture, so
# Chrome's popup blocker would block window.open before the gate shapes can
# be observed.
export FLAUZ_CDP_ENDPOINT=$(curl -s http://127.0.0.1:9222/json/version \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).webSocketDebuggerUrl))")
cd extensions/flauz-browser
node test/canaries/real-chromium-hardening.drill.ts   # exit 0 = green; SKIP notice + exit 0 without a browser
```

**What it proves** (real observed evidence; verified GREEN — 43 assertions —
against Chrome for Testing 153.0.8010.12 headless): the transport E2E over
the real WebSocket (real wire frames, real committed URLs, real PNG
screenshot bytes, ZERO `Page.navigate` frames on a policy deny — asserted on
the real wire); the UA discipline both directions (agent tabs carry
`FlauzAgent/<v>` — cross-session observable; human tabs keep the browser
default, zero override frames); the download deny (command accepted on real
page sessions, EFFECT observable: `Browser.downloadWillBegin` ->
`Browser.downloadProgress` state `canceled`, per-session scoping); and the
recovery path (real-socket kill -> suspend -> reconnect -> re-attach ->
re-hardening -> current-policy recheck against REAL browser state, including
a hot-swapped-deny variant that flags the real committed URL).

**What it PINS as real-Chromium divergences** from the FakeCdpTransport
contract (asserted as observed — if Chromium's behavior changes, the drill
fails loudly; recorded in `extensions/flauz-browser/INTEGRATION-GAP.md`
"What remains" for the TL): F-DELIVERY (page-session auto-attach does not
deliver `window.open` popups), F-POPUP-URL (popup `targetInfo.url` is empty
at attach), F-RELEASE-CMD (`Runtime.run` is not a real CDP method — the real
release is `Runtime.runIfWaitingForDebugger`), F-OPENER-BLOCK (`window.open`
blocks the opener while a popup is held), and F-RECOVERY-DOMAINS (recovery
does not re-send `Page.enable`, so post-recovery commit observation times
out). These are the exact real-Chromium facts the workbench-boot residuals
now rest on: the workbench side (real `window.openBrowserTab` under the
grant, the command-surface activation log lines, the in-tree
`ERR_BLOCKED_BY_CLIENT` L2 surface) remains with the B-POLICY boot
canary.

CI MUST NOT require this drill: no real browser is guaranteed on CI runners.
Adding it to a job is a decision for the TL when a real-Chromium sidecar
lands in CI (it SKIPs harmlessly until then, which is also acceptable).

## Drift trip-wires

- A1 failing: the fixture policy or the engine's precedence moved — re-run
  `node --test extensions/flauz-browser/test/*.test.ts` (the same matrix is
  pinned there without a browser); a real regression, not a harness flake.
- A2 failing on `--verify`: the extension main/target layout changed (or the
  bundler discovery broke) — the round-16 "boots failed activation with
  'Cannot find module .../dist/extension.js'" class.
- A3 failing at a sync: upstream reshaped `platform/networkFilter` or
  `contrib/browserView` — sync runbook blocks; re-point the greps (the
  service names are stable since the Wave-1 verification).
- A5 (LANDED, unit level) failing: the navigation pipeline stopped gating
  BEFORE the CDP send — re-run the unit job (the drill prints the exact
  failing assertion); a drill-only failure with green suites means the DRILL
  diverged from the suites, escalate to TL.
- A5/A6 flipping semantics at the BOOT level (tool no longer throws at
  prepare, or webRequest stops canceling): the L1/L2 contracts moved — this
  is exactly the B1c class the canary exists to catch; escalate to TL with
  the log (INTEGRATION-GAP.md section 2 citations re-verify first).
- A6 (unit level) failing: `reconcileCommittedUrl` or the pipeline's
  committed-URL handling moved — the commitUrlMapper redirect drill in
  `test/runtime-tabs.test.ts` is the pin.
- A8 failing: the deny-at-any-layer precedence broke in the policy engine —
  the kill-switch matrix is pinned by the unit job; a canary-only failure
  means the DRIVER-side wiring diverged from the engine.
- The driver drill exiting non-zero in CI with green `node --test` suites:
  environment-dependent drift in the drill script itself (it must stay
  zero-dep, zero-network, zero-secrets — FakeCdpTransport only).
- The workbench boot drill (TL3-H2) FAILING with green unit suites:
  `boot.proposal-grant-live` firing = the `browser` proposal died/was renamed
  upstream or the product grant was stripped (extensionsProposedApi.ts:48,73
  trip-wires) — sync runbook blocks; `driver.session-open-workbench` failing
  with a typed tab/hardening error = the workbench CDP surface moved (the
  mainThreadBrowsers path) — escalate to TL with the driver report; the
  `boot.*-log-line` rows failing with a GREEN driver report = the log-backed
  channel surface moved (extHostOutput.ts) — re-point the corpus glob.
- The workbench boot drill SKIPping `boot.err-blocked-by-client` is NOT a
  failure (the honest SKIP row; see the row catalogue for the exact reason).
  It flips to PASS only when a real agent-scope webRequest cancellation
  appears in the corpus — treat a PASS as a bonus observation, never as a
  gate that must stay green.
