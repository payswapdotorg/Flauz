# Flauz Browser Policy & Runtime (extensions/flauz-browser)

Wave 4, Lane I (worker `flauz-I-w4`) + TL3-001 (browser runtime) + TL3-002
(browser session security): the layered browser navigation policy engine for
Flauz's agent browser surface — driver-side allowlist (AUTHORITATIVE for
agent-initiated navigation) + webRequest rules + will-navigate rules +
per-workspace/agent partition containment, with `.flauz/browser-policy.json`
as the per-workspace, git-diffable policy source — the Flauz-controlled
Chromium/CDP **browser runtime** that the policy engine has been waiting for:
sessions, policy-gated navigation, capture, and recovery (ARCHITECTURE-LOCK
section 3 browser v2 posture: CDP as a Flauz-controlled sidecar/service;
posture P0 of INTEGRATION-GAP.md in the workbench) — and, since TL3-002, the
SESSION SECURITY HARDENING on top of that runtime: per-session user-agent
discipline, deny-by-default downloads, the popup/new-target gate, EXECUTED
post-commit forced resets (G6 runtime-side), partition-scoped tab ownership,
the append-only session journal, and the untrusted-content boundary marker in
capture-derived evidence rows. Since TL3-H2 (post-completion hardening):
the P0 posture is **boot-verified end to end** by the CI workbench boot drill
(`window.openBrowserTab` + `startCDPSession` under the live `browser` product
grant in a booted workbench), and the two product-side residuals are
**permanently recorded** as verified product limitations (INTEGRATION-GAP G5
partition minting; G3 networkFilter default posture).

Basis: `docs/BROWSER-ARCHITECTURE.md` section 5 (branch `wave1/b-browser-ux`,
flauz-code-lab) + DL-6 + `docs/SECURITY-MODEL.md` section 4 (branch
`wave2/d-license-security`). The B1c finding drives the design: CDP-initiated
navigations BYPASS the Electron `will-navigate` event, so layered gates are
mandatory — a navigation that skips will-navigate must STILL be denied by the
driver + webRequest layers.

See `INTEGRATION-GAP.md` (same directory) for the tree-cited analysis of what
extension-land owns vs. what only a product-side change can wire into the
in-tree browser platform (`src/vs/platform/browserView/`,
`src/vs/platform/networkFilter/`).

## The policy file

`.flauz/browser-policy.json` (workspace root, schema `flauz.browser-policy/v0`):

```json
{
        "schemaVersion": 0,
        "driver": {
                "allow": ["*.example.com", "docs.flauz.dev"],
                "deny": ["evil.example.com"],
                "fileRoots": ["/tmp/trusted-exports", ".flauz"],
                "enabled": true
        },
        "webRequest": {
                "allow": ["*.example.com"],
                "deny": ["tracker.example.net"]
        },
        "willNavigate": {
                "allow": ["*"],
                "deny": ["phishing.example.org"]
        },
        "partitions": {
                "scope": "persist",
                "perAgent": false
        },
        "security": {
                "enforceReset": true
        }
}
```

- Every key except `schemaVersion` is optional; omitted layers default to
  deny-all with the layer enabled (fail-closed).
- `security` (TL3-002, ADDITIVE v0 key): `enforceReset` governs the G6
  forced-reset EXECUTION on runtime-owned tabs after a post-commit policy
  violation. DEFAULT `true` = fail-closed (the absent key behaves as true);
  `false` is an EXPLICIT opt-out that is recorded in the reconciliation
  verdict — the recommendation still computes, only the execution is skipped.
  The block is serialized only when set to `false`, so default-policy bytes
  are unchanged. No allow surface exists for anything security-relevant:
  downloads are denied for every session with NO policy-configurable allow
  (a future allow surface would be a NEW policy decision, not implemented).
- Host patterns follow the in-tree network-filter semantics
  (`networkFilterService.ts:26-35`): both lists empty = deny all; the denied
  list always wins; `*.example.com` covers subdomains AND the suffix itself;
  `*` allows everything not denied. Patterns accept bare hosts, URLs
  (authority wins), `user@host`, `host:port`, and bracketed IPv6 (`[::1]`);
  they are normalized and validated at load.
