# Canary C-ENV — Environment registry visible in the environment picker surface

- **Matrix row (wave1/c + Wave-4 Lane J)**: new row for the environment story —
  C-30/C-31/C-32/C-33/C-34 compose into "multi-environment" only if a REGISTRY
  makes environments first-class (ARCHITECTURE-MAPPING row 5: env providers
  pluggable via resolver API + Flauz env registry/catalog). This canary pins
  the registry contract: descriptor round-trip, provider plan emission, and
  the env-switch continuity verification story.
- **Lane**: `extensions/flauz-environments` (Wave 4, Lane J —
  flauz/wave4/environments; base flauz/main @ a4c245147e8f).
- **Tree evidence (all paths verified @ a4c245147e8f)**:
  - Resolver API (the provider plug point):
    `src/vscode-dts/vscode.proposed.resolvers.d.ts:456`
    (`registerRemoteAuthorityResolver(authorityPrefix, resolver)`), catalog
    entry `src/vs/platform/extensions/common/extensionsApiProposals.ts:408-410`.
  - Blueprint resolver (own OSS SSH posture, DL-7):
    `extensions/vscode-test-resolver/src/extension.ts:376-393` (registration),
    `:166-194` (agent-host bridge handshake +
    `VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN`), `:254` (managed authority),
    `:396-403` (authority open).
  - Env picker surface (what a Flauz env picker composes with): remote
    status indicator `src/vs/workbench/contrib/remote/browser/remoteIndicator.ts:73`
    (class), `:132-133` (remoteAuthority), `:194` (remote menu command); Remote
    Explorer `src/vs/workbench/contrib/remote/browser/remoteExplorer.ts:41`
    (`VIEWLET_ID` `workbench.view.remote`); the tabbed MODEL picker
    `src/vs/workbench/contrib/chat/browser/widget/input/modelPicker/`
    (`modelPickerActionItem.ts:66` etc.) is the picker UI pattern; cloud
    sandbox session picker surface
    `src/vs/workbench/contrib/chat/browser/remoteAgentHost/cloudSandboxSessionListController.ts:28`.
  - Sessions re-hydration infra (continuity): `IChatSessionsService`
    `src/vs/workbench/contrib/chat/common/chatSessionsService.ts:802-804`.
- **Owner CI**: `.github/workflows/flauz-environments.yml` (job
  `cenv-environment-registry`) — zero-secrets, gated on Flauz paths +
  `workflow_dispatch`; runs the fixture canary first (fail-fast, no install),
  then the boot-level assertions.

## Setup

1. Zero-dep phase (always): `node --test extensions/flauz-environments/test/*.test.ts`
   + `node build/flauz/scripts/env-registry-canary.mjs` (Node >= 23.6 for
   type-stripping; the runner itself is node >= 20 stdlib only).
2. Boot phase (template: flauz-canaries.yml): upstream pipeline steps
   (`node build/npm/preinstall.ts`, `npm install`, setup-electron composite,
   `npm run compile`), `node build/flauz/scripts/bundle-extensions.mjs`,
   Xvfb (`build/azure-pipelines/linux/xvfb.init`, DISPLAY :10).

## Steps

1. Run the C-ENV fixture canary (`env-registry-canary.mjs`) — assertions A1-A8
   below; zero install, zero secrets.
2. Boot flauz with the registry extension bundled: same recipe as C-20
   §Steps-1 (fresh user-data-dir + extensions-dir, verbose log to artifacts).
3. **[boot-level]** Assert the bundled extension surface: the compiled
   `dist/` bundle lists the `flauz.env.*` commands and the extension
   activates on command only (activation-lint green).
4. **[driver — WAITING-ON-RUNTIME]** Open the environment picker surface
   (command palette `flauz.env.list` / the future tree view) and assert the
   registry entries render with kind + trust posture.
5. **[driver — WAITING-ON-RUNTIME]** Execute `flauz.env.switch` to a fixture
   environment and assert the emitted switch plan + the re-open flow
   (this needs the live resolver wiring — Wave-4-next; INTEGRATION-GAP §3).

## Expected (assertions)

| # | Assertion | Mechanism | Status |
|---|---|---|---|
| A1 | fixture matrix loads: 5 environments, 4 kinds + bridged variant, `$schema` pinned | `env-registry-canary.mjs` A1 | automated (fixture) |
| A2 | descriptor round-trip: canonical serialization byte-stable, re-parse identical | A2 | automated (fixture) |
| A3 | every bad fixture rejected with `flauz.environments/v0:`-prefixed errors (45-file matrix; every validation rule violated at least once) | A3 | automated (fixture) |
| A4 | connection-plan emission per provider kind: 5 golden pins match (`test/fixtures/environments/plans/`) | A4 | automated (fixture) |
| A5 | switch-plan emission: re-open mechanism (N-8), PERF 5.5 budgets (1500/500), 4 phases, authority | A5 | automated (fixture) |
| A6 | registry lifecycle in a temp workspace: register -> activate -> persist -> RELOAD keeps activeId (the re-open continuity substrate) | A6 | automated (fixture) |
| A7 | continuity classification: 5 persists / 6 rehydrates / 5 lost (closed canon; unknown surfaces rejected) | A7 | automated (fixture) |
| A8 | overhead accounting: budget verdicts at 1500/200/300 boundaries + `code/flauz/*` mark pairs | A8 | automated (fixture) |
| B1 | clean boot with the extension bundled (no crash/unresponsive, no `DOES NOT EXIST` proposal drop) | boot-log greps (C-20 A1/A3 pattern) | automated (boot) |
| B2 | the bundled extension carries the 7 `flauz.env.*` command contributions | grep of the bundled manifest/compile output | automated (boot) |
| B3 | activation stays command-driven (no `onStartupFinished` on flauz-environments; activation-lint R3 green) | `activation-lint.mjs` in the zero-dep phase | automated |
| P1 | env registry visible in the environment picker surface (entries render with kind + trust) | picker driver (step 4) | **WAITING-ON-RUNTIME** (Wave-4-next resolver wiring) |
| P2 | live switch: plan executed, window re-opened on the authority, sessions re-hydrated | switch driver (step 5) | **WAITING-ON-RUNTIME** |

## Drift trip-wires

- A4 firing means the plan contract changed (provider steps, budgets, marks) —
  the golden pins exist to force a deliberate contract update, not silent drift.
- A3 count dropping below 40 means the bad-fixture matrix lost coverage
  (rule regression or fixture loss) — the matrix is the validation contract.
- B1 `DOES NOT EXIST` firing means a proposal drift (DL-4 rota corroboration,
  same class as C-20 A3).
- If the boot phase hits the api.github.com 403 flake class (rate limit on the
  ripgrep-prebuilt fetch — observed Wave-3, round 7): the zero-secrets policy
  for THIS workflow is deliberate (work order); re-run first, then escalate to
  the TL for the DL-28 auto-token exception if it persists. The fixture phase
  (the actual registry contract) never depends on the network.
- PERF 5.5 budget changes must come with a PERF-plan amendment; A5/A8 pin the
  1500/500 numbers so any change fails loudly here first.

## Cross-refs

- `extensions/flauz-environments/INTEGRATION-GAP.md` — the extension-land vs
  product-side boundary (proposal grants via product.flauz.json per DL-19).
- `flauz-delivery/j-environments/REPORT.md` — verification receipts + the
  live-connection GAPS-AND-SKIPS record (runners/real-world only).
- Matrix rows C-30..C-34 (wave1/c) + N-8 (EV-11) — the environment rows this
  canary turns into a verified story.
