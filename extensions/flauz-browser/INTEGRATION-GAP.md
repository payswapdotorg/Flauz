# Flauz Browser Policy — integration gap analysis (extension-land vs product-side)

**Lane:** Wave 4 / Worker I (`flauz-I-w4`), branch `flauz/wave4/browser-policy`;
updated by TL3-001 (browser runtime, Worker A), TL3-002 (browser session
security, Worker A, branch `tl3/a2-browser-security`), TL3-003 (the
real-Chromium hardening drill + the G3/P1 verification, Worker A, branch
`tl3/a3-browser-real`) and TL3-H2 (the post-completion hardening: the
workbench boot drill + the G5/G3 permanent limitation records, Worker A,
branch `tl3/h2-browser-product-residuals`).
**Scope:** what `extensions/flauz-browser` owns today vs. what only a
product-side change can wire into the in-tree browser platform. Tree
citations are repo-relative `path:line` against the flauz/main base
`67b0b081de0a5c786d681a383637390f16c62c6b` (src/vs pristine per DL-12; the
same layer inventory was verified at the Wave-1/Wave-2 reference sha
`9bf9ae764da` by Workers B and D).

**Binding constraint (work order):** DO NOT modify `src/vs/**`. Everything
below is analysis + proposal; the only code this lane ships lives under
`extensions/flauz-browser/`.

---

## 1. What extension-land OWNS today (this lane, shipped)

| Capability | Where | Notes |
|---|---|---|
| Layered policy engine (driver / webRequest / willNavigate / partition) | `src/policy.ts` | Deny-at-any-layer precedence; driver deny authoritative; deny-all builtin default; kill-switch insurance; fail-closed invariants. 96 node --test cases pin it. |
| Per-workspace policy source `.flauz/browser-policy.json` (schema `flauz.browser-policy/v0`) | `src/policy.ts` `parsePolicyText` | Git-diffable (DL-9 family), schema-validated with typed error classes (`FLAUZ_POLICY_PARSE/VERSION/SCHEMA/PARTITION`), patterns normalized at load. |
| Partition derivation + validation `persist:flauz-<workspace-hash>[-<agent-id>]` | `src/policy.ts` `derivePartition` / `validatePartitionName` / `checkPartition` | 16-hex workspace hash (sha256 of the root), agent-id shape `[A-Za-z0-9._-]{1,64}`, scope + cross-workspace containment verdicts. |
| Verdict objects (allow/deny/layer/reason + audit context) and the evidence-row mapping | `src/policy.ts` `PolicyVerdict` / `toEvidenceRow` | Row shape = the flauz-workspace `LedgerRowInput` (`extensions/flauz-workspace/src/api.ts:63-69`); seam = the `flauz.workspace.appendEvidence` command (`extensions/flauz-workspace/src/commands.ts:89-106`). |
| Command surface + activation discipline | `src/extension.ts`, `package.json` | Lazy `onCommand:flauz.browser.*` activation only (no `onStartupFinished`; activation-lint R1-R3 clean). Policy file hot-reload via FileSystemWatcher. |
| Host-pattern matcher mirroring the tree filter semantics | `src/policy.ts` `isDomainAllowed` | Byte-for-byte the same algorithm as `src/vs/platform/networkFilter/common/domainMatcher.ts:257-275` + `networkFilterService.ts:26-35`, so extension-land verdicts agree with the in-tree gate wherever both run. |
| Post-commit reconciliation verdicts (SECURITY-MODEL section 4 F2) | `src/policy.ts` `reconcileCommittedUrl` | Computes the violation + the `about:blank` reset recommendation. **TL3-002: the EXECUTION is now RUNTIME-SIDE** — `src/runtime/tabs.ts` `runForcedReset` navigates the offending runtime-owned tab to `about:blank` THROUGH the policy engine when `security.enforceReset` is true (the default, fail-closed; explicit `false` opt-outs are recorded in the verdict). What remains product-side is the MAIN-PROCESS loadURL authority for tabs the runtime does not own (gap G6 residual). |
| **The browser RUNTIME (TL3-001)** — CDP client, sessions, policy-gated navigation, capture, recovery | `src/cdp/`, `src/runtime/` | The runtime posture P0 was waiting for: `BrowserSessionDescriptor` (flauz.browser-session/v0), the navigation pipeline (deny => ZERO CDP commands; post-commit violation => the F2 reset recommendation), console/network/screenshot capture + evidence rows, drop/wedged recovery, `CdpEndpointHost` (FLAUZ_CDP_ENDPOINT) + `WorkbenchBrowserHost` (proposed browser API). Pinned by 60 new node --test cases + the driver drill. |
| **Session security hardening (TL3-002)** — per-session UA discipline, download deny, popup/new-target gate, G6 reset execution, partition-scoped tab ownership, the session journal, the untrusted-content marker | `src/runtime/hardening.ts`, `src/runtime/journal.ts`, `src/runtime/sessionManager.ts`, `src/runtime/tabs.ts`, `src/runtime/capture.ts` | Items 3.1-3.7 of the TL3-002 work order, all fail-closed, all extension-land: `Browser.setDownloadBehavior {behavior:'deny'}` on every session (v0 has NO allow surface); `Emulation.setUserAgentOverride` with the `FlauzAgent/<v>` product token on agent sessions only (humans keep the browser default — distinguishable on the wire); `Target.setAutoAttach` popup gate closing denied targets before use; the narrow typed `runForcedReset` (only about:blank, through the engine) driven by the ADDITIVE policy key `security.enforceReset`; the target-ownership registry + typed cross-partition/foreign-session tab-use errors; the append-only `.flauz/browser-sessions.jsonl` journal (PIN-1 contract, mandatory actor); the `untrusted-content:` boundary marker on capture-derived evidence rows (a MARKER, not sanitization). Pinned by 40 new node --test cases + the extended drill. |
| **The REAL-Chromium verification (TL3-003)** — the optional real-endpoint drill `test/canaries/real-chromium-hardening.drill.ts` | `test/canaries/real-chromium-hardening.drill.ts` | The "FakeCdpTransport pins the shapes, not Chromium's behavior" closure: the REAL runtime (CdpEndpointHost + BrowserSessionManager + hardening + popup gate + recovery) driven against a real Chromium over a real CDP WebSocket, asserting real wire frames / committed URLs / PNG bytes / navigator.userAgent / download state machines / popup timing / recovery — and PINNING the five real-Chromium divergences from the fake's contract (F-DELIVERY, F-POPUP-URL, F-RELEASE-CMD, F-OPENER-BLOCK, F-RECOVERY-DOMAINS; see "What remains"). SKIP without `FLAUZ_CDP_ENDPOINT`; never fails a gate for lacking a browser. |

