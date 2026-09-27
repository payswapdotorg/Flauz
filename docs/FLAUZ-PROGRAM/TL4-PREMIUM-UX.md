# TL4-002 — Flauz Premium UX Spec

Date: 2026-09-28 · Branch: `tl4/a2-premium-ux` · Owner: TL4 Worker A · Status: implementing

Decision-first spec for making the TL4-001 shell (container `flauz`, six views)
feel like ONE product: consistent hierarchy, density and typography, complete
state coverage, keyboard/focus discipline, accessible labels, and fast-feeling
interactions. Premium = MEASURED interaction, visual and recovery quality
(TL4-HANDOFF "Done means" / ARCHITECTURE-LOCK §7) — every rule below maps to a
state, flow or affordance a user experiences, and the enforceable ones are
machine-checked by `build/flauz/scripts/premium-ux-gate.mjs` (section 10).

Design vocabulary (copilot-instructions.md "Designing UI"): the values are
Calm / Focused / Consistent / Delightful. This spec is mostly the **Consistent**
move — one grammar for rows, states, dates and verbs — plus **Focused**
(reveal navigation, exactly-one-primary-action) and **Calm** recovery (the
never-blank recovery law). No pixels are invented: every visual knob stays a
stock theming token, stock codicon, or stock tree affordance.

## 1. Problem (verified on the TL4-001 shell)

The IA shell gave every surface structure, but each provider grew its own
dialect:

- Error affordances drifted: contextValues `flauzError` vs
  `flauzBrowserSourceInvalid`; retry row command titles `Retry` vs
  `Refresh Browser View` vs `Refresh Flauz Home`; no docs path off any failure.
- Failure blanked whole views: Tasks and Environments dropped ALL rows on a
  load error — the last-known-good snapshot was lost (recovery gap).
- No timestamp discipline: tasks carry `timing.updatedAt`, evidence rows carry
  `ts`, environments carry `updatedAt` — none rendered; no shared formatter.
- Focus stopped at view granularity: no row-level reveal (session → task was a
  whole-view focus; task → evidence had no navigation affordance).
- A11y coverage was partial: Home and Browser rows shipped tooltips but no
  `accessibilityInformation`.
- Six `truncate()` copies and per-file row-copy dialects — coherence debt.

## 2. Typography and density system

### 2.1 Row grammar (the one rule that buys consistency)

A Flauz tree row is exactly three slots, always in this order:

```text
[label]  [description: identity · state · qualifier]  [codicon]
[tooltip: full detail, multi-line, ends with the affordance sentence]
```

- **Label** = the *thing* (noun phrase, the entity the row represents):
  `Tasks`, `Core Service`, `Policy Source`, a task title, an environment label.
  Never a status, never a verb. Preferred ≤ 32 chars; truncate titles with `…`
  at 40.
- **Description** = the *state of the thing*, middle-dot (`·`) separated
  segments in the order **identity → state → qualifier**, sentence-case,
  preferred ≤ 60 chars (hard cap 80): `T-001 · plan · updated 3h ago`,
  `env-ssh · ssh-local · active`, `allow 2 · deny 0 · fileRoots 1`.
- **Tooltip** = full detail (all segments spelled out, absolute timestamps,
  hashes/uris) + the affordance sentence naming what selecting the row does.
- **Codicon** = category signal (section 2.3). Icon + description must never
  carry the same information twice (density).

### 2.2 When rows are codicon-labeled vs descriptive

Tree rows are list rows, not buttons: the label is always descriptive text;
codicons carry *category* (status/error/warning/section), never identity. Do
not pack status words into labels ("Failed Core Service") — status lives in
the description slot where it aligns in a column and stays scannable.

### 2.3 Codicon assignments (fixed vocabulary)