- `driver.fileRoots` (driver layer only): trusted `file://` roots, absolute
  POSIX or workspace-relative. `file://` outside them is denied at the driver
  layer (the engine-side analog of the tree's trusted-file-roots gate,
  `browserSession.ts:341-347`).
- `enabled: false` on a layer is the kill-switch used by the B1c insurance
  tests: the layer never denies and the OTHERS must carry every deny. Killing
  every gate on a path yields a fail-closed deny (never an open).
- `partitions.scope`: `persist` (default) -> `persist:flauz-<hash>` durable
  jar; `memory` -> in-memory `flauz-<hash>`. `partitions.perAgent: true`
  appends `-<agent-id>` (agent ids match `[A-Za-z0-9._-]{1,64}`). The
  workspace hash is sha256(root)[0..16].
- Missing file: builtin deny-all default (with a logged warning). Broken
  file: deny-all default + the typed error carried on every verdict
  (`[policy file invalid: FLAUZ_POLICY_SCHEMA]`).

## Semantics (pinned by tests)

1. **Deny at any layer wins.** The combined verdict reports the first denying
   layer in precedence order `partition > driver > webRequest > willNavigate`.
2. **The driver deny is authoritative** for agent-tool navigations: it wins
   even when every other layer allows. A driver ALLOW never overrides another
   layer's deny (the B1c insurance precondition).
3. **Layer firing model (B1c):** `agent-tool` navigations (CDP
   `Page.navigate` via the browser tool) consult driver + webRequest —
   will-navigate never fires for them. `user` navigations consult
   willNavigate + webRequest — the agent allowlist does not gate humans.
4. **Fail-closed everywhere:** missing/broken policy file, unparseable URL,
   non-drivable scheme at the driver layer (`data:`, `chrome:`, ...), file://
   outside trusted roots, and every-gate-kill-switched paths are all denied.
5. **Post-commit reconciliation + EXECUTED reset (G6, TL3-002):**
   `reconcileCommittedUrl` flags a violating committed URL; when
   `security.enforceReset` is true (the default, fail-closed) the runtime
   EXECUTES the `about:blank` forced reset on the offending tab THROUGH the
   policy engine (SECURITY-MODEL section 4 F2 — the narrow typed `resetTab`
   operation can navigate nowhere else). An explicit `false` opt-out is
   recorded in the verdict; the recommendation is then advisory-only.

Divergences from the tree filter (documented, deliberate): no implicit
localhost exemption (the tree exempts localhost only on rewritten tunnel
URLs, `browserToolHelpers.ts:239`); policy patterns require bracketed IPv6;
the driver layer denies schemes the raw filter would pass.

## The browser runtime (TL3-001)

The runtime is the RUNTIME the policy engine was waiting for. Architecture
(all under `src/`, zero runtime dependencies — Node >= 20 stdlib + the stable
global `WebSocket` of Node 22+):

