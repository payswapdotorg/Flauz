# Flauz Canary Checklist — Non-Copilot Default Agent (U-1 / C-20 closure)

**Task:** W3-F-R-b (Wave 3 Lane F rebuild) · **Base tree:** `payswapdotorg/Flauz` @ `9bf9ae764da438b1234a8243dc9e47173ef58ee7` · **Branch:** `flauz/wave3/agent-bridge`

## Purpose

This checklist closes **U-1** from the Wave 1/c capability matrix
(`docs/CODE-OSS-INTEGRATION-MATRIX.md`, wave1/c-capability-matrix worktree; preserved read:
`/home/z/my-project/tool-results/read_1790349700889_1bae23ec0ede.txt`):

> **U-1** — C-20/C-23/C-24/C-28 gating depth: *Which of the ⚠ surfaces light up with a
> **non-Copilot default agent** (own participant) vs. require the in-tree copilot extension
> fork?* How to close: *Build a minimal default-agent participant against `lm` + tools;
> smoke-test picker/subagents/browser tools.*

against the **C-20** row:

> **C-20** Model picker + model management UI — **AVAILABLE ⚠** — `widget/input/modelPicker/`
> stack, `chatManagement/`, `aiCustomization/` management editor — ⚠ gated on a default chat
> agent (`product.json:90–157` → Copilot); "Flauz re-points `defaultChatAgent` (build input)".

The Wave 3 Lane F posture goes one step further than the wave1/c suggestion ("re-point"):
the Flauz v0 overlay **deletes** `defaultChatAgent` from the merged product (null-deletes in
`build/flauz/merge-product.mjs`). This checklist enumerates every warning/notice surface that
lights up, goes dark, or changes behavior as a result, with in-tree citations.

## Scope

- **flauz.agent** becomes the default chat agent because:
  1. the built-in extension `extensions/flauz-agent` statically contributes
     `contributes.chatParticipants[{ id: "flauz.agent", isDefault: true, locations: ["panel"], ... }]`
     (parsing gated on the `defaultChatParticipant` / `chatParticipantAdditions` proposals —
     force-enabled via `product.flauz.json#extensionEnabledApiProposals`, the DL-4 pattern), and
  2. `defaultChatAgent` is **absent** from the merged product, which no-ops the Copilot
     setup/entitlement stack so no core `setup.*` agent competes for the default slot.
- The merged v0 product is produced by
  `node build/flauz/merge-product.mjs --base product.json --overlay product.flauz.json`.
- **Not in scope:** runtime execution (no vscode build exists in this sandbox). Items that need
  a running workbench are marked VERIFY-IN-CI and are Worker G / CI scope (MIGRATION-PLAN §5).

## How to read

Each item **D1..D11** states: the *surface*, the *expected behavior in the Flauz v0 posture*,
*in-tree citations* (`file:line`), and a *closure status*:

| Status | Meaning |
|---|---|
| **CLOSED-BY-DESIGN** | Static analysis of the pinned tree fully determines the behavior; no runtime check needed. |
| **VERIFY-IN-CI** | Behavior is expected but must be confirmed in a running workbench (Worker G / CI). |
| **N/A** | Cannot occur in the v0 posture (documented for future overlay variants). |
| **DOCUMENTED-DEBT** | Cosmetic or non-user-visible Copilot/GitHub residue; tracked for future re-branding. |

Citations originate from worklog recon **W3-F-r3** (verified at 9bf9ae764da in the pre-reset
sandbox) and were re-verified in this tree during W3-F-R-b (paths in this clone differ slightly
from the recon shorthand: `chatAgents.ts` lives at
`src/vs/workbench/contrib/chat/common/participants/chatAgents.ts`, `chatParticipant.contribution.ts`
at `src/vs/workbench/contrib/chat/browser/`, `chatEntitlementService.ts` at
`src/vs/workbench/services/chat/common/`, the chatSetup/chatStatus files under
`src/vs/workbench/contrib/chat/browser/`). The load-bearing gates (D1, D2, D5, D7 anchors) were
re-read line-by-line during this rebuild.

---

## D1 — Master gate: the Copilot setup/entitlement stack no-ops