## 2. The in-tree gate inventory (verified at this HEAD)

| Layer | Tree location | What it enforces | Extension-land reach |
|---|---|---|---|
| L1 driver-side pre-navigation gate | `src/vs/workbench/contrib/browserView/electron-browser/tools/navigateBrowserTool.ts:62-116` (`prepareToolInvocation` throws on `getBrowserNetworkPolicyError(params.url, ...)` at `:100-103`, re-checked in `invoke` at `:134-137`), helper at `tools/browserToolHelpers.ts:226-242` | The `navigate_page` tool refuses to drive the browser to disallowed URLs BEFORE issuing CDP | NONE today: the check consults `IAgentNetworkFilterService`, which reads APPLICATION-scoped settings (gap G1/G2) |
| L2 webRequest filter | `src/vs/platform/browserView/electron-main/browserSession.ts:310-330` (`updateNetworkFilter` installs `webRequest.onBeforeRequest` on Agent-scope sessions only, `storageScope === Agent` check at `:311`), service `src/vs/platform/networkFilter/common/networkFilterService.ts:103-127`; propagation `browserViewMainService.ts:81-83` (`onDidChange` -> `BrowserSession.updateNetworkFiltering()`, `browserSession.ts:119-129`) | Cancels content/subresource requests in agent sessions | NONE directly: enablement + lists come from `chat.agent.networkFilter` / `chat.agent.allowedNetworkDomains` / `chat.agent.deniedNetworkDomains` (declared `chat.shared.contribution.ts:1548-1590`, defaults `false`/`[]`/`[]`, scope APPLICATION, `restricted: true`, enterprise policy `ChatAgentNetworkFilter` at `:1554-1563`) |
| L3 will-navigate | `src/vs/platform/browserView/electron-main/browserView.ts:328-344` (`will-navigate`/`will-redirect` handlers `preventDefault()` ONLY for pinned-navigation redirects; favicon bookkeeping otherwise) | UX correctness only — NOT a security gate by design (B1c: CDP-initiated navs never fire it) | Not needed: the engine models it as user-path-only rules; the B1c insurance (driver+webRequest carry the deny) is pinned by tests |
| L4 session partitions | `src/vs/platform/browserView/electron-main/browserSession.ts:134-180` (global `persist:vscode-browser` `:135`; workspace `session.fromPath(<workspaceStorage>/...)` `:143-148`; ephemeral `:153-162`; agent in-memory `vscode-browser-agent-<sha256(identity)>` `:165-180`, identity = affinity/workspace/window) | Cookie-jar isolation per scope | Partially: the engine derives/validates Flauz partition NAMES, but nothing in extension-land mints an Electron partition with those names (gap G5) |
| L5 origin permissions | `src/vs/platform/browserView/electron-main/browserSessionPermissions.ts:121-` (`configure` installs `setPermissionRequestHandler` at `:183-`) | Per-origin permission store, default-ask | Out of this lane's scope (SECURITY-MODEL section 4 L5) |
| L6 file:// trust | `src/vs/platform/browserView/electron-main/browserSession.ts:341-347` (`protocol.handle(file)` serves only `_trustedFileRoots` TST matches, 403 otherwise) | Stops `file://` reads of arbitrary disk from web content | Complementary: the policy engine's driver-layer `fileRoots` gate models the same posture extension-side (fail-closed default) |
| L7 TLS trust | `src/vs/platform/browserView/electron-main/browserSessionTrust.ts:46-` (per-session trusted-cert memory, `:158-` etc.) | Per-session cert-error handling | Out of this lane's scope |