| Layer | Where | What it owns |
|---|---|---|
| CDP client | `src/cdp/transport.ts` | The `CdpTransport` port: promise-based `send(method, params, sessionId?)` with monotonically increasing message ids + response correlation + per-command timeouts; `on(method, handler)` event fan-out (session-scoped CDP events carry the flat-protocol `sessionId`); one-shot `close()`. `WebSocketCdpTransport` implements it over a DevTools WebSocket endpoint (injectable socket factory; no `ws` package). |
| Simulator | `src/cdp/fake.ts` | `FakeCdpTransport` — **TEST INFRASTRUCTURE, NOT PRODUCTION CODE**: a scriptable Chromium simulator (Target lifecycle, Page.navigate lifecycle with committed-URL mapping, deterministic screenshots, on-cue console/log/network events, `drop()`, wedged modes, a per-connection sent-command log that is THE policy-gating assertion surface). Browser state is shareable across connections for recovery drills. |
| Sessions | `src/runtime/session.ts`, `src/runtime/sessionManager.ts` | The `BrowserSessionDescriptor` (schema `flauz.browser-session/v0`, an ARCHITECTURE-LOCK section 5 contract family member): `{ schemaVersion: 0, sessionId, initiator, agentId?, partition, policySourceRef, createdAt, state, tabs }`. `sessionId` is a LOGICAL id `flauz:browser:<16-hex>` — never a URL, never a path. `BrowserSessionManager`: open/list/focus/close, navigation, capture, recovery. |
| Navigation pipeline | `src/runtime/tabs.ts` | The heart (posture P0): (1) verdict via `engine.evaluate` with the SESSION's initiator class; (2) **deny: NO CDP command is sent at all**; (3) allow: `Page.navigate` -> await the COMMITTED url -> `reconcileCommittedUrl` -> on violation return the `about:blank` forced-reset recommendation AND (TL3-002, G6) EXECUTE it via the narrow typed `runForcedReset` when `security.enforceReset` is true — the outcome records `violation.resetExecuted`. Wedged tabs (command timeout on a live transport) are replaced. `enableTabDomains` (exported since the TL3-P2 fix) is mint-time activation step 1 — the Page/Runtime/Network/Log domain enables — shared by `activateLiveTab` AND the recovery re-attach (F-RECOVERY-DOMAINS: real Chromium delivers Page events only to enabled sessions). |
| Session hardening | `src/runtime/hardening.ts` | TL3-002 items 3.1/3.2, applied on EVERY tab activation (open, wedged replacement, gate attach, recovery re-attach), fail-closed: `Browser.setDownloadBehavior {behavior:'deny'}` for EVERY session (v0 has NO allow surface — a future allow surface is a future policy decision, not implemented); `Emulation.setUserAgentOverride` with the browser's own UA + the appended `FlauzAgent/<v>` product token for AGENT sessions only (human sessions keep the browser default; the partition/session identity is never embedded in the UA). |
| Popup / new-target gate | `src/runtime/sessionManager.ts` (`attachBrowserGate`/`handleBrowserAttachedTarget`/`gateHeldPopup`) + `BrowserHost.rootTransport()` | TL3-002 item 3.3, REDESIGNED by P2-FIX-106 (DL-79): the gate is placed at BROWSER-level `Target.setAutoAttach` (flatten, `waitForDebuggerOnStart`, page filter, at the browser scope — the only placement real Chromium delivers `window.open` targets to). A held target is attributed by `targetInfo.openerId`; a session opener's popup has its pending destination observed PRE-USE through the Fetch domain (interception armed on the held session, the hold released, the FIRST `Fetch.requestPaused` — pausing before the wire — carries the URL; `targetInfo.url` is EMPTY at attach on real Chromium, an accepted fact) and policy-checked with the OPENER session's initiator class: denied => `Fetch.failRequest` (abort BEFORE the wire — zero committed loads, zero bytes to the denied host) + `Target.closeTarget` (destroyed before use) + an evidence row (untrusted-content marked); allowed => `Fetch.disable` (the paused destination resumes and commits) + the target attaches as a tab of the SAME session (hardened, owned; nested popups gated by the same browser gate). No-URL popups (`window.open()` with no destination) and non-session openers are released immediately on opener attribution (no indefinite hold is lawful). A denied target that cannot be closed fails the SESSION (fail-closed). The per-tab page-session `Target.setAutoAttach` stays for tab-scoped session work (the DL-79 scope guard, unchanged shape). |
| Session journal | `src/runtime/journal.ts` | TL3-002 item 3.6 (CROSS-WORKER CONTRACT PIN-1): append-only `.flauz/browser-sessions.jsonl` at the workspace root; one canonical-JSON record + `\n` per open/state-transition/close/failure (schema `flauz.browser-session-journal/v0`, full descriptor snapshots, MANDATORY actor — an unknown initiator fails the write loudly and a journal failure at OPEN fails the session). The read-side `validateSessionJournalLine` is the contract checker for the lane that consumes the journal READ-ONLY; fixtures at `test/fixtures/browser-session-journal/`. P2-FIX-107 (DL-80 at-record layer): secret-shaped query-param VALUES in the journal tab URLs and the `navigated` rows' requested/committed URLs are redacted AT RECORD CONSTRUCTION (URL structure + param names preserved, `[redacted]` marker, the flauz-resources SECRET_SHAPED_PATTERNS class imported — never redefined); URLs without secret-shaped values stay byte-identical, and the continuity export remains the authoritative full-redaction boundary. |
| Capture + evidence | `src/runtime/capture.ts` | Console (`Runtime.consoleAPICalled`, `Log.entryAdded`) and network (`Network.*`) capture buffers, screenshots — each mappable to an evidence row via the EXISTING `toEvidenceRow`. Capture-derived rows that embed page-derived strings (console/network/screenshot/popup URLs) carry the machine-checkable `untrusted-content:` BOUNDARY MARKER in the note (a marker, NOT content sanitization — no sanitization claim). Artifacts flow through the injected `ArtifactWriterPort` to `.flauz/artifacts/<taskId>/` (production: `FileSystemArtifactWriter`; tests: `InMemoryArtifactWriter`). |
| Host adapters | `src/runtime/host.ts` | The `BrowserHost` port with two implementations: `CdpEndpointHost` (an EXTERNAL Chromium over a CDP WebSocket endpoint from `FLAUZ_CDP_ENDPOINT` — the sidecar/headless/test path) and `WorkbenchBrowserHost` (posture P0: `window.openBrowserTab` + `BrowserTab.startCDPSession` through STRUCTURAL ports; the vendored `vscode-dts/vscode.proposed.browser.d.ts` is the only file carrying proposed-API types). |