- **Surface:** the entire `ChatEntitlementService` wiring — context keys, entitlement requests,
  quota tracking, sign-in state, ChatEntitlementContext persistence.
- **Flauz v0 posture:** the service constructor returns early when
  `productService.defaultChatAgent` is absent, so the whole setup/sign-in/entitlement surface
  stack is keyed off **product config existence, never on Copilot-the-extension being installed**.
  With the key deleted, nothing downstream initializes.
- **Citations:** `src/vs/workbench/services/chat/common/chatEntitlementService.ts:458-460`
  (`if (!productService.defaultChatAgent) { return; // we need a default chat agent configured … }`);
  the deleted block itself is `product.json:90-157` (`extensionId: "GitHub.copilot"`,
  `chatExtensionId: "GitHub.copilot-chat"`, entitlement URLs, provider map).
- **Status:** **CLOSED-BY-DESIGN.**

## D2 — Default-agent resolution: flauz.agent is the sole default

- **Surface:** default chat agent selection for every location/mode.
- **Flauz v0 posture:** `getDefaultAgent` filters registered agents to `isDefault && locations.includes(location)`
  and `_preferExtensionAgent` picks the last non-core agent, falling back to the last core agent.
  `flauz.agent` is registered from the static `chatParticipants` contribution (isDefault from the
  manifest), while the core `setup.chat/edits/agent/terminal/editor/notebook` agents named
  "GitHub Copilot" are registered from `registerSetupAgents`, which only runs when the entitlement
  context exists — i.e. never, because D1 disabled the service. Result: **flauz.agent is the sole
  default agent**; bare chat requests route to it (`chatServiceImpl.ts` rejects only when no
  default agent exists at all).
- **Citations:** `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts:459-467`
  (`getDefaultAgent`) and `:478-484` (`_preferExtensionAgent` — `findLast(agents, agent => !agent.isCore) ?? agents.at(-1)`);
  `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts:268-276`
  (isDefault/modes require the `defaultChatParticipant` proposal; `locations` requires
  `chatParticipantAdditions`) and `:314-318` (isDefault/locations/modes flow into `registerAgent`);
  `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts:107-157`
  (`registerSetupAgents`, only invoked with a live entitlement context per W3-F-r3);
  proposal force-enablement: `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:43-55`
  (product-key ingestion) and `:80-102` (product list REPLACES the extension's own declaration).
- **Status:** **CLOSED-BY-DESIGN.**

## D3 — Signed-out sign-in surfaces: unreachable in v0

- **Surface:** the sign-in/setup prompts that WOULD light up (entitlement `Unknown`) if
  `defaultChatAgent` were kept pointing at Copilot while the extension is absent:
  - Command palette **"Use AI Features with Copilot for free..."**
    (`chatSetupContributions.ts:225-243`, label at `:227`);
  - Accounts menu **"Sign in to use GitHub Copilot..."** (`chatSetupContributions.ts:368-396`, W3-F-r3);
  - Title-bar **"Sign In"** entry (`chatSetupContributions.ts:398-433`, W3-F-r3);
  - Status bar **`$(copilot)` Sign In** (`chat.statusBarEntry`; `chatStatusEntry.ts:320-407` — the
    signed-out branch `entitlement === ChatEntitlement.Unknown` returns the setup entry props);
  - Dashboard hover card **"Set up Copilot to use AI features."** + "Use AI Features" button
    (`chatStatusDashboard.ts:585-638`, string at `:602`);
  - Getting Started step **"Use AI features with Copilot for free"** gated on
    `'chatEntitlementSignedOut && !chatAnonymous && !github.copilot.hasByokModels'`
    (`gettingStartedContent.ts:266`);
  - Editor context menu **Explain / Fix / Code Review** while `!chatSetupCompleted`
    (`chatSetupContributions.ts:615-656`, W3-F-r3) — with the additional hazard that
    Explain/Fix execute `github.copilot.chat.explain/fix`, which are unregistered commands
    without the extension (dead-command risk).
- **Flauz v0 posture:** every one of these surfaces is driven by entitlement state produced by
  the service disabled in D1, and/or by `chatSetup*` context keys that never bind. They are
  **unreachable** — no sign-in prompt of any kind appears.
- **Status:** **CLOSED-BY-DESIGN** (unreachable in v0; would all come back if a future overlay
  re-added a `defaultChatAgent` block — see D4).

## D4 — Setup execution path failures without a gallery

- **Surface:** what a user would see if they triggered chat setup with `defaultChatAgent` present
  but no marketplace: error dialog **"An error occurred while setting up chat. Would you like to
  try again?"** (`chatSetupController.ts:276-281`; the install goes through
  `extensionsWorkbenchService.install(defaultChat.chatExtensionId, …)` at `:292-299`), in-chat
  warning **"Chat setup failed."** (`chatSetupProviders.ts:729-732`), palette retry dialog
  (`chatSetupContributions.ts:279-283`, W3-F-r3), in-chat progress "Signing in to {provider}"/
  "Getting chat ready" (`chatSetupProviders.ts:685-702`, W3-F-r3), and the 20s-timeout warning
  that names `GitHub.copilot-chat` explicitly (`chatSetupProviders.ts:395-403`).
