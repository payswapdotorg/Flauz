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
  `.flauz/browser-policy.json`, schema `flauz.browser-policy/v0`).
- **Owner CI**: `.github/workflows/flauz-browser.yml` -> job `b-policy-canary`
  (+ job `b-policy-unit` for the zero-dep `node --test` suites).

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
4. **[driver — WAITING-ON-LANE F/driver]** Ask the flauz participant to open
   a browser page and navigate via the `navigate_page` tool to
   `https://evil.org/pay` (a non-allowlisted host). The first command
   invocation activates flauz-browser; assert the activation log lines
   (`flauz.browser: effective policy flauz.browser-policy/v0
   source=workspace-file schemaVersion=0`, `flauz.browser: layer driver:
   enabled=true allow=1 deny=0 ...`).
5. **[driver]** Assert the DRIVER layer blocked it: the tool invocation
   fails with the network-policy error BEFORE any CDP navigation
   (navigateBrowserTool.ts:100-103 path; chat shows the tool error, no page
   navigation happened). Partition used for the attempt is the
   flauz-derived `persist:flauz-<hash>` name (logged by the extension's
   `flauz.browser.evaluate` call or the bridge's wrapper).
6. **[driver]** Assert the WEBREQUEST layer blocks content: with the policy's
   driver layer kill-switched (`"driver": {"enabled": false, "allow": ["*"]}`
   in the policy file — the B1c insurance variant), the same CDP navigation
   now issues and the log carries `ERR_BLOCKED_BY_CLIENT`
   (browserSession.ts:320-329) for the non-allowlisted host.
7. **[driver]** Assert the WILL-NAVIGATE layer stays OUT of the agent path:
   for the CDP-initiated navigation of step 6, no `will-navigate` preventDefault
   fires for the target host (browserView.ts:328-339 only pins redirects) —
   and the navigation is STILL denied overall (content blocked at L2; the
   committed-URL residual is recorded as a reconciliation verdict via
   `flauz.browser.evaluate`, SECURITY-MODEL F2).
8. **[driver]** Kill-switch matrix (the B1c insurance): for EACH layer
   individually disabled in the policy file, repeat the navigation and
   assert the OTHER layers still deny (driver-off -> webRequest carries it;
   webRequest-off -> driver carries it; willNavigate-off (the live default
   for CDP navs) -> driver carries it). This is exactly the
   `cdp-bypass-cases.json` matrix executed against the real browser path.
9. **[driver]** User-path variant: an omnibox/link navigation to a
   non-allowlisted host is denied by willNavigate rules when the driver
   layer is bypassed (the user path consults willNavigate + webRequest).
10. Ledger the denied attempts: the bridge appends one evidence row per
   denied attempt (`flauz.workspace.appendEvidence` with the
   `toEvidenceRow` shape) and `flauz.workspace.verifyLedger` reports
   ok=true after the run.

## Expected (assertions)

| # | Assertion | Mechanism | Status |
|---|---|---|---|
| A1 | Fixture policy parses through the real engine; CDP nav to evil.org = `deny/driver/agent-tool` | zero-dep `node --input-type=module` step (step 2) | boot-level, automated |
| A2 | Boot clean with flauz-browser installed + workspace open; every flauz-* dist main exists (`--verify`) | boot log greps + `bundle-extensions.mjs --verify` (step 3) | boot-level, automated |
| A3 | networkFilter service + browserView contrib compiled in | `grep -rq` on `out/vs/platform/networkFilter/` + `out/vs/workbench/contrib/browserView/` | boot-level, automated |
| A4 | Extension activates on first command; policy-file log lines present | output-channel greps after the driver's first `flauz.browser.*` invocation (step 4) | **WAITING-ON-LANE F/driver** |
| A5 | CDP nav to non-allowlisted host blocked at the driver layer (tool error, no navigation) | driver chat-model assertions (step 5) | **WAITING-ON-LANE F/driver** |
| A6 | With driver kill-switched: CDP nav issues, content blocked (`ERR_BLOCKED_BY_CLIENT` in log) | log grep (step 6) | **WAITING-ON-LANE F/driver** |
| A7 | will-navigate never fires for the CDP nav; overall verdict still deny; reconciliation row recorded | navigation-event log + verdict log (step 7) | **WAITING-ON-LANE F/driver** |
| A8 | Each layer individually kill-switched: the others still deny (B1c insurance, 3 variants + user-path variant) | verdict assertions over the policy-file matrix (steps 8-9) | **WAITING-ON-LANE F/driver** |
| A9 | Partition name in the verdicts matches `persist:flauz-<16hex>` and the workspace hash | verdict log / `flauz.browser.evaluate` result (steps 5-8) | **WAITING-ON-LANE F/driver** |
| A10 | Denied attempts land as evidence rows; ledger verifies | `flauz.workspace.verifyLedger` (step 10) | **WAITING-ON-LANE F/driver** |

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
- A5/A6 flipping semantics (tool no longer throws at prepare, or webRequest
  stops canceling): the L1/L2 contracts moved — this is exactly the B1c
  class the canary exists to catch; escalate to TL with the log
  (INTEGRATION-GAP.md section 2 citations re-verify first).
- A8 failing: the deny-at-any-layer precedence broke in the policy engine —
  the kill-switch matrix is pinned by the unit job; a canary-only failure
  means the DRIVER-side wiring diverged from the engine.