**Recovery model** (fail-closed, never bypassing policy): on transport drop
the affected sessions go `suspended`; the manager reconnects (fresh transport),
reconciles the tab list against the descriptors (existing targets re-attached
and RESTORED — only targets the ownership registry attributes to the session's
session+partition, TL3-002 item 3.5 — vanished targets marked LOST), re-applies
the FULL mint-time activation to every re-attached tab — domain enables
(`Page.enable`/`Runtime.enable`/`Network.enable`/`Log.enable`, the TL3-P2 fix
for drill finding F-RECOVERY-DOMAINS: real Chromium delivers Page events only
to enabled sessions, so without the re-enable every post-recovery commit
observation timed out and the post-commit reconciliation was skipped) + the
per-session hardening + popup gate — re-checks every recovered tab's URL
against the CURRENT policy (violations surface as evidence rows in the
recovery verdict), and every subsequent navigation is gated against the
current engine again. A failed reconnect marks the sessions `failed` (never a
half-open state). A wedged tab is closed best-effort at the browser level,
marked `failed` with `replacedByTabId` pointing at a fresh `about:blank` tab.
Every state transition is journaled (item 3.6).

**Session state machine**: `opening -> active -> suspended (drop, while
recovering) -> closed`, plus `failed` (with an error record) for: partition
derivation failures, denied start URLs (BEFORE any host interaction), an
unreachable host, tab-activation/hardening failures (TL3-002: an unhardened
tab never becomes active), journal failures at open (TL3-002: a session that
cannot be journaled never opens half-way), popup-gate failures (TL3-002: an
ungovernable target fails the session), and failed reconnects. Human and
agent sessions stay separated by the initiator class pinned in tests both
directions — and, since TL3-002, DISTINGUISHABLE ON THE WIRE: agent sessions
carry the `FlauzAgent/<v>` user-agent product token, human sessions keep the
browser default.

**Running against an external Chromium** (`FLAUZ_CDP_ENDPOINT`):

```sh
chromium --headless --remote-debugging-port=9222   # or a Flauz sidecar service
# the endpoint URL is the ws://.../devtools/browser/<id> from http://127.0.0.1:9222/json/version
FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> ./scripts/code.sh <workspace>
```

