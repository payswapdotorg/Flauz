# P2-FIX-106 — the popup gate's page-session placement does not intercept `window.open` popups on real Chromium (browser-level placement + URL-observation redesign)

Observed by the TL3-P2 partition-A readiness audit (worker chat c4aa3f08) on the
pinned base `c27de198e1`; routed as P2-FIX-106 by TL4 (2026-10-01 routing
record). Consolidates the three pinned real-Chromium drill findings
F-DELIVERY + F-POPUP-URL + F-OPENER-BLOCK (TL3-003) into ONE redesign
decision.

- **Observable behavior:** the landed TL3-002 popup/new-target gate sits on
  page-session `Target.setAutoAttach`; on real Chromium
  (153.0.8010.52) that placement receives NO browser-level popup targets —
  a `window.open`/`target=_blank` to a denied host free-runs past the gate:
  zero popup-gate events fire, the deny path never engages, the denied
  navigation commits. Two adjacent facts shape the redesign: at
  browser-level attach with `waitForDebuggerOnStart`, `targetInfo.url` is
  EMPTY (the pending destination is unavailable at gate time — F-POPUP-URL),
  and `window.open` BLOCKS the opener's JS while a popup is held (never
  returning if the held popup is closed without release — F-OPENER-BLOCK,
  the deny-path timing shape).
- **Evidence + runtime level:** runtime-real — the real-Chromium hardening
  drill on the pinned base records all three facts verbatim (`3.1d-3
  F-DELIVERY … zero popup-gate events fired`; `3.1d-6b … targetInfo.url is
  EMPTY STRING at attach`; `3.1d-6c/8c F-OPENER-BLOCK`). The same drill
  proves every primitive a correct browser-level gate needs holds on real
  Chromium (3.1d-5..8b: browser-level intercept+hold via
  `waitForDebuggerOnStart`, close-before-use via `Target.closeTarget`,
  release via `Runtime.runIfWaitingForDebugger` — the release command fixed
  by the TL3-P2 partition-A landing, PR #72).
- **Owning domain:** browser runtime security-gate semantics (TL3); the
  placement + URL-observation strategy is a TL adjudication per the standing
  INTEGRATION-GAP "What remains" record — decided as **DL-79** before
  implementation.
- **Proposed contract change (per DL-79):** browser-level gate placement +
  Fetch-domain pre-use URL observation; `openerId` attribution for
  provenance and the no-URL release rule; the deny path aborts the first
  request before the wire (`Fetch.failRequest`) and closes the target
  (zero committed loads to denied hosts); the allow path releases via
  `Runtime.runIfWaitingForDebugger`. The `PopupGateEvent` contract gains
  the observed URL + `openerId` fields (additive); evidence timing moves
  from attach-time to first-request-time; the unit-pinned TL3-002 gate
  tests are re-pinned to the new contract IN THE SAME change; the fake
  CDP transport re-models real browser-level delivery.
- **Acceptance test:** on real Chromium, `window.open('https://<denied-host>')`
  from an agent-driven tab produces a popup-gate DENY event carrying the
  observed URL + `openerId`, with ZERO committed loads on the denied host
  (request aborted + target closed); an allowed popup releases and commits;
  the drill's F-DELIVERY/F-POPUP-URL/F-OPENER-BLOCK pins flip from
  FINDING-pinned to assertion-pinned; the full browser suite green.
- **Architecture impact:** medium — security-semantics redesign inside the
  browser extension's runtime surface (no fork-critical files; `src/vs/**`
  untouched); the pinned-semantics change is sanctioned by DL-79.