| Row class | Codicon |
|---|---|
| Load-failure error row | `error` |
| Degraded section row (partial failure, view still useful) | `warning` |
| Tasks surface / task count | `list-tree` |
| Active task | `circle-filled`; terminal `done`/`failed`/`cancelled` → `check`/`error`/`close` |
| Evidence ledger | `book`; evidence child row | `file` |
| Core service connected | `plug`; chat participant | `robot`; terminal tool | `terminal` |
| Models registered | `sparkle`; inactive/not-yet | `circle` |
| Environments | `server` (active env `circle-filled`, disabled `circle`) |
| Browser policy source | `shield`; driver layer `window`; webRequest `shield`; willNavigate `arrow-right`; partitions `layers` |
| Workflows | `rocket` |

Only ThemeIcon codicons (`$(…)` in manifests, `ThemeIcon` in code) — no custom
SVGs, no icon fonts (machine-checked, PU5).

### 2.4 Dates and numbers (the shared formatter)

One module — `src/format.ts` (~40 lines) — is the ONLY timestamp renderer:

- Descriptions carry **relative ages**: `just now`, `5m ago`, `3h ago`,
  `2d ago`; older than 7 days → calendar date `YYYY-MM-DD`.
- Tooltips carry the **absolute UTC stamp** `YYYY-MM-DD HH:MM` plus the raw
  epoch (correlate with ledger rows and service logs).
- Raw epoch numbers are never user-visible.
- Counts pluralize: `1 row`, `2 rows`; `2 open · 2 total`; `?` when a peer
  artifact is unreadable rather than a fabricated number.

**Sharing decision (recorded):** built-in flauz extensions cannot import each
other's sources without coupling their builds (per-extension tsconfig/esbuild
bundles; ARCHITECTURE-LOCK §5 prefers contract convergence over implementation
sharing). The module is therefore duplicated **verbatim** into every extension
that touches timestamps (flauz-workspace, flauz-agent, flauz-environments).
Gate PU6 makes the duplication honest: it normalizes every
`extensions/flauz-*/src/format.ts` and fails if the copies are not byte-equal,
and it bans ad-hoc date formatting (`toLocaleString`, `toISOString`,
`new Date(` outside the module). Extensions with no timestamps (models,
workflow) ship no copy — 0 is a valid count.

**v2 (recorded at the TL4-002 integration wave):** flauz-browser joined the
copy family. Its runtime serializes protocol records (session descriptors:
`createdAt` / `closedAt` / typed error `at`) as machine-grade ISO-8601 stamps.
Those are data, not rendering — but the PU6 bright line is total: no flauz
code builds a timestamp outside the module, so the module gained the
serialization sibling `toIsoStamp(epochMs)` (`new Date(epochMs).toISOString()`)
and flauz-browser's `isoAt(clock)` became a thin wrapper over it. One source
of truth for rendering AND serialization; TL3's descriptor contract
(`flauz.browser-session/v0`) is byte-identical before and after.

## 3. Hierarchy rules (one primary affordance per surface)

1. **Empty state:** the viewsWelcome's FIRST command link is the single
   primary next action (Open Folder / Open Chat / …). Additional links are
   secondary escapes, capped at 3 links total. Every welcome carries at least
   one command link plus one guidance sentence (PU1).
2. **Loaded state:** the row's tree-item `command` is the primary action —
   Enter/click triggers it. Primary actions are navigational or read-opening
   (focus a view, open an artifact, open the policy file), never destructive.
3. **Secondary actions:** view-header icons (`view/title` navigation group —
   the Refresh actions) and row context menus (`view/item/context`).
4. **Destructive actions** (Unregister/Deactivate Environment, cancel task)
   are NEVER the first affordance: not a row command, not a welcome link —
   explicit commands/quick-input flows only, behind deliberate invocation.
5. **Error rows:** Retry is always the primary action of a failure row; the
   docs link (section 4) is the secondary, context-menu path.

## 4. State content templates (the recovery law)

Machine-checked token contract (exact strings, checked by PU2):

- **Error row** (a load failed):
  label `Unable to Load <Surface>` · icon `error` · contextValue `flauzError`
  · tree-item command title `Retry` (command id = the view's refresh/retry
  command) · description = truncated message · tooltip = full message, then
  `Select this row to retry.` plus, when last-known-good rows follow,
  a line stating that the rows below are the last-known-good snapshot.
