# The Flauz Guide (discovery-gate clean fixture)

Flauz turns your workspace into an agent-centric environment while keeping the
Code OSS editor, terminal, source control and debugging you already rely on.

## The Flauz view (activity bar)

Six views, each keyboard-focusable via the `Flauz: Focus …` commands:

| View | What it shows |
|---|---|
| **Home** | A live overview of this workspace's Flauz state. |
| **Tasks** | The task envelope, each task with its evidence trail. |
| **Agent Sessions** | Live bridge status and the active task. |
| **Environments** | The environment registry. |
| **Browser** | The effective browser policy and its enforcement layers. |
| **Models** | Registered model providers and design-only vendor plans. |

## Delegation and takeover

- **Delegation (A2A):** an agent can delegate a step to another Flauz agent;
  every delegation is journaled with attribution and evidence.
- **Takeover:** a human can take a pending step over from the agent; the
  takeover mints attributed evidence rows — the step completes as YOUR act,
  never as an unapproved agent execution.

## States and recovery

- **Empty** — a welcome panel names the surface's first action.
- **Error** — an `Unable to Load …` row; selecting it retries.
- **Recovery** — a failed refresh keeps the last-known-good rows.

## Keyboard and navigation

- Arrows, type-to-filter, Enter (open/retry), Space (expand) — standard tree
  keys everywhere.
- The active task row in **Agent Sessions** reveals that task in **Tasks**.

## Where to go next

- Ask the `flauz` agent in Chat to plan your first task.
- `Flauz: Register Environment` to add an environment.
- `Flauz: Open (or Create) Browser Policy File` to start a policy.