- **Flauz v0 posture:** the setup path cannot execute (D1 deleted its trigger), so these failures
  cannot occur. **Important posture fact:** the upstream base `product.json` @ 9bf9ae764da ships
  **without an `extensionsGallery` key** (46 top-level keys; worklog W3-F-r1), and the v0 overlay
  neither sets nor strips a gallery — so any *future* overlay that re-adds `defaultChatAgent`
  without also adding a gallery would immediately hit every failure in this item.
- **Citations:** as above; gallery absence: `product.json` key enumeration (W3-F-r1),
  `src/vs/base/common/product.ts:147-155` (the optional `extensionsGallery` type).
- **Status:** **N/A** (documented for future overlay variants).

## D5 — `chatIsEnabled` / generic AI features without setup agents

- **Surface:** generic AI features gated on the `chatIsEnabled` context key — debug chat, browser
  chat, MCP menu, terminal chat.
- **Flauz v0 posture:** static analysis says any default-agent *implementation* registration sets
  `chatIsEnabled` (`chatAgents.ts:408-410`, `registerAgentImplementation` →
  `this._hasDefaultAgent.set(true)` when `entry.data.isDefault`) — previously this was guaranteed
  by the core setup agents; now it must come from `flauz.agent`'s activation. The exact runtime
  behavior with **zero** setup agents registered must be confirmed in a running workbench.
- **Citations:** `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts:408-410`;
  context keys `chatIsEnabled`/`chatPanelParticipantRegistered` bound at `chatAgents.ts:322/324`
  (declared `chatContextKeys.ts:75/117`, W3-F-r1).
- **Status:** **VERIFY-IN-CI.** Explicit test:
  1. Produce the merged product: `node build/flauz/merge-product.mjs --base product.json --overlay product.flauz.json --out <build>/product.json` (repo root as cwd).
  2. Launch the workbench with that product and `extensions/flauz-agent` + `extensions/flauz-models` built in.
  3. Command Palette → **`Developer: Inspect Context Keys`**.
  4. Assert `chatIsEnabled === true` after flauz-agent activates and `flauz.agent` registers.
  5. Assert `chatPanelParticipantRegistered === true`.
  6. Spot-check one gated generic feature (e.g. the terminal chat action or an MCP menu entry) is enabled.

## D6 — Status bar `chat.statusBarEntry` signed-out state

- **Surface:** the `$(copilot)` status bar entry and its signed-out/sign-in variants.
- **Flauz v0 posture:** the entry's rendering is keyed on entitlement state from the service
  disabled in D1; the expectation is that the entry never appears in a fresh profile. Because the
  entry has its own lifecycle (visibility updates, `isNewUser` checks via `chatStatus.ts`), this
  must be confirmed at runtime rather than by static analysis alone.
- **Citations:** `src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusEntry.ts:320-407`
  (`getEntryProps` sign-in branches, e.g. `entitlement === ChatEntitlement.Unknown` → setup entry).