- **Degraded section row** (one Home section failed, view stays useful):
  icon `warning` · contextValue `flauzError` · description `unreadable` ·
  command title `Retry` · tooltip carries the underlying message.
- **Loading:** the stock tree progress affordance only — the pending
  `getChildren` promise. Never spinners-in-text, never placeholder rows that
  look like data, never fabricated "Loading…" rows.
- **Empty:** viewsWelcome per rule 3.1 — never a fake-success row.
- **Recovery (last-known-good):** when a refresh fails but a previous render
  succeeded, the view keeps the previous rows and PREPENDS the error row; the
  error row says the rows below are the last-known-good snapshot. Applied to
  Tasks and Environments (the two views that previously blanked). Home already
  degrades per section; Agent Sessions appends the error row after live status
  rows; Models is exempt (section 9).
- **Fail-closed exception (Browser):** an invalid policy file NEVER falls back
  to the last-known-good policy — the engine renders the builtin deny-all
  state with the invalid-source row. The security law (fail closed) outranks
  the recovery law; recorded here so the pattern difference is a decision.
- **Docs path off every failure:** all error/degraded rows carry
  contextValue `flauzError`, so ONE stock menu rule
  (`view/item/context` when `viewItem == flauzError`) offers
  `Flauz: Open Flauz Guide` → `flauz.workspace.openGuide`, which opens the
  guide document shipped with flauz-workspace (`flauz-guide.md` at the
  extension root — the docs surface v1: a tree-safe, webview-free explanation
  of every Flauz surface, its files, states and recovery moves). Retry stays
  the primary action; the guide is the secondary, context-menu path.

## 5. Keyboard and focus map

- **Tab order / tree keyboard:** stock workbench and stock tree semantics —
  arrows, type-to-filter, Enter performs the row's primary action, Space
  toggles expand, the context-menu key opens the row menu. No custom focus
  code, no focus traps; nothing steals keyboard focus from the composer.
- **Escape:** stock tree behavior (collapse the focused branch / leave the
  tree). Flauz adds no custom Escape handling.
- **Focus commands:** every view has `flauz.focusView.<view>` (category
  "Flauz", title-case) executing the stock `<view-id>.focus` (reveal +
  focus); the container has `flauz.focusView` (PU3, mirrors IA4).
- **Reveal navigation (row-level):** `flauz.workspace.revealTask`
  ("Reveal Flauz Task", category "Flauz", arg `{ taskId }`) reveals the task
  row in `flauz.tasks` with `{ select: true, focus: true, expand: true }` —
  the task is selected, keyboard focus moves onto it, and its evidence
  children are expanded (task → evidence). The Agent Sessions active-task row
  carries this command (session → task), replacing the whole-view focus hop.
  Mechanically this requires the TreeView handle
  (`window.createTreeView`) plus `TreeDataProvider.getParent` (evidence →
  its task, task → root) — the API contract verified in
  `src/vs/workbench/api/common/extHostTreeViews.ts` (reveal rejects providers
  without `getParent`; element resolution keys on the stable `TreeItem.id`
  `flauz.tasks/<taskId>`).
- **Focus restoration:** navigation moves focus forward to the revealed row
  and never pulls it back (no ping-pong); the origin view's tree state
  persists (stock per-view trees) and is one focus command away. After a
  view switch, the revealed row is the keyboard context — arrows continue
  from there.
- **F1 discoverability:** all Flauz commands are title-case, category
  "Flauz", so the palette groups the family; the activity bar + welcome
  links + row affordances remain the primary discovery paths (TL4-001 §4).

## 6. Accessibility

- **Labels:** every tree item sets `accessibilityInformation.label` with the
  grammar `<row label>: <description>` for status/summary rows and
  `Task <id>, <title>, status <status>` / `Evidence <id>, kind <kind>, for
  task <taskId>` / `Environment <id>, <label>, kind <kind>[, active]` for
  entity rows — the a11y label restates the visible grammar in one readable
  string (screen-reader users get the same columnar facts).