Host selection is lazy, at the first runtime command: the workbench browser
API when the proposal is granted to this extension (product.flauz.json
`flauz.flauz-browser: ["browser"]`, posture P0), else `FLAUZ_CDP_ENDPOINT`,
else a fail-closed error message.

## Commands (activation: `onCommand:flauz.browser.*` only)

| Command | What it does |
|---|---|
| `flauz.browser.setPolicy` | Opens `.flauz/browser-policy.json`, creating a deny-all starter template if absent |
| `flauz.browser.showPolicy` | Dumps the effective policy (source, per-layer rules, warnings) to the output channel |
| `flauz.browser.verifyPolicy` | Re-validates the file; PASS, or FAIL with code + JSON path |
| `flauz.browser.checkUrl` | Evaluates a URL at every layer for BOTH initiator classes and logs the verdict table |
| `flauz.browser.evaluate` | Machine surface for the Agent Bridge: `{ url, initiator?, partition?, workspaceRoot? }` -> combined verdict object |
| `flauz.browser.openSession` | Runtime: `{ initiator: 'human' \| 'agent', agentId?, startUrl? }` -> descriptor (a denied startUrl fails the session BEFORE any CDP traffic) |
| `flauz.browser.closeSession` | Runtime: `{ sessionId }` -> sealed descriptor (tabs closed, audit list keeps it) |
| `flauz.browser.sessions` | Runtime: descriptor snapshots of every session |
| `flauz.browser.navigate` | Runtime: `{ sessionId, url, tabId? }` -> the policy-gated navigation outcome (deny => ZERO CDP commands; post-commit violation => the `about:blank` reset recommendation) |
| `flauz.browser.screenshot` | Runtime: `{ sessionId, tabId? }` -> `{ byteLength, base64, artifactPath?, evidenceRow }` (bytes land under `.flauz/artifacts/…`) |

The activation log lines (`flauz.browser: effective policy ...`,
`flauz.browser: policy file INVALID ...`) are the grep targets of the
B-POLICY canary (`build/flauz/canaries/B-POLICY.md`). Since TL3-H2 the
output channel is LOG-BACKED (`createOutputChannel(name, { log: true })`),
so every `flauz.browser:` line ALSO lands in the workbench log corpus at
`<logsLocation>/flauz.flauz-browser/<name>.log` — that file is what the
workbench boot drill greps for the runtime log lines (the A4 boot
assertions); the in-extension channel surface is unchanged.

## Evidence seam

`toEvidenceRow(verdict, taskId)` maps a verdict onto the flauz-workspace
ledger row shape (`{ kind: 'note', uri, sha256, note }`), with `sha256` over
the canonical verdict core (same canonicalization as
`extensions/flauz-workspace/src/api.ts`). The proposed flow (Agent Bridge ->
`flauz.workspace.appendEvidence`) is documented in `INTEGRATION-GAP.md`
section 5; nothing in flauz-workspace is modified.

## Untrusted-content boundary (TL3-002, honest and small)

Capture-derived evidence rows whose note embeds PAGE-DERIVED strings —
console text, network request URLs, the screenshot/tab committed URL, popup
target URLs — carry the machine-checkable `untrusted-content:` prefix in the
row note (`UNTRUSTED_CONTENT_MARKER` / `isUntrustedContentNote` in
`src/runtime/capture.ts`). **This is a BOUNDARY MARKER, not content
sanitization**: the raw page-derived string stays in the note (forensically
useful); consumers must treat everything after the marker as untrusted. No
sanitization claim is made or implied, and nothing is rewritten or stripped.

## Real-Chromium verification (TL3-003 — the optional real-endpoint drill)