- **Status:** **VERIFY-IN-CI.** Explicit test: launch the merged-product workbench with a fresh
  user-data dir; assert no `$(copilot)` / "Sign In" status bar entry ever renders; open the chat
  view and re-check.

## D7 — Model picker (C-20) behavior with flauz models

- **Surface:** the model picker button, dropdown, welcome/empty states.
- **Flauz v0 posture:** the `setupRequired` reason is computed from entitlement state
  (`modelPickerPresentation.ts:70-79`: `entitlement === Available`, or `Unknown && !anonymous &&
  !hasByokModels`). With the entitlement service disabled the picker is not setup-gated, and once
  flauz-mock registers live models via the (stable) `registerLanguageModelChatProvider` API, the
  unavailable reason clears (`modelPickerPresentation.ts:94-98`) and the picker lists models
  normally. The genuine empty state is the generic **"No models available"**
  (`modelPickerItemSections.ts:105-129`). A vendor whose provider never activates resolves to a
  **silent log warn only, no UI** (`src/vs/workbench/contrib/chat/common/languageModels.ts:1241-1244`).
- **Citations:** as above; plus `languageModels.ts:49` (`COPILOT_VENDOR_ID`) and `:1159`
  (vendor `isDefault`) per W3-F-r3 for the copilot-vendor special-casing that stays dormant.
- **Status:** **CLOSED-BY-DESIGN** (with flauz-models installed, the models list normally;
  residual hard-coded "Copilot" strings in this area are tracked in D10).

## D8 — Copilot-extension-dependent surfaces: stay dark

- **Surface:** everything that requires the actual `GitHub.copilot-chat` extension to be
  installed and active:
  - Copilot's `chatViewsWelcome` error cards (expired / enterprise-disabled / offline /
    invalid-token / rate-limited / login-failed / contact-support / chat-disabled /
    release-channel), all keyed on `github.copilot.*` context keys —
    `extensions/copilot/package.json:2383-2438`;
  - chat tips (suppressed while entitlement `Unknown && !byok`, even though `_isCopilotEnabled`
    is product-keyed — `chatTipService.ts:452-460` and `:857-860`, W3-F-r3);
  - quota / "Copilot Resumed" status states (need resolved quotas → a GitHub account) and the
    Upgrade / Manage-Budget menu items (need Free+ entitlement) —
    `chatSetupContributions.ts:453-562`, W3-F-r3;
  - `ChatCompatibilityNotifier` (requires an *installed* chat extension whose id mismatches
    `defaultChatAgent.chatExtensionId` — `chatParticipant.contribution.ts:346-392`, W3-F-r3).
- **Flauz v0 posture:** none of these can appear; the chat view empty state falls back to the
  generic welcome (`chatViewPane.ts:1821-1830` — `shouldShowWelcome` false while any agent,
  i.e. flauz.agent, exists; view when-clause `!chatSetupHidden` is generic,
  `chatParticipant.contribution.ts:73-83`, W3-F-r3).
- **Status:** **CLOSED-BY-DESIGN.**

## D9 — Conditional / experiment-gated surfaces: default off

- **Surface:** anonymous access (TOS card "Try GitHub Copilot for free, no sign-in required!" on
  the agent-sessions welcome; dashboard "Limited/Chat messages"; anonymous setup variants) and
  the growth-session "Try Copilot" item.
- **Flauz v0 posture:** all gated behind `chat.allowAnonymousAccess` / experiments that default
  to off, so they are unreachable regardless of the default-agent posture.
- **Citations:** `src/vs/workbench/services/chat/common/chatEntitlementService.ts:315-331`
  (anonymous gating; W3-F-r3), `src/vs/workbench/contrib/welcomeAgentSessions/browser/agentSessionsWelcome.ts:713-770`
  (TOS card), `src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusDashboard.ts:415-418`,
  `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupGrowthSession.ts:73-90` + experiment
  gate `chatSetupContributions.ts:190-219` (W3-F-r3).
- **Status:** **N/A** (default off; do not enable in Flauz without re-auditing these strings —
  they are Copilot-branded).

## D10 — Hard-coded "Copilot"/GitHub literals that survive re-pointing (cosmetic debt)