- **Tooltips on all rows** (sighted-user parity; verified per provider file
  by PU2).
- **Announcement strategy:** stock tree announcements only — when rows
  re-render, the tree announces each row's a11y label; state transitions
  (error row appearing, status flipping to connected) are announced by the
  changed rows themselves. No custom alert roles, no live regions, no
  sound cues (TreeViews offer none; adding webviews for announcements would
  violate the no-webview boundary).
- **Contrast / target sizes:** stock theming tokens only — rows use the
  theme's tree row height and hover/selection colors. No custom CSS exists
  in flauz-* sources and none may be added (views are tree views; custom CSS
  would require webviews, which are out of scope — PU5).
- **Destructive/ambiguous icons:** `error`/`warning` codicons get explicit
  a11y labels ("Error loading tasks…", "unreadable") so color is never the
  only signal.

## 7. Motion policy

Stock reveal/collapse is the only motion Flauz surfaces use: the tree's
expand/collapse animation, view-header reveal, and stock command transitions.
The TreeView API exposes no custom motion hooks — that is documented here as
a decision, not a gap: consistency with the workbench's `workbench.
reduceMotion` handling comes for free precisely because every motion is the
workbench's own. No animated glyphs, no per-row transitions, no welcome
animations. (If a future surface needs motion, it must arrive with a
webview-scope decision and its own spec section.)

## 8. Perceived performance

- **Eager welcome:** viewsWelcome renders before activation completes (static
  manifest content) — first paint of every surface is instant.
- **Progressive population:** the Tasks tree renders task rows from the
  envelope first; evidence children load lazily on expand (children fetch
  rides the stock progress affordance). Home reads its five sections in
  PARALLEL (`Promise.all`) so one slow artifact cannot serialize the view.
- **Last-known-good + refresh:** section 4 recovery — a failed refresh never
  blanks a populated view; every view header carries its Refresh icon
  (`view/title` navigation group) for cheap re-reading.
- **Never blocks the composer:** view code never runs on the chat
  participant's turn path — the agent view updates from activation
  milestones and refresh commands; trees populate when the workbench calls
  `getChildren` (visibility-driven), and all file I/O is async off the
  critical path. No view API call may await inside `registerCommand` handlers
  on the participant path.
- **Cheap by construction:** rows are plain data objects; providers cache the
  last render (which IS the last-known-good store) instead of re-deriving
  per paint.

## 9. Per-surface state matrix (v1 truth table)

| View | Empty | Loading | Error | Recovery |
|---|---|---|---|---|
| `flauz.home` | welcome (Open Folder primary) | stock progress; sections read in parallel | per-section degraded rows (`warning`, `flauzError`, Retry) + whole-load error row | Retry re-reads; sections that still parse keep rendering |
| `flauz.tasks` | welcome (Open Chat primary) | stock progress on envelope/ledger | error row (`error`, `flauzError`, Retry) + last-known-good rows below | Retry re-reads; last-known-good kept until a fresh read succeeds |
| `flauz.agentSessions` | welcome (Open Folder primary) | stock progress on the seam probe | status rows stay; error row appended (Retry); core failure renders a degraded core row honestly | Retry re-probes; bridge status always reflects observed state |
| `flauz.environments` | welcome (Refresh primary — registration is command-driven) | stock progress on bootstrap | error row + last-known-good rows below | Retry re-bootstraps from scratch |
| `flauz.browser` | welcome (Open Folder primary) | stock progress on engine load | invalid-file row names the policy error code (fail-closed, section 4) | Retry reloads the engine; watcher hot-swaps on file change |
| `flauz.models` | dormant welcome (safety net) | n/a — static registry data | n/a — no runtime fetch → provider file carries the `premium-ux-gate: no-failure-source` marker (PU2 exemption) | n/a (stubs are always honestly labeled) |

flauz-workflow ships no view (TL4-001 §2); its premium surface is the
command set (title-case, category "Flauz" — PU4-checked).

## 10. Machine-checked rules (premium-ux-gate.mjs)

`build/flauz/scripts/premium-ux-gate.mjs --root <repo> [--require]` (zero-dep
node ≥ 20; exit 0 clean/SKIP · 1 violation · 2 usage; skip-vs-fail policy per
build/flauz/README.md §2 — no flauz manifests + `--require` = fail):

- **PU1 welcome quality:** every view in container `flauz` has a
  viewsWelcome with ≥ 1 command link (`](command:…)`) and ≥ 1 guidance
  sentence (a non-link line ≥ 30 chars ending `.`, `!`, `?` or `:`).
- **PU2 state-template tokens:** every tree-provider source file (flauz-*
  `src/**` implementing `TreeDataProvider` or registering a provider)
  references the section 4 token contract — `flauzError`, `title: 'Retry'`,
  a `flauz.*refresh*` retry command id — and the section 6 tokens
  (`tooltip`, `accessibilityInformation`) — OR carries the marker comment
  `premium-ux-gate: no-failure-source` (the Models exemption, section 9).
- **PU3 focus family:** every container-`flauz` view has the matching
  `flauz.focusView.<view>` command with category exactly "Flauz" and a
  non-empty title.
- **PU4 title/sentence case:** every flauz-* `contributes.commands[].title`
  is title-case (each word's first letter capitalized; allowlist of small
  words: a an and as at but by for from in nor of on or per the to up via vs);
  every contributed `description`/`userDescription`/`modelDescription`
  string starts sentence-case.
- **PU5 no custom presentation layer:** no flauz-* manifest contributes
  `webviews`/`customEditors`/`webviewView`; no flauz-* source calls
  `createWebviewPanel`/`createWebviewView`; no `.css`/`.ttf`/`.otf`/
  `.woff`/`.woff2` file exists under `extensions/flauz-*/`.
- **PU6 one date implementation:** every `extensions/flauz-*/src/format.ts`
  defines `formatTimestamp`; all copies normalize identically (≤ 1 distinct
  implementation; 0 files is valid); no flauz-* source outside `format.ts`
  performs ad-hoc date formatting (`toLocaleString`/`toISOString`/
  `toDateString`/`toLocaleDateString`/`toLocaleTimeString`/`new Date(`).

## 11. Cross-surface coherence checklist

Same state language, same verbs, same dates, same numbers — on every surface:

- [x] Error/degraded rows: one grammar (`Unable to Load <X>` / `unreadable`),
  one contextValue (`flauzError`), one Retry title, one docs menu rule.
- [x] Action verb vocabulary: **Focus** (views), **Refresh** (view headers),
  **Retry** (failure rows), **Reveal** (row-level navigation), **Open**
  (artifacts/files). No synonyms drift (no "Go to", no "Reload").
- [x] Dates: `formatAge` in descriptions, `formatTimestamp` in tooltips,
  everywhere timestamps exist.
- [x] Numbers: pluralized counts, `·` separators, `?` for unreadable.
- [x] A11y grammar: `<label>: <description>` / entity-row spellings (§6).
- [x] Codicons: section 2.3 vocabulary only.
- [x] Commands: title-case, category "Flauz" (PU3/PU4).

## 12. Out of scope (v1)

- Webviews, custom editors, custom CSS, icon fonts (PU5 keeps them absent).
- NLS across the six extensions (TL4-001 §8 decision stands — plain strings
  until NLS lands for all six at once).
- Live push updates for environments/workflows (TL4-001 follow-up #2).
- Motion beyond stock (section 7 — recorded as a decision).

## 13. Follow-ups (honest)

1. Reveal for environments (env → connection plan) once plans are surfaced as
   rows (needs `flauz.env.showPlan` row affordance).
2. `TreeView.message` as a passive stale-banner (considered; deferred — the
   error row already carries recovery, message risks double-announcing).
3. Evidence → task reverse reveal (needs provider-wide element cache).
4. Guide deep links per surface (one guide v1; split when it grows).