The FakeCdpTransport pins the SHAPES of the runtime's CDP conversations; it
makes no claim about real Chromium's behavior. `test/canaries/
real-chromium-hardening.drill.ts` closes that gap the only honest way: it
drives the REAL runtime (`CdpEndpointHost` + `BrowserSessionManager` + the
navigation pipeline + the TL3-002 hardening + the popup gate + the recovery)
against a REAL Chromium over a real CDP WebSocket and asserts REAL observed
evidence — wire frames recorded on the real socket (a `WebSocketCdpTransport`
subclass records every frame SENT — the real-wire analog of the fake's
sent-command log), real committed URLs, real PNG screenshot bytes, real
`navigator.userAgent` reads through an independent observer connection, the
real download state machine, and the real suspend -> reconnect -> re-attach
-> re-harden -> re-check recovery after a mid-session socket kill. Verified
GREEN (43 assertions) against Chrome for Testing 153.0.8010.12 headless.

What it PROVES holds on real Chromium: transport E2E (including ZERO
`Page.navigate` frames on policy deny — asserted on the real wire); the UA
discipline both directions (agent tabs carry `FlauzAgent/0`, observable
cross-session; human tabs keep the browser default with zero override
frames); `Browser.setDownloadBehavior {behavior:'deny'}` acceptance on real
page sessions, its EFFECT (`Browser.downloadWillBegin` ->
`Browser.downloadProgress` state `canceled`), and per-session scoping; and
the recovery path (re-attach + re-hardening + the current-policy recheck
against real browser state — including the hot-swapped-deny variant that
flags the real committed URL).

What it PINS as real-Chromium facts (asserted — drift canaries; if Chromium changes, the drill fails and forces a re-look): **F-DELIVERY** (**FIXED — P2-FIX-106, DL-79**: the gate is placed at BROWSER-level `Target.setAutoAttach`; a `window.open` to a denied host is intercepted, observed, denied, aborted BEFORE the wire — zero bytes to the denied host, proven by the origin-server hit count — and destroyed; drill 3.1d-2..3c), **F-POPUP-URL** (**FIXED — P2-FIX-106**: the empty `targetInfo.url` at attach stays pinned as an accepted real-Chromium fact (a debugger-held target starts NO request); the pending destination is observed PRE-USE through the Fetch domain — the first `Fetch.requestPaused`, pausing before the wire, carries the URL onto the gate event's `observedUrl`; drill 3.1d-2b/5b), and **F-OPENER-BLOCK** (**FIXED — P2-FIX-106**: decisiveness — the gate arms interception and releases the hold immediately on opener attribution, so the opener's `window.open` returns on BOTH paths and the verdict is reached on the first paused request; the no-destination popup is released with the bounded no-request window disarming interception; drill 3.1d-4/6/7). **F-RELEASE-CMD** and **F-RECOVERY-DOMAINS** remain pinned as FIXED (TL3-P2). All pinned at unit level by `test/popup-gate.test.ts` with the re-modeled fake mirroring real browser-level delivery.

**All five originally pinned findings are now FIXED — two by the TL3-P2
partition A product-readiness audit (branch `tl3/p2-partition-a`), and the
remaining three by P2-FIX-106 (branch `flauz-p2fix/p2-fix-106`, decision
DL-79), each with a unit regression suite and a flipped real-wire drill
assertion:** **F-RELEASE-CMD** (TL3-P2) — the gate releases held
targets with the REAL CDP command `Runtime.runIfWaitingForDebugger` (`Runtime.run`
is not a real method; with the wrong command every policy-ALLOWED popup was
closed instead of attached on a real browser; the fake now models the real
wire, rejecting `Runtime.run` like real Chromium); **F-RECOVERY-DOMAINS**
(TL3-P2) — the recovery re-attach now runs the FULL mint-time activation on the fresh
session (domain enables + hardening + per-tab auto-attach; previously the missing
`Page.enable` re-send made every post-recovery commit observation time out on
real Chromium, silently skipping the security-relevant post-commit
reconciliation after each transport drop); and **F-DELIVERY / F-POPUP-URL /
F-OPENER-BLOCK** (P2-FIX-106, DL-79) — the browser-level placement + Fetch
pre-use observation redesign described above.

```sh
# launch a real Chromium (a DevTools endpoint + popup blocking disabled —
# Runtime.evaluate runs without a user gesture):
chromium --headless=new --no-sandbox --disable-gpu --disable-popup-blocking \
         --remote-debugging-port=9222 --user-data-dir=/tmp/flauz-chrome about:blank
