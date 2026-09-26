# INTEGRATION-GAP — flauz-environments vs the tree (Wave 4, Lane J)

The extension-land vs product-side boundary for the environment registry and the
resolver/remote machinery it builds on. Every row cites tree paths (flauz/main @
a4c245147e8f, upstream pristine per DL-12). Headline: **the v0 environment story
requires ZERO product-side code** — everything composes on upstream surfaces;
the only product-file touch any future step needs is a `product.flauz.json`
proposal grant (build-time overlay, DL-16 semantics), which is not a fork.

## 1. What v0 shipped (extension-land, this lane)

- Registry + descriptors + plans + continuity model: `extensions/flauz-environments/src/`
  (pure TypeScript, zero deps; `src/extension.ts` is the only vscode-importing file).
- All live connections are OUT (plans are the artifact; runners execute them —
  REPORT GAPS-AND-SKIPS).
- Activation is command-driven only (`onCommand:flauz.env.*`); activation-lint R3
  caps `onStartupFinished` at the two Wave-3 extensions (flauz-agent +
  flauz-workspace) — this extension stays off it.

## 2. The boundary, surface by surface

| # | Surface | Where it lives | Mechanism | Gap for Flauz |
|---|---|---|---|---|
| 1 | Resolver registration (`registerRemoteAuthorityResolver(authorityPrefix, resolver)`) | extension-land | PROPOSED API `resolvers` — `src/vscode-dts/vscode.proposed.resolvers.d.ts:456`; catalog entry `src/vs/platform/extensions/common/extensionsApiProposals.ts:408-410` | Wave-4-next: grant `"flauz.flauz-environments": ["resolvers"]` via `product.flauz.json` (see §3). v0 deliberately ships `enabledApiProposals: []` — no dead config (DL-19 grant = the moment live resolver code lands). |
| 2 | Authority resolution + nested `a@b` transit | upstream | `vscode.proposed.resolvers.d.ts:17-26` (RemoteAuthorityResolverContext.execServer), `:381-433` (resolver contract) | none (rides the same `resolvers` grant as #1) |
| 3 | In-tree remote server + tunnels | upstream | `src/vs/server/` (non-electron server + ext host connection services); `cli/src/tunnels/` + `remoteTunnel` contrib; product naming `code-tunnel-oss` (`product.json:16`) | none for v0; Flauz tunnel product naming is a build input (C-31) |
| 4 | AHP RemoteProxy bridge (renderer <-> server-side agent host) | upstream platform + extension-land handshake | channel `AgentHostIpcChannels.RemoteProxy` = `'agentHostProxy'` — `src/vs/platform/agentHost/common/agentService.ts:66-72`; handshake = resolver passes `--agent-host-bridge-port` + `VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN` env (blueprint `extensions/vscode-test-resolver/src/extension.ts:26`, `:166-194`; mutual exclusion with `--agent-host-port` at `:169-175`) | extension-land resolver implementation (v0: the plan carries the handshake; execution is Wave-4-next). NO product code. |
| 5 | Dev-container agent host | upstream platform | `IDevContainerAgentHostMainService` — `src/vs/platform/agentHost/common/devContainerAgentHost.ts:36-46` (`connect`/`disconnect`/`isDockerAvailable`/`onDidOutput`), config contract `:13-19`, result `:21-29`; workbench surface `src/vs/workbench/contrib/chat/browser/remoteAgentHost/` (contribution registered `WorkbenchPhase.AfterRestored` — `remoteAgentHost.contribution.ts:25-26`) | extension-land provider adapter (v0: plan only). Dev container CLI + spec are OSS; MS Dev Containers EXTENSION stays out (license, DL-7). |
| 6 | Cloud sandboxes (E2B-class) | extension-land providers | in-tree `cloudSandbox*` services are Copilot-entitlement-bound (reference only, DL-8): `src/vs/platform/agentHost/common/cloudSandboxAgentHost.ts` + `src/vs/workbench/contrib/chat/browser/remoteAgentHost/cloudSandbox*.ts`; read-only tier precedent `cloudSandboxReadOnlySessionHandler.ts` | Flauz cloud sandbox = provider extension (resolver + AHP); keys referenced via vault (`apiKeyRef`), never materialized (SECURITY-MODEL 3.5). NO product code. |
| 7 | Environment picker surface | extension-land v0 (commands); native env-adjacent surfaces exist | native remote surfaces: `RemoteStatusIndicator` (`src/vs/workbench/contrib/remote/browser/remoteIndicator.ts:73`, authority `:132-133`, remote menu `:194`), Remote Explorer (`VIEWLET_ID` `workbench.view.remote` — `remoteExplorer.ts:41`); the tabbed model picker (`src/vs/workbench/contrib/chat/browser/widget/input/modelPicker/`) is the UI pattern an env picker composes with (no native "environment registry picker" exists — it is authority-driven) | v0: `flauz.env.*` command palette surface. A picker/tree view = extension-land view (stable API). A product-side env picker would be FORK-CRITICAL-class — demoted per DL-12; propose instead via the extension view. |
| 8 | Chat-session re-hydration | upstream infra + extension-land composition | `IChatSessionsService` — `src/vs/workbench/contrib/chat/common/chatSessionsService.ts:802-804`; chat editing + checkpoints `src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSessionStorage.ts` + `chatEditingSessionCheckpointTimeline.ts`; edit sessions `src/vs/workbench/contrib/editSessions/`; AHP replay `src/vs/platform/agentHost/common/taskEventReplay.ts` | re-open-based continuity composes these (continuity model `src/continuity.ts`). Third-party session CONTENT providers need the `chatSessionsProvider` proposal (catalog `extensionsApiProposals.ts:99-100`) — only when Flauz ships its own session content provider (C-36 connector work). |
| 9 | Environment trust boundaries | upstream outer ring + Flauz policy | workspace trust `src/vs/platform/workspace/common/workspaceTrust.ts`; untrusted workspace degrades everything (SECURITY-MODEL 2.1); environment escape = `environmentPower`-class permission, default-confirm; read-only cloud tier default (SECURITY-MODEL 3.4) | descriptor `trust` block + posture defaults (providers/*.ts) encode the Flauz-side policy; enforcement rides native gates — no new gate code needed. |
| 10 | Switch overhead accounting | extension-land marks + upstream telemetry | `code/flauz/*` mark pairs ride `$setPerformanceMarks` (DL-23 best-effort forwarding; PERF 6.2 item 1); budgets 1.5 s warm / 500 ms choreography (PERF 5.5); mark-pair integrity guard = PERF 6.3 | v0: the hook set + budget checker are in `src/continuity.ts`; actual emission lands with the live switch driver (Wave-4-next) from the Agent Bridge ext host. |
| 11 | Extension-host isolation | config (flauz-defaults, future lane) | `extensions.experimental.affinity` pins ext-host slots (activation-lint R4-R6: ONE pinned slot total across flauz extensions — `extensionRunningLocationTracker.ts:167-204` cost model) | if the environments extension ever needs its own host, that is a DECISION-LOG entry (DL-5 discipline); v0 stays on the shared host (registry work is lightweight, command-activated). |

## 3. Proposal grants: the exact mechanism (DL-19)

- The product allowlist REPLACES the extension's own declaration:
  `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:42-55`
  (map build from `productService.extensionEnabledApiProposals`), `:80-102`
  (product list WINS; the mismatch error at `:90-96`).
- The `DOES NOT EXIST` warning when a proposal name drifts:
  `extensionsProposedApi.ts:47-50` — this is the A3-class tripwire the Wave-3
  canaries already grep for; the rota (`build/flauz/scripts/proposed-api-rota.mjs`)
  inventories the union.
- Current `product.flauz.json` grants: `flauz.flauz-agent`
  (`defaultChatParticipant`, `chatParticipantAdditions`), `flauz.flauz-workspace`
  (`scmArtifactProvider`). v0 of this extension adds NOTHING (empty array).
- Wave-4-next (live resolver code): `"flauz.flauz-environments": ["resolvers"]`.
  Nothing else on the path to live SSH/container/cloud connections needs a
  grant — `resolvers` covers registration, tunnels factory, exec-server
  transit (`vscode.proposed.resolvers.d.ts:381-433`).

## 4. Product-side code (FORK-CRITICAL ledger)

**EMPTY.** No `src/vs/**` change is required by any surface above. The only
product-file deltas in this lane's branch are additive: new files under
`extensions/flauz-environments/`, `build/flauz/`, `.github/workflows/flauz-*`,
`test/fixtures/`, plus one narrow append to
`.eslint-allowed-javascript-files` (established flauz/main precedent — lines
171-180 carry the Wave-3 `.mjs` entries; the file gates the upstream
`local/code-no-new-javascript-files` lint rule).

## 5. DECISION-LOG proposals (see REPORT for the full text)

- **DL-29 (proposed)** — descriptor schema versioning: `flauz.environments/v0`
  is pinned via exact `$schema` match (no in-place mutation; a v1 ships a
  migration, never a silent reinterpretation). Same discipline class as DL-21
  (the vertical-slice contract).
- **DL-30 (proposed)** — provider trust-posture defaults: ssh-local `unknown`
  (host-key pinning gate), container `trusted` (workspace-controlled
  definition), cloud-sandbox `untrusted` (read-only tier default), workspace-
  remote `unknown`. Environment escape stays `environmentPower`-class,
  default-confirm (SECURITY-MODEL 3.4).
- **DL-31 (proposed)** — cloud-sandbox entitlement posture: Flauz cloud
  environments are provider extensions ONLY (DL-8 hardened); in-tree
  `cloudSandbox*` stays reference-only; `apiKeyRef` vault references are
  validated at the schema level (literal keys rejected).
- **DL-32 (proposed)** — `.flauz/` state-envelope seam: this registry writes
  `.flauz/environments.json` as a SIBLING of flauz-workspace's
  `tasks.json`/`ledger.jsonl`, sharing the envelope discipline
  (canonical serialization, atomic writes, git-diffability) by CONVENTION —
  no cross-extension imports (zero-dep), no shared package. Codify the
  discipline doc-side so future lanes copy it verbatim.
- **DL-33 (proposed)** — resolvers grant timing: add the product.json grant
  only when live resolver code lands (no dead config; DL-19's REPLACE
  semantics make premature grants load-bearing for nothing).

## 6. Open integration questions (for the TL)

1. Does the env picker eventually want a product-side surface (status-bar env
   indicator next to `RemoteStatusIndicator`)? That would be the first genuine
   product-side ask of this lane — decision needed before Wave-5 UX.
2. `chatSessionsProvider` grant timing: only when the Flauz session-content
   connector ships (C-36), or earlier to let the canary exercise the surface?
3. Affinity: if the live switch driver lands in the environments extension,
   does it ride the Agent Bridge's pinned host (recommended — no new slot) or
   its own (needs a DL-5-class entry)?