## 3. The gaps (what only a product-side change can wire)

### G1 — Per-workspace policy source vs APPLICATION-scoped settings

The tree's only network-policy inputs are `chat.agent.networkFilter`,
`chat.agent.allowedNetworkDomains`, `chat.agent.deniedNetworkDomains`
(`src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts:1548-1590`),
all `scope: ConfigurationScope.APPLICATION` and `restricted: true`. There is
NO per-workspace network policy surface in the tree — which is exactly the
`.flauz/browser-policy.json` gap this lane fills extension-side. Wiring that
file into the tree's own gates requires either G2 (service hook) or G3
(config translation, lossy: workspace-granularity is lost).

### G2 — Driver layer consults `IAgentNetworkFilterService` directly

`navigateBrowserTool.ts:100-103` throws from
`getBrowserNetworkPolicyError(url, agentNetworkFilterService)`
(`browserToolHelpers.ts:226-229`: `isUriAllowed(uri) ? undefined :
formatError(uri)`). The service is a settings-backed singleton instantiated
in the main process (`src/vs/code/electron-main/app.ts:1252`) and consumed
in main + shared/browserView process services (`browserViewMainService.ts:78`,
`playwrightService.ts:77,300`, `playwrightTab.ts:59`, `playwrightChannel.ts:35`,
`sharedProcessMain.ts`, plus `webContentExtractorService.ts:27` for the fetch
path). An extension cannot inject a per-workspace provider into that
consultation. **Candidate product-side hook (DECISION-LOG proposal DL-31):**
a provider interface in `src/vs/platform/networkFilter/common/` (e.g.
`INetworkPolicyProvider { getVerdict(url, context): 'allow'|'deny'|undefined }`)
consulted by `AgentNetworkFilterService.isUriAllowed` BEFORE the settings
fallthrough, with workbench-side plumbing for per-workspace providers
registered by a flauz built-in. This is a FORK-CRITICAL ledger entry (DL-12):
any `src/vs` divergence requires a decision-log entry + demotion
alternative. **Demotion alternative (zero-fork):** P0 below — the extension
drives its own tabs through the proposed browser API and gates them itself.

### G3 — webRequest enablement default

