# The Flauz Guide

Flauz turns your workspace into an agent-centric environment while keeping the
Code OSS editor, terminal, source control and debugging you already rely on.
Everything Flauz tracks lives in reviewable files inside your workspace.

## The Flauz view (activity bar)

Open the Flauz icon in the activity bar. Six views, each keyboard-focusable
via `Flauz: Focus …` commands:

| View | What it shows |
|---|---|
| **Home** | A live overview of this workspace's Flauz state. |
| **Tasks** | The task envelope `.flauz/tasks.json`, each task with its evidence trail. |
| **Agent Sessions** | Live bridge status: core service, chat participant, terminal tool, models and the active task. |
| **Environments** | The environment registry `.flauz/environments.json`. |
| **Browser** | The effective browser policy and its enforcement layers. |
| **Models** | Registered model providers and design-only vendor plans. |

## Files Flauz creates

- `.flauz/tasks.json` — the task envelope (states, events, timing).
- `.flauz/evidence/ledger.jsonl` — the append-only, hash-chained evidence ledger.
- `.flauz/environments.json` — the environment registry.
- `.flauz/browser-policy.json` — the browser policy (fail-closed: absent file means deny-all).
- `.flauz/workflows/` — saved workflow envelopes.

## States and recovery

- **Empty** — a welcome panel names the surface's first action.
- **Loading** — the tree's own progress affordance while files are read.
- **Error** — an `Unable to Load …` row. Selecting it retries. The context
  menu on any error row opens this guide.
- **Recovery** — when a refresh fails, the view keeps the last-known-good
  rows below the error row instead of going blank. Retry re-reads from disk.
  The Browser view is the deliberate exception: an invalid policy file always
  falls back to the built-in deny-all policy (fail-closed), never to a stale
  policy file.

## Keyboard and navigation

- Arrows, type-to-filter, Enter (open/retry), Space (expand) — standard tree
  keys everywhere.
- `Flauz: Focus Flauz View` (and per-view focus commands) jump between views.
- The active task row in **Agent Sessions** reveals that task in **Tasks**
  with its evidence expanded.

## Where to go next

- Ask the `flauz` agent in Chat to plan your first task.
- `Flauz: Open (or Create) Browser Policy File` to start a policy.
- `Flauz: Register Environment` to add an environment.
