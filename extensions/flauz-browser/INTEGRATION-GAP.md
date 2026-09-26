# Flauz Browser Policy — integration gap analysis (extension-land vs product-side)

**Lane:** Wave 4 / Worker I (`flauz-I-w4`), branch `flauz/wave4/browser-policy`.
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
| Post-commit reconciliation verdicts (SECURITY-MODEL section 4 F2) | `src/policy.ts` `reconcileCommittedUrl` | Computes the violation + the `about:blank` reset recommendation; the actual forced reset is product-side (gap G6). |

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

`chat.agent.networkFilter` defaults to `false`
(`chat.shared.contribution.ts:1551`), so L2 is off unless the user/enterprise
enables it (the setting is `restricted` + backed by an enterprise policy,
`ChatAgentNetworkFilter`, `:1554-1563` — the tree's own managed floor, cf.
SECURITY-MODEL section 2.4). The Flauz default-on posture for agent scope
(SECURITY-MODEL section 4 F3) is reachable WITHOUT a fork via
`contributes.configurationDefaults` in a future `flauz-defaults` built-in
(the pinning pattern the C-20 canary already uses for
`extensions.experimental.affinity`). Lossy: application-scope only, not
per-workspace; combine with P0 for workspace granularity.

### G4 — will-navigate as a security gate

Not wireable and intentionally so (`browserView.ts:328-344` — upstream keeps
security in L1/L2/L4; SECURITY-MODEL section 4 L3 row records "NOT a security
gate today"). The engine models it exactly this way (user-path rules; CDP
navs skip it; the kill-switch tests prove driver+webRequest suffice). No gap
to close; documented to prevent a future lane from "fixing" it wrong.

### G5 — Partition naming control

`BrowserSession` factories derive partition identity from
scope/workspaceId/affinity/windowId (`browserSession.ts:134-180`); the
proposed `vscode.proposed.browser.d.ts` surface (`window.openBrowserTab`,
`:90`; `BrowserTab.startCDPSession`, `:24`) exposes NO session/partition
options (`BrowserTabShowOptions :50-62` is view-only). Flauz's
`persist:flauz-<hash>[-<agent>]` names can therefore only be minted by a
product-side change: either (a) expose partition/session selection on the
proposed browser API (upstream-proposal-shaped, zero fork today), or (b) the
G2-style provider hook extended to session creation. Until then the engine's
partition verdicts are audit/containment surface (and the naming contract for
the future wiring) — DL-29 candidate records the name shape as normative.

### G6 — Post-commit forced reset (the committed-URL residual)

Wave-1 probe B1c: canceling the request does not roll back the committed
URL. The in-tree reconciliation trigger would live in the main-process
navigation-event path (`browserView.ts` navigation events, e.g.
`fireNavigationEvent` near `:352`; `did-navigate` handlers) with
`webContents.loadURL(RESET_URL)`-class authority — no extension surface
reaches it. The engine's `reconcileCommittedUrl` computes the verdict +
reset target; the enforcement wiring is a product-side change (another
DL-31-adjacent candidate, or an upstream-proposal issue).

## 4. Ranked integration postures

| Posture | Fork cost | What it gives | Status |
|---|---|---|---|
| **P0 — extension-driven tabs (proposed API)** | zero (DL-19 product grant `extensionEnabledApiProposals["flauz.flauz-browser"] = ["browser"]`) | The extension opens agent browser tabs itself via `window.openBrowserTab` + `startCDPSession` (proposed `vscode.proposed.browser.d.ts:64-91`) and consults its OWN driver-layer verdict BEFORE any `Page.navigate` — the driver-side allowlist is then genuinely authoritative for the Flauz agent path, per-workspace, zero fork. L2 still needs G3/P1 for defense-in-depth. | Proposed DL-29/DL-30 posture; the product grant is a one-line `product.flauz.json` addition when the lane lands |
| **P1 — config-only default-on L2** | zero (`flauz-defaults` configurationDefaults, or enterprise policy `ChatAgentNetworkFilter`) | Turns the in-tree webRequest filter on for all agent sessions (application scope) | No code yet; documented for the flauz-defaults lane |
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
verdict/audit objects, and the evidence-row seam are now extension-land
facts (this lane). The remaining wiring is precisely enumerated above
(G1-G6) with zero-fork postures (P0/P1) ranked ahead of any src/vs hook
(P2), keeping the FORK-CRITICAL ledger empty (DL-12) unless the TL
adjudicates DL-31.