# take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
  node test/canaries/real-chromium-hardening.drill.ts
# no FLAUZ_CDP_ENDPOINT (or FLAUZ_REALCHROMIUM_SKIP=1, or an unreachable
# endpoint) => SKIP with exit 0: never fail a gate for lacking a browser.
```

The drill is NOT part of `npm test` and CI does not require it (B-POLICY
documents it as the optional real-endpoint drill). Local allowed/denied
hosts come from a 127.0.0.1 origin server the drill starts itself — real
navigations, no external network, no secrets.

## Workbench boot drill (TL3-H2 — the P0 posture, boot-verified)

The B-POLICY canary's A4/A6/A10 "stays boot-level" notes asked for a real
driver invoking the command surface in a BOOTED workbench. The TL3-H2 boot
drill delivers it as CI job `b-policy-boot-drill`
(`.github/workflows/flauz-browser.yml`; workflow_dispatch + a weekly
schedule — it compiles the workbench): a TEST-DRIVER EXTENSION
(`test/fixtures/browser-policy-driver/` — CI test infrastructure, not a
product extension; no flauz- prefix; installed into the canary profile's
`--extensions-dir`) activates in the booted workbench and invokes
`flauz.browser.openSession` / `navigate` / `sessions` / `closeSession`
through the REAL lazy onCommand activation machinery. The zero-dep
evaluator `build/flauz/scripts/b-policy-boot-drill.mjs` asserts both
sides — the driver report (typed denial, session open through
`window.openBrowserTab` + `startCDPSession` + the TL3-002 hardening over
the real session, the `persist:flauz-<16hex>-boot-drill` partition,
zero-send denied navigation, the audit list, the clean close) and the log
corpus (the activation record, the proposal trip-wires, the runtime log
lines from the log-backed channel, the PIN-1 journal the booted runtime
writes). One honest SKIP row remains (the Electron webRequest
`ERR_BLOCKED_BY_CLIENT` line — exact reason in the spec's row catalogue).
Full spec: `build/flauz/canaries/B-POLICY.md` "Workbench boot drill".

## Development

Zero dependencies; Node >= 20 stdlib only (runs under plain `node --test`
type-stripping and inside the extension host).

```sh
cd extensions/flauz-browser
npm run typecheck   # tsc --noEmit (typescript 5.9.x)
npm run test        # node --test "test/*.test.ts"  (206 cases: 100 policy-family + 106 runtime/extension — the TL3-H2 log-backed-channel pin added 1)
node test/canaries/policy-gated-navigation.drill.ts   # the B-POLICY A-class driver drill (TL3-001 + TL3-002 assertions)
FLAUZ_CDP_ENDPOINT=<real ws endpoint> node test/canaries/real-chromium-hardening.drill.ts   # the OPTIONAL real-Chromium drill (TL3-003; SKIPs without a real endpoint)
```

Suites: `policy` / `partition` / `precedence` / `cdpBypass` / `extension`
(the 96 legacy cases, semantics untouched; `policy` gained the 4 additive
`security`-key cases) + `cdp-transport` / `cdp-fake` / `session-manager` /
`runtime-tabs` / `capture` / `recovery` / `host-workbench` (the TL3-001
runtime suites) + the TL3-002 suites: `hardening` (3.1/3.2), `popup-gate`
(3.3), `g6-reset` (3.4), `tab-ownership` (3.5), `journal` (3.6),
`untrusted-content` (3.7) + `url-redaction` (P2-FIX-107 / DL-80: the at-record query-value redaction suite). Fixtures live at the repo root:
`test/fixtures/browser-policy/` (good/bad policy files — including the
`security` good/bad cases — the CDP-bypass case matrix, the partition-name
matrix) and `test/fixtures/browser-session-journal/` (the PIN-1 journal
contract: valid sample + invalid samples — missing actor, wrong schema,
non-canonical).
