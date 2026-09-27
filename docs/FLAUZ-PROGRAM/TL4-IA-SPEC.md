# TL4-001 — Flauz Product Information Architecture (IA Spec)

Date: 2026-09-27 · Branch: `tl4/a-ia-shell` · Owner: TL4 Worker A · Status: implementing

Decision-first spec for the Flauz shell: how a fresh user discovers and moves
between Flauz surfaces without knowing a single command id. TL4-HANDOFF hard
rule: "Do not let the command palette be the sole discovery path."

## 1. Problem

Verified on main @ 4c96dad: the six Flauz extensions
(flauz-agent, flauz-browser, flauz-environments, flauz-models,
flauz-workflow, flauz-workspace) contribute 0 view containers, 0 views and
0 viewsWelcome entries. Every Flauz capability is reachable only through
command-palette IDs the user cannot guess. This is the #1 discoverability
gap in the product.

## 2. Surface map — one container, six views

One activity-bar view container, owned by flauz-workspace (the extension that
already owns the `.flauz/` workspace state family):

```jsonc
// extensions/flauz-workspace/package.json
"contributes": {
  "viewsContainers": {
    "activitybar": [
      { "id": "flauz", "title": "Flauz", "icon": "$(sparkle)" }
    ]
  }
}
```

Icon decision: `sparkle`. Verified present in the codicon library re-exported
by `src/vs/base/common/codicons.ts` (`Codicon = { ...codiconsLibrary,
...codiconsDerived }`); the literal lives in
`src/vs/base/common/codiconsLibrary.ts:538` (`sparkle: register('sparkle',
0xec10)`). Rejected: `hub` — does NOT exist in the library (verified by
search); `layers` (0xebd2) — exists but reads as a generic "stacks" metaphor.
`sparkle` is VS Code's own visual language for agent/AI surfaces, which is
exactly the product's center of gravity (ARCHITECTURE-LOCK §1: "agent-centric
development and work environment").

View set (initial, all read-only v1 trees backed by each extension's REAL
service state — never fabricated):

| View id | Name | Owner | Data source |
|---|---|---|---|
| `flauz.home` | Home | flauz-workspace | workspace summary: taskService + ledger counts, presence of `.flauz/` peer artifacts (environments, browser policy, workflows) |
| `flauz.tasks` | Tasks | flauz-workspace | `TaskService.listTasks()`; evidence child rows from `EvidenceLedger.readRows()` filtered by `taskId` |
| `flauz.agentSessions` | Agent Sessions | flauz-agent | bridge status store fed at activation milestones (core seam, participant, terminal tool, model selection) + active task from `seam.listTasks()` |
| `flauz.environments` | Environments | flauz-environments | `EnvironmentRegistry` (bootstrap → `list()`, active id, connection-plan summaries) |
| `flauz.browser` | Browser | flauz-browser | `BrowserPolicyEngine` (policy source, per-layer allow/deny counts, partitions, fail-closed error state) |
| `flauz.models` | Models | flauz-models | live provider registration (`flauz-mock`/`echo-1`) + the three design-only vendor plans (`status: 'stub'`, honestly labeled) |

flauz-workflow contributes NO view in v1: its envelope is file-based
(`.flauz/workflows/<id>.json` + index) with no live runtime state worth a
surface yet; its surface arrives with TL2-005 execution state. Home links
into the workflow artifacts so the capability stays discoverable.

View order inside the container = declaration order (Home first, Tasks
second, then the cross-extension views in registration order).

## 3. Why cross-extension single-container IA is safe (platform proof)

`src/vs/workbench/api/browser/viewsExtensionPoint.ts`:

- Lines 378–396 (`registerCustomViewContainers`): when the container-owning
  extension registers its `flauz` container, the handler moves "those views
  that belongs to this container" — every view contributed by ANY extension
  whose `originalContainerId === 'flauz'` — into the real container via
  `viewsRegistry.moveViews(viewsToMove, viewContainer)`. Order of extension
  registration does not matter: late registration of the container owner
  pulls the other extensions' views in.