- **Surface:** user-visible core strings that reference Copilot/GitHub regardless of product
  config — re-pointing or deleting `defaultChatAgent` does **not** re-brand them. Some core
  strings interpolate `defaultChat.provider.default.name` ("GitHub") but the word "Copilot"
  itself is hard-coded in `localize()` strings.
- **Inventory (file:line):**
  - `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts:549` — "Sign in to use GitHub Copilot";
  - `src/vs/workbench/contrib/chat/browser/widget/input/modelPicker/modelPickerItemSections.ts:66,74` — "Sign in to use Copilot(…)" (setup-required header/items);
  - `src/vs/workbench/contrib/chat/common/promptSyntax/languageProviders/promptValidator.ts:636` — prompt-file diagnostic tells users to enable `github.copilot.chat.githubMcpServer.enabled`;
  - `src/vs/workbench/contrib/mcp/browser/mcpCommandsAddConfiguration.ts:91-100` — MCP add-config delegates to `github.copilot.chat.mcp.setup.*` commands;
  - `src/vs/workbench/contrib/terminal/browser/terminalMenus.ts:903-915` — AI-profile name heuristic (`github.copilot-chat` / name contains 'copilot'/'claude');
  - `src/vs/workbench/contrib/chat/browser/chatSlashCommands.ts:158` — `/help` debug path executes `github.copilot.debug.showChatLogView`.
- **Status:** **DOCUMENTED-DEBT** (future re-branding wave; most are on surfaces that are dark or
  secondary in the v0 posture, but they are live code paths in core).

## D11 — Telemetry/debug-only Copilot assumptions (non-user-visible debt)

- **Surface:** internal-only special cases that assume the Copilot extension exists.
- **Inventory (file:line, W3-F-r3):**
  - `src/vs/workbench/services/assignment/common/assignmentFilters.ts:109,130-131` — experiment filters hard-code `getExtension('github.copilot')`;
  - `src/vs/workbench/contrib/chat/common/languageModels.ts:63-101` — BYOK telemetry bucketing;
  - `src/vs/workbench/api/common/extHostChatAgents2.ts:1588-1590` — `isBuiltinParticipant` checks the `github.copilot` prefix;
  - `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts:382` — `'chat.setup'` / `'github.copilot.editsAgent'` literal;
  - `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupProviders.ts:599-621` — `whenToolsModelReady` waits for a `copilot_` tool prefix;
  - `src/vs/workbench/api/browser/mainThreadLanguageModelTools.ts:126-127` and `src/vs/workbench/api/browser/mainThreadLanguageModels.ts:105` — copilot-extension special cases (`defaultChatAgent?.chatExtensionId` reads become `undefined` → the special case simply doesn't trigger);
  - `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostMcpServerSupport.ts:23-27` — GitHub MCP collection id set.
- **Status:** **DOCUMENTED-DEBT** (non-user-visible; harmless no-ops with `defaultChatAgent`
  deleted, but they encode Copilot assumptions that will resurface if Flauz ever deepens these
  subsystems).

---

## Closure criteria summary

| Status | Items | Count |
|---|---|---|
| CLOSED-BY-DESIGN | D1, D2, D3, D7, D8 | 5 |
| VERIFY-IN-CI | D5, D6 | 2 |
| N/A (documented) | D4, D9 | 2 |
| DOCUMENTED-DEBT | D10, D11 | 2 |
| **Total** | | **11** |

**U-1 is closed for the v0 posture** (non-Copilot default agent via own participant +
`defaultChatAgent` deletion): the answer to "which ⚠ surfaces light up" is *none of the
sign-in/setup/quota surfaces* (D1–D4, D8, D9) — they are entitlement-driven and the entitlement
stack is product-gated off; the model picker (C-20) works generically once Flauz models register
(D7); the only runtime unknowns are the `chatIsEnabled` wiring without setup agents (D5) and the
status-bar entry lifecycle (D6). **Runtime verification of D5/D6 is Worker G / CI scope**
(MIGRATION-PLAN §5) using the explicit test commands above; D10/D11 are tracked re-branding debt.
