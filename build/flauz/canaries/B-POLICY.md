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
4. **[driver — LANDED at the unit level by TL3-001 (fake-driver drills)]**
   The Flauz runtime now exists (`src/runtime/`): the session manager opens
   agent/human browser sessions, and the navigation pipeline consults the
   driver-side verdict BEFORE any `Page.navigate`. The
   `flauz.browser.*` command surface (activation still command-only,
   activation-lint R2-clean) is invoked by any driver/bridge. Boot-level
   verification of the WORKBENCH surface (real `window.openBrowserTab` with
   the product grant) still requires a real workbench — see the A4 note
   below.
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
| A4 | Extension activates on first command; policy-file log lines present | unit: activation + log-line cases (`test/extension.test.ts`, unchanged); runtime: command surface registered (`flauz.browser.openSession` et al.) | **LANDED (unit level) by TL3-001**; workbench-boot grep of the runtime log lines stays boot-level (needs a real driver invoking the command surface in a booted workbench) |
| A5 | CDP nav to non-allowlisted host blocked at the driver layer (tool error, no navigation) | `test/runtime-tabs.test.ts` + `test/session-manager.test.ts` + the driver drill (unit job step) | **LANDED (unit level) by TL3-001** (fake-driver drill: ZERO `Page.navigate` sent) |
| A6 | With driver kill-switched: CDP nav issues, content blocked (`ERR_BLOCKED_BY_CLIENT` in log) | reconciliation half LANDED (unit level: the post-commit violation + about:blank reset, `test/runtime-tabs.test.ts` commitUrlMapper drill); the `ERR_BLOCKED_BY_CLIENT` log line itself is a real-browser (Electron webRequest) surface | **PARTIALLY LANDED (unit level)**; the log-line grep stays boot-level — exact reason: the FakeCdpTransport simulator is TEST infrastructure and does not emit Electron webRequest interception logs |
| A7 | will-navigate never fires for the CDP nav; overall verdict still deny; reconciliation row recorded | `test/session-manager.test.ts` (both-direction separation) + `test/runtime-tabs.test.ts` (reconciliation row) + drill A7/F2 row | **LANDED (unit level) by TL3-001** |
| A8 | Each layer individually kill-switched: the others still deny (B1c insurance, 3 variants + user-path variant) | the legacy 96-case matrix (`test/cdpBypass.test.ts`, unchanged) + runtime re-gating (`test/recovery.test.ts`) | **LANDED (unit level)** (engine matrix unchanged; the runtime adds post-recovery re-gating) |
| A9 | Partition name in the verdicts matches `persist:flauz-<16hex>` and the workspace hash | `test/session-manager.test.ts` (partition shapes per initiator) + drill A9 rows | **LANDED (unit level) by TL3-001** |
| A10 | Denied attempts land as evidence rows; ledger verifies | evidence-row production LANDED (unit level: `test/runtime-tabs.test.ts`, `test/capture.test.ts`, drill A10 row); the `flauz.workspace.appendEvidence` ledger append + `verifyLedger` check stays product-side (Agent Bridge seam) | **PARTIALLY LANDED (unit level)**; ledger append stays boot-level — exact reason: the append is the bridge's command flow, not the browser runtime's |

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