**STATUS: PERMANENTLY RECORDED (TL3-H2) — a VERIFIED EXTENSION-PLATFORM
LIMITATION, not a TODO.** The verified blocker below is final as far as
extension-land is concerned: no `extensions/flauz-*` code path can pin
this default. Any future implementation MUST use an architecture-allowed
product-side path (one of the three alternatives below) — that is the
standing law recorded in TL3-HANDOFF ("The network-filter default is
documented as an extension-platform limitation. Any future
implementation must use an architecture-allowed product-side path.").
The DECISION-LOG proposal recording the blocker + the alternatives is
drafted in the TL3-H2 delivery (DL number pending station assignment at
the merge wave); until the station promotes it, this section is the
in-repo record.

`chat.agent.networkFilter` defaults to `false`
(`chat.shared.contribution.ts:1551`), so L2 is off unless the user/enterprise
enables it (the setting is `restricted` + backed by an enterprise policy,
`ChatAgentNetworkFilter`, `:1554-1563` — the tree's own managed floor, cf.
SECURITY-MODEL section 2.4).

**VERIFIED BLOCKER (TL3-003, branch `tl3/a3-browser-real`, read-only tree
analysis — DELIVERED-AS-FINDING; status made permanent by TL3-H2):** the
candidate zero-fork fix — a future `flauz-defaults` built-in contributing
`configurationDefaults` pinning `chat.agent.networkFilter: true` — is
IMPOSSIBLE. The `configurationDefaults` extension-point handler builds
`allowedScopes =
[MACHINE_OVERRIDABLE, WINDOW, RESOURCE, LANGUAGE_OVERRIDABLE]`
(`src/vs/workbench/api/common/configurationExtensionPoint.ts:217`) and DELETES
any contributed default whose registered property's scope is outside that
list, warning "Cannot register configuration defaults for '{0}'. Only
defaults for machine-overridable, window, resource and language overridable
scoped settings are supported." (`:227-232`). `chat.agent.networkFilter` is
`scope: ConfigurationScope.APPLICATION` (`chat.shared.contribution.ts:1552`;
the enum value is 1, `configurationRegistry.ts:184-188`) — not in the list.
Notably the `restricted: true` flag is NOT the blocker for defaults (the
handler consults only `disallowConfigurationDefault` — absent on this
setting — and the scope); the APPLICATION scope is. The pinning pattern the
C-20 canary/activation-lint R4 anticipates for
`extensions.experimental.affinity` transfers because that setting has NO
explicit scope (`src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts:269-285`
→ WINDOW → allowed); networkFilter cannot use the same mechanism.

**The P1 posture therefore needs one of the product-side alternatives**
(exact, with tree citations — all three remain OPEN product-side decisions;
none is a TODO of this lane):

1. **Enterprise policy `ChatAgentNetworkFilter`** (declared at
   `chat.shared.contribution.ts:1554-1563`): policy values ride the policy
   service and override everything at read time
   (`src/vs/platform/configuration/common/configurations.ts:202-203`, where
   `config.policy` value/managedSettings/restrictedValue are merged ahead of
   all other layers). Zero fork — but shippable only as a DEPLOYMENT-level
   (managed settings / OS policy) decision, not as in-repo product code.
2. **A product-side defaults layer (fork-critical, DL-12 class):** an in-tree
   workbench contribution calling
   `configurationRegistry.registerDefaultConfigurations(...)` directly — the
   registry API carries no scope restriction (the gate exists only at the
   extension point, `configurationExtensionPoint.ts:215-236`); the in-repo
   precedent is `ConfigurationDefaultOverridesContribution`
   (`src/vs/workbench/services/configuration/browser/configurationService.ts:1351+`,
   which registers experimental-setting defaults exactly this way). A Flauz
   `src/vs` contribution pinning `{ 'chat.agent.networkFilter': true }` is
   therefore possible but is a FORK-CRITICAL ledger entry requiring the TL's
   adjudication.
3. **Zero-fork provisioning pin:** APPLICATION scope means "can be configured
   only in default profile user settings" (`configurationRegistry.ts:185-187`)
   — so the Flauz packaging/first-boot layer can pin the value by seeding the
   default profile's `settings.json` (the exact mechanism the B-POLICY canary
   already proves per-boot, `build/flauz/canaries/B-POLICY.md` setup step 1,
   and the workbench boot drill job reuses). Per-install posture, not a repo
   default.