- Lines ~471–473 (`addViews`): if the owning extension were somehow absent,
  views degrade gracefully — "View container '{0}' does not exist and all
  views registered to it will be added to 'Explorer'" (`viewContainer ||
  this.getDefaultViewContainer()`). Nothing breaks; discoverability drops to
  Explorer instead of disappearing.
- Line ~484: duplicate view ids across extensions are a hard contribution
  error ("Cannot register multiple views with same id") — the platform
  already enforces the exactly-once rule the IA gate mirrors.

Consequence: only ONE extension may define the container (duplicate
container definitions across extensions would fight over
`workbench.view.extension.flauz`); every other extension only contributes
views into container id `flauz`.

## 4. Navigation model

- Every view gets a focus command, category "Flauz", title-case titles:
  `flauz.focusView.home|tasks|agentSessions|environments|browser|models`
  → each executes the built-in `<view-id>.focus` command.
- Container-level command `flauz.focusView` ("Focus Flauz View") → executes
  `workbench.view.extension.flauz.focus`.
- Cross-view affordances (v1, honest scope):
  - task → evidence: evidence child rows in `flauz.tasks` carry the tree-item
    command `flauz.workspace.openEvidence` (`{evidenceId}`) — file uris open
    in the editor, others via `env.openExternal` (existing command).
  - session → task: the active-task row in `flauz.agentSessions` executes
    `flauz.focusView.tasks`. True reveal-with-selection needs a
    `createTreeView` handle (`TreeView.reveal`) — recorded as follow-up.
  - home → everywhere: each Home row focuses (or opens) its surface.
- Command palette is a SECOND path, not the only one: all six views are
  permanently visible in the activity bar, keyboard-focusable via the
  focus commands, and the activity bar itself is stock-keyboard-navigable.

## 5. State matrix (per view)

Rules: viewsWelcome for empty; error ROWS with a Retry tree-item command for
failures (never a silent fake-success row); loading is the stock tree
progress indicator that shows while `getChildren`'s promise is pending
(async providers only); never fabricate data.

| View | Empty | Loading | Error | Recovery |
|---|---|---|---|---|
| `flauz.home` | no workspace folder → welcome (open folder + first actions) | stock tree progress while reading `.flauz/` | unreadable artifact row ("…unreadable") + `flauz.workspace.refreshHome` retry | Retry re-reads; opening a folder + refresh (or reload) re-evaluates |
| `flauz.tasks` | no workspace, or zero tasks → welcome (create via the agent) | stock progress on `listTasks`/`readRows` | invalid envelope/ledger → error row + `flauz.workspace.refreshTasks` retry | Retry re-reads; envelope errors point at the file |
| `flauz.agentSessions` | no workspace → welcome (open folder to activate the bridge) | stock progress on `seam.listTasks` | core-service start failure → degraded bridge row + retry `flauz.agent.refreshSessions`; seam request failure → error row + retry | Retry re-probes the seam; the view reflects real bridge state |
| `flauz.environments` | no workspace or zero registered → welcome | stock progress on `bootstrap`/`list` | invalid `environments.json` → error row + `flauz.env.refreshView` retry | Retry re-bootstraps; commands stay the mutation path |
| `flauz.browser` | no workspace → welcome (policy lives in `.flauz/browser-policy.json`) | stock progress on engine load | invalid policy file → error row naming the policy error code + retry `flauz.browser.refreshView` (fail-closed default stays in effect, shown as a row) | Retry reloads the engine; the file watcher hot-swaps and refreshes the view |
| `flauz.models` | dormant welcome (safety net — provider rows exist once activated) | none (static registry data) | none (no runtime fetch) | n/a (stub plans are labeled, never shown as registered) |

viewsWelcome content: every view ships a welcome entry whose first line says
what the surface is and whose links point at the first action (see
package.json `viewsWelcome`); links use real, arg-less commands
(`workbench.action.files.openFolder`, `flauz.focusView.*`,
`flauz.browser.setPolicy`).

## 6. Keyboard, focus and accessibility

- Each view is reachable via its `flauz.focusView.*` command (command
  palette / keybindings) and then stock tree keyboard navigation (arrows,
  Enter, type-to-filter) — no custom focus code.
- Initial focus behavior: activating via `onView:<view-id>` does not steal
  focus; the stock `<view>.focus` command both reveals and focuses.
- Every tree item gets: a plain-string `label`, a `tooltip` (what the row
  means + what clicking does), and `accessibilityInformation` where the
  label alone is ambiguous (status rows announce "connected"/"degraded"
  state explicitly). Icons use codicon ThemeIcons (`$(…)`) with sensible
  alt text.
- `onView:<view-id>` activation events are declared explicitly in every
  manifest (self-documenting even where auto-generation would cover it).

## 7. Discoverability rules (machine-checked)

- Exactly one activitybar container `flauz` across all flauz-* manifests;
  views may only be contributed into container `flauz` (single-container law).
- The six expected view ids exist exactly once, each with a non-empty name,
  each with ≥1 `viewsWelcome` entry with non-empty `contents`.
- Every `flauz.focusView*` command has category exactly "Flauz" + a
  non-empty title; no duplicate command ids across flauz-* manifests.
- No flauz-* extension adds `onStartupFinished` beyond flauz-agent and
  flauz-workspace (activation budget stays PERF §2.2: ≤2). Views activate
  via `onView:`.
- Every `registerTreeDataProvider('<id>', …)` in flauz-* `src/**` matches a
  contributed view, and every contributed view has a provider call.

Enforced by `build/flauz/scripts/ia-gate.mjs` (zero-dep, node ≥ 20) — see
its header for checks and exit codes. Fixture-proven in
`test/fixtures/ia-gate/` and wired into `verify-fixtures.sh` +
`flauz-hygiene.yml`.

## 8. String policy

The six extensions have no NLS infrastructure today (verified: no
`vscode-nls`, no `package.nls.json`, plain double-quoted strings throughout
— e.g. commands.ts titles in package.json). Decision: keep plain
double-quoted user-facing strings, consistently, in both manifests and
providers, and record that when NLS lands it lands for all six extensions at
once (follow-up). Title-style capitalization per repo convention
(.github/copilot-instructions.md).

## 9. Out of scope (v1)

- Webviews and custom editors (none added).
- Any new chat UI — the existing `flauz.agent` chat participant stays the
  agent interaction surface; Agent Sessions only reflects status.
- Any `src/vs` change (fork-critical guard must stay empty).
- Live push-updates for views whose services lack change events
  (environments/workflows): refresh commands + watcher-driven refresh where a
  watcher exists (browser). Push updates recorded as follow-up.
- `flauz.workflow` view (file-based envelope, no runtime state yet — §2).

## 10. Follow-ups (honest)

1. Session → task reveal via `createTreeView` + `TreeView.reveal`.
2. Live refresh for environments/workflow views (needs service change
   events).
3. NLS adoption across the six extensions.
4. `flauz.tasks` view actions (create/cancel from tree rows) once command
   arg-picking UX is agreed (quick-input wrapper commands).
5. Webviews only if a tree cannot express a surface (none planned).
