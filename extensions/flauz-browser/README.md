# Flauz Browser Policy & Runtime (extensions/flauz-browser)

Wave 4, Lane I (worker `flauz-I-w4`) + TL3-001 (browser runtime): the layered
browser navigation policy engine for Flauz's agent browser surface — driver-side
allowlist (AUTHORITATIVE for agent-initiated navigation) + webRequest rules +
will-navigate rules + per-workspace/agent partition containment, with
`.flauz/browser-policy.json` as the per-workspace, git-diffable policy source —
and, since TL3-001, the Flauz-controlled Chromium/CDP **browser runtime** that
the policy engine has been waiting for: sessions, policy-gated navigation,
capture, and recovery (ARCHITECTURE-LOCK section 3 browser v2 posture: CDP as
a Flauz-controlled sidecar/service; posture P0 of INTEGRATION-GAP.md in the
workbench).

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
	}
}
```

- Every key except `schemaVersion` is optional; omitted layers default to
  deny-all with the layer enabled (fail-closed).
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
5. **Post-commit reconciliation:** `reconcileCommittedUrl` flags a violating
   committed URL and recommends the `about:blank` forced reset
   (SECURITY-MODEL section 4 F2).

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
| Navigation pipeline | `src/runtime/tabs.ts` | The heart (posture P0): (1) verdict via `engine.evaluate` with the SESSION's initiator class; (2) **deny: NO CDP command is sent at all**; (3) allow: `Page.navigate` -> await the COMMITTED url -> `reconcileCommittedUrl` -> on violation return the `about:blank` forced-reset recommendation + evidence row (SECURITY-MODEL 4 F2). Wedged tabs (command timeout on a live transport) are replaced. |
| Capture + evidence | `src/runtime/capture.ts` | Console (`Runtime.consoleAPICalled`, `Log.entryAdded`) and network (`Network.*`) capture buffers, screenshots — each mappable to an evidence row via the EXISTING `toEvidenceRow`. Artifacts flow through the injected `ArtifactWriterPort` to `.flauz/artifacts/<taskId>/` (production: `FileSystemArtifactWriter`; tests: `InMemoryArtifactWriter`). |
| Host adapters | `src/runtime/host.ts` | The `BrowserHost` port with two implementations: `CdpEndpointHost` (an EXTERNAL Chromium over a CDP WebSocket endpoint from `FLAUZ_CDP_ENDPOINT` — the sidecar/headless/test path) and `WorkbenchBrowserHost` (posture P0: `window.openBrowserTab` + `BrowserTab.startCDPSession` through STRUCTURAL ports; the vendored `vscode-dts/vscode.proposed.browser.d.ts` is the only file carrying proposed-API types). |

**Recovery model** (fail-closed, never bypassing policy): on transport drop
the affected sessions go `suspended`; the manager reconnects (fresh transport),
reconciles the tab list against the descriptors (existing targets re-attached
and RESTORED, vanished targets marked LOST), re-checks every recovered tab's
URL against the CURRENT policy (violations surface as evidence rows in the
recovery verdict), and every subsequent navigation is gated against the
current engine again. A failed reconnect marks the sessions `failed` (never a
half-open state). A wedged tab is closed best-effort at the browser level,
marked `failed` with `replacedByTabId` pointing at a fresh `about:blank` tab.

**Session state machine**: `opening -> active -> suspended (drop, while
recovering) -> closed`, plus `failed` (with an error record) for: partition
derivation failures, denied start URLs (BEFORE any host interaction), an
unreachable host, and failed reconnects. Human and agent sessions stay
separated by the initiator class pinned in tests both directions.

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
B-POLICY canary (`build/flauz/canaries/B-POLICY.md`).

## Evidence seam

`toEvidenceRow(verdict, taskId)` maps a verdict onto the flauz-workspace
ledger row shape (`{ kind: 'note', uri, sha256, note }`), with `sha256` over
the canonical verdict core (same canonicalization as
`extensions/flauz-workspace/src/api.ts`). The proposed flow (Agent Bridge ->
`flauz.workspace.appendEvidence`) is documented in `INTEGRATION-GAP.md`
section 5; nothing in flauz-workspace is modified.

## Development

Zero dependencies; Node >= 20 stdlib only (runs under plain `node --test`
type-stripping and inside the extension host).

```sh
cd extensions/flauz-browser
npm run typecheck   # tsc --noEmit (typescript 5.9.x)
npm run test        # node --test "test/*.test.ts"  (156 cases: 96 policy + 60 runtime)
node test/canaries/policy-gated-navigation.drill.ts   # the B-POLICY A-class driver drill
```

Suites: `policy` / `partition` / `precedence` / `cdpBypass` / `extension`
(the 96 legacy cases, semantics untouched) + `cdp-transport` / `cdp-fake` /
`session-manager` / `runtime-tabs` / `capture` / `recovery` /
`host-workbench` (the TL3-001 runtime suites). Fixtures live at the repo
root: `test/fixtures/browser-policy/` (good/bad policy files, the CDP-bypass
case matrix, the partition-name matrix).