Until one of those lands (a product-side decision), extension-land's
defense is posture P0 (LANDED: the runtime gates its OWN tabs through the
policy engine per-workspace — boot-verified end to end by the TL3-H2
workbench boot drill).

### G4 — will-navigate as a security gate

Not wireable and intentionally so (`browserView.ts:328-344` — upstream keeps
security in L1/L2/L4; SECURITY-MODEL section 4 L3 row records "NOT a security
gate today"). The engine models it exactly this way (user-path rules; CDP
navs skip it; the kill-switch tests prove driver+webRequest suffice). No gap
to close; documented to prevent a future lane from "fixing" it wrong.

### G5 — Partition naming control

**STATUS: PERMANENTLY RECORDED (TL3-H2) — a VERIFIED PRODUCT LIMITATION,
not a TODO.** Extension-land CANNOT mint Electron partitions carrying the
flauz names. This is a structural property of the tree surfaces, verified
against them (citations below); it cannot be worked around from
`extensions/flauz-browser` by any architecture-allowed path, and the
zero-fork postures below are the standing answer.

`BrowserSession` factories derive partition identity from
scope/workspaceId/affinity/windowId (`browserSession.ts:134-180`); the
proposed `vscode.proposed.browser.d.ts` surface (`window.openBrowserTab`,
`:90`; `BrowserTab.startCDPSession`, `:24`) exposes NO session/partition
options (`BrowserTabShowOptions :50-62` is view-only: viewColumn,
preserveFocus, background). Flauz's `persist:flauz-<hash>[-<agent>]` names
can therefore only be minted by a product-side change.

**Classification (fork-critical-demoted per the DL-12 pattern):** no
`src/vs` divergence is carried for this gap. The DEMOTION ALTERNATIVE —
what ships instead, zero fork — is exactly what LANDED: posture P0 (the
extension drives its own tabs through the proposed browser API and gates
them itself) plus the partition NAMING CONTRACT as the audit/containment
surface: the engine derives/validates flauz partition names
(`src/policy.ts` `derivePartition` / `validatePartitionName` /
`checkPartition`), the runtime enforces partition-scoped tab ownership
over the targets it mints (TL3-002 item 3.5, typed
cross-partition/foreign-session errors), and every session record —
descriptor, verdicts, the PIN-1 journal — carries the flauz partition
name, so the naming contract stays the audit surface for any future
wiring. The workbench boot drill (TL3-H2, job `b-policy-boot-drill`)
boot-verifies the audit side: the booted runtime's session + journal
records carry `persist:flauz-<16hex>-boot-drill` end to end.

**Future architecture-allowed paths (the only ways this limitation can
lift; both are product-side decisions, recorded here so a future lane
does not rediscover the analysis):**

1. an UPSTREAM PROPOSAL CHANGE exposing session/partition selection on
   the proposed browser API (an `openBrowserTab` options surface that
   accepts a partition/session identity; upstream-proposal-shaped, zero
   fork once upstreamed — the `vscode.proposed.browser.d.ts:50-62`
   surface would carry it);
2. the G2-style provider hook extended to session creation (fork-critical
   ledger entry, DL-12 class, DL-31 family — requires TL adjudication and
   a demotion alternative before any `src/vs` divergence).

**Decision record:** the DECISION-LOG proposal recording this limitation
is drafted in the TL3-H2 delivery (fork-critical-demoted, demotion
alternative = P0 + the naming contract; DL number pending station
assignment at the merge wave). Until the station promotes it, this
section is the in-repo record.

### G6 — Post-commit forced reset (the committed-URL residual)

Wave-1 probe B1c: canceling the request does not roll back the committed
URL. **TL3-002 status: EXECUTED runtime-side.** The runtime's navigation
pipeline now executes the recommended `about:blank` reset on its OWN tabs
through the policy engine (`runForcedReset` — the narrow typed operation that
can navigate nowhere else), driven by the ADDITIVE policy key
`security.enforceReset` (default true = fail-closed; explicit `false` records
the opt-out in the verdict). The remaining product-side surface: the
main-process navigation-event path (`browserView.ts` `fireNavigationEvent`
near `:352`; `did-navigate` handlers) with `webContents.loadURL(RESET_URL)`-class
authority for targets the Flauz runtime does NOT own — no extension surface
reaches that (the residual stays a DL-31-adjacent candidate or an
upstream-proposal issue).

## 4. Ranked integration postures

| Posture | Fork cost | What it gives | Status |
|---|---|---|---|
| **P0 — extension-driven tabs (proposed API)** | zero (DL-19 product grant `extensionEnabledApiProposals["flauz.flauz-browser"] = ["browser"]`) | The extension opens agent browser tabs itself via `window.openBrowserTab` + `startCDPSession` (proposed `vscode.proposed.browser.d.ts:64-91`) and consults its OWN driver-layer verdict BEFORE any `Page.navigate` — the driver-side allowlist is then genuinely authoritative for the Flauz agent path, per-workspace, zero fork. L2 still needs G3/P1 for defense-in-depth. | **LANDED (TL3-001) + BOOT-VERIFIED END TO END (TL3-H2)**: the grant is live in `product.flauz.json` (plus the manifest `enabledApiProposals: ["browser"]`), `WorkbenchBrowserHost` implements the adapter over structural ports, and the runtime + driver drill satisfy the DL-33 no-dead-config discipline (live code path behind the grant). The TL3-H2 workbench boot drill (job `b-policy-boot-drill`) boot-verified the full path in a REAL booted workbench: the lazy onCommand activation, the live grant (no proposal trip-wire), a session opened through `window.openBrowserTab` + `BrowserTab.startCDPSession` + the TL3-002 hardening over the real session, the typed policy denial, and the runtime log lines in the log corpus. |
| **P1 — config-only default-on L2** | zero (`flauz-defaults` configurationDefaults, or enterprise policy `ChatAgentNetworkFilter`) | Turns the in-tree webRequest filter on for all agent sessions (application scope) | **BLOCKED-AS-SPECIFIED, PERMANENTLY RECORDED (TL3-003 finding; TL3-H2 permanent record):** the `flauz-defaults` configurationDefaults mechanism CANNOT pin `chat.agent.networkFilter` — APPLICATION scope is rejected at the extension point (`configurationExtensionPoint.ts:217,227-232`; details in G3 above). The posture needs one of the three named product-side alternatives: enterprise policy `ChatAgentNetworkFilter`, a fork-critical in-tree `registerDefaultConfigurations` contribution (DL-12 class, precedent `configurationService.ts:1351+`), or the zero-fork default-profile settings.json provisioning pin (the B-POLICY canary / boot-drill pattern). A VERIFIED extension-platform limitation awaiting a product-side decision — not a TODO. |
| **P2 — minimal src/vs hook (provider interface)** | FORK-CRITICAL ledger entry (DL-12/DL-10) | Per-workspace verdicts feed the tree's own L1/L2 gates directly (G2/G5/G6 closure) | DECISION-LOG proposal only (DL-31); demotion alternative = P0+P1 |

## 5. The evidence-ledger seam (no file changes required)

`toEvidenceRow(verdict, taskId)` produces exactly the
`LedgerRowInput` shape the flauz-workspace ledger validates
(`extensions/flauz-workspace/src/ledger.ts:93-117` `validateRowInput`):
`{ kind: 'note', uri, sha256, note }` with `sha256` over the canonical
verdict core (identical canonicalization discipline,
`extensions/flauz-workspace/src/api.ts:148-161`). Proposed flow for the
Agent Bridge (lane F integration note):

1. bridge calls `flauz.browser.evaluate` -> verdict;
2. bridge writes `canonicalJson(verdictCore)` to
   `.flauz/artifacts/<taskId>/browser-verdict-<hash16>.json` (DL-21 shape 5);
3. bridge calls `flauz.workspace.appendEvidence` `{ taskId, row: { kind:
   'note', uri: <that artifact path>, sha256, note: verdictSummary } }`
   (`extensions/flauz-workspace/src/commands.ts:89-106`).

Nothing in `extensions/flauz-workspace/**` is modified by this lane; the seam
is proposed and the row mapping is pinned by tests
(`test/policy.test.ts` `toEvidenceRow` cases).

## 6. Conclusion

The browser platform is in-tree and agent-native (DL-1/DL-6); the policy
ENGINE, the per-workspace policy SOURCE, the partition NAMING CONTRACT, the
verdict/audit objects, the evidence-row seam, — since TL3-001 — the BROWSER
RUNTIME itself (posture P0 LANDED: sessions, policy-gated navigation,
capture, recovery), — since TL3-002 — the SESSION SECURITY HARDENING
(per-session UA discipline, deny-by-default downloads, the popup/new-target
gate, the EXECUTED G6 reset, partition-scoped tab ownership, the PIN-1
session journal, the untrusted-content boundary marker), and — since TL3-003
— the REAL-CHROMIUM verification of that runtime (the optional real-endpoint
drill, GREEN against Chrome for Testing 153, pinning five real-Chromium
divergences from the FakeCdpTransport contract) plus the VERIFIED G3/P1
answer (the `flauz-defaults` configurationDefaults posture is impossible for
`chat.agent.networkFilter`; the alternatives are named in G3) are
extension-land facts. — since TL3-H2 — the P0 posture is BOOT-VERIFIED END
TO END (the workbench boot drill: the lazy onCommand activation, the live
`browser` grant, `window.openBrowserTab` + `startCDPSession` + the TL3-002
hardening over the real session, the typed policy denial, the runtime log
lines in the log corpus, the PIN-1 journal from the booted runtime), and the
two product-side residuals are PERMANENTLY RECORDED as verified product
limitations (G3: the extension-platform APPLICATION-scope blocker with the
three named product-side alternatives; G5: the partition-minting limitation
with the demotion alternative = P0 + the naming contract). The remaining
wiring is precisely enumerated above (G1-G6 residuals) with zero-fork
postures (P0 landed + boot-verified / P1 blocked-as-specified with
product-side alternatives, both permanently recorded) ranked ahead of any
src/vs hook (P2), keeping the FORK-CRITICAL ledger empty (DL-12) unless the
TL adjudicates DL-31.

**What remains (state after the TL3-H2 delivery — branch
`tl3/h2-browser-product-residuals`):**

- SHIPPED (TL3-002, `tl3/a2-browser-security`): 3.1 per-session
  user-agent discipline, 3.2 deny-by-default downloads (no allow surface by
  design), 3.3 the popup/new-target gate, 3.4 the G6 forced-reset EXECUTION
  runtime-side (`security.enforceReset`, additive v0 key), 3.5
  partition-scoped tab ownership (typed cross-partition/foreign-session
  errors; ownership-guarded recovery re-attach), 3.6 the session journal
  (PIN-1 contract + fixtures), 3.7 the untrusted-content boundary marker,
  3.8 those docs.
- SHIPPED (TL3-003, `tl3/a3-browser-real`): the REAL-Chromium hardening
  drill `test/canaries/real-chromium-hardening.drill.ts` — the REAL runtime
  (CdpEndpointHost + BrowserSessionManager + hardening + popup gate +
  recovery) driven against a real Chromium over a real CDP WebSocket
  (verified: Chrome for Testing 153.0.8010.12, headless). GREEN with 43
  assertions, SKIP without `FLAUZ_CDP_ENDPOINT`. It COVERS, with real
  observed evidence: the transport E2E (real wire frames, real committed
  URLs, real PNG screenshot bytes), the UA discipline both directions
  (agent token present and cross-session observable; human default
  preserved; zero override frames on the human path), the download deny
  (command accepted on real page sessions, EFFECT observable via
  `Browser.downloadWillBegin` -> `Browser.downloadProgress` state
  `canceled`, per-session scoping), and the recovery path (real-socket kill
  -> suspend -> reconnect -> re-attach -> re-HARDENING (wire + UA evidence)
  -> current-policy recheck against REAL browser state, including the
  hot-swapped-deny variant flagging the real committed URL).
- REAL-CHROMIUM FINDINGS pinned by the TL3-003 drill (asserted as
  observed — divergences between real Chromium and the FakeCdpTransport
  contract, recorded for the TL, NOT papered over):
  - **F-DELIVERY**: `Target.setAutoAttach` on a PAGE session (the popup
    gate's placement) does NOT deliver `window.open` popups on real
    Chromium — popups are browser-level targets and free-run past the
    page-level gate. The fake models popup delivery to the opener
    target's sessions; real Chromium does not provide it.
  - **F-POPUP-URL**: at browser-level attach (`waitForDebuggerOnStart`),
    a `window.open` popup arrives with `targetInfo.url` EMPTY — the
    pending navigation URL is NOT available at gate time.
  - **F-RELEASE-CMD**: `Runtime.run` is NOT a real CDP method (real
    Chromium rejects it with "'Runtime.run' wasn't found"); the real
    release command is `Runtime.runIfWaitingForDebugger`. The gate's
    allow-path (`sessionManager.ts` `handleAttachedTarget`) sends
    `Runtime.run`.
  - **F-OPENER-BLOCK**: `window.open` BLOCKS the opener's JS while the
    popup is held; the call returns only after release — and never
    returns if the held popup is closed without release (the deny-path
    shape). The browser-level deny-path PRIMITIVE (close a held popup
    before use via `Target.closeTarget` -> target destroyed) and the
    allow-path primitive (`Runtime.runIfWaitingForDebugger` release)
    both hold on real Chromium.
  - **F-RECOVERY-DOMAINS**: the recovery re-attach does not re-send the
    domain enables (`Page.enable` et al. — `activateLiveTab` runs them
    only at mint time), so on real Chromium `Page.frameNavigated` never
    flows on the fresh session and the post-recovery commit OBSERVATION
    times out (the security-relevant post-commit reconciliation is
    skipped after recovery). The fake cannot catch this: it emits Page
    events without modeling domain-enable state. The current-policy
    recheck itself is browser-state based (`Target.getTargets`) and
    survives.
  These are the exact fix candidates for the TL station to adjudicate
  (browser-level auto-attach placement / URL-observation strategy;
  release-command rename; domain re-enable on recovery) — each changes
  landed TL3-001/TL3-002 runtime semantics pinned by the unit suites, so
  they are recorded, not patched, by this lane.
- RECORDED — G5 (partition NAMING control): **PERMANENTLY RECORDED
  (TL3-H2) as a verified product limitation** — the workbench host cannot
  mint Electron partitions with the flauz names (the proposed API exposes
  no session/partition options; the in-tree factories derive identity from
  scope/workspace/affinity/window); the endpoint host gets whatever
  partition the external Chromium/sidecar configures. Extension-land
  enforces ownership/isolation over the targets it mints; the Electron
  cookie-jar minting stays product-side (do not attempt extension-side).
  Standing posture: fork-critical-demoted — P0 + the partition naming
  contract as the audit surface (see G5 above for the full record, the
  demotion alternative, and the two future architecture-allowed paths).
- RECORDED — the in-tree L2 default-on posture (G3/P1):
  **PERMANENTLY RECORDED (TL3-H2)** — the verified extension-platform
  limitation that the `flauz-defaults` `configurationDefaults` mechanism
  is IMPOSSIBLE for `chat.agent.networkFilter` (APPLICATION scope rejected
  at the extension point; see G3 above for the verified enforcement path
  and the three named product-side alternatives: enterprise policy
  `ChatAgentNetworkFilter`, the fork-critical in-tree
  `registerDefaultConfigurations` contribution, the zero-fork
  default-profile settings.json provisioning pin). Awaiting a
  product-side decision; not a TODO of any extension lane.
- OPEN — G6 residual: main-process `loadURL` authority for targets the
  Flauz runtime does not own.
- CLOSED — boot-level workbench verification of the P0 surface (real
  `window.openBrowserTab` under the grant — the B-POLICY boot residuals):
  **LANDED by the TL3-H2 workbench boot drill** (job `b-policy-boot-drill`;
  spec: `build/flauz/canaries/B-POLICY.md` "Workbench boot drill") — the
  real `window.openBrowserTab` + `BrowserTab.startCDPSession` under the
  product grant, the `flauz.browser.*` command surface activation (the
  ExtensionService record + the command registration + the runtime log
  lines in the log corpus), the typed policy denial at boot, and the
  PIN-1 journal from the booted runtime are all boot-verified through the
  test-driver extension. The one remaining in-tree surface — the
  `ERR_BLOCKED_BY_CLIENT` webRequest log line class — is the drill's
  honest SKIP row (exact reason recorded in the spec's row catalogue: the
  runtime's driver deny is authoritative BEFORE the wire, so no request
  exists for the in-tree L2 filter to cancel; PASS only when genuinely
  observed).
