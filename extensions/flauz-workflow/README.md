# Flauz Workflow (Wave 4, Lane K)

Workflow envelope v1 for the Flauz `.flauz/` state family: save a run as a
git-diffable workflow fragment and re-run it from one command.

## What lives here

- `src/envelope.ts` - the workflow envelope v1 (`flauz.workflows/v1`):
  - A saved RUN = the task envelope (`.flauz/tasks.json`, `flauz.tasks/v0`,
    owned by `extensions/flauz-workspace`) PLUS a workflow fragment at
    `.flauz/workflows/<id>.json`: the run's plan, tool sequence, approval
    decisions, evidence refs, model/provider + params, and the re-run recipe.
  - `flauz.workflow.save` - save a run (after OR during); the distiller walks
    the task timeline (`created`/`submit-plan`/`approve`/`request-changes`/
    `evidence`/`fail` events) into the fragment.
  - `flauz.workflow.run` - one command -> re-run: hydrate plan -> replay
    approvals-or-ask -> execute tools (ToolExecutorPort) -> NEW ledger rows
    linked to the ORIGINAL run's rows via `derivedFrom`; every state change
    goes through the flauz.tasks/v0 nine-transition state machine.
  - `flauz.workflow.list` - list saved fragments (registry:
    `.flauz/workflows/index.json`).
- `src/triggers.ts` - AHP automation-trigger interop v0: maps the workflow
  envelope onto the tree's automation surfaces (`ListAutomationTriggerDefinitions`,
  `RunAutomation`, `FetchAutomationRuns`) with the emission-point contract;
  no live AHP dependency.
- `src/messaging.ts` - orchestrator-level agent-to-agent messaging v0 (matrix
  row C-26: PROTOTYPABLE at the orchestration layer): typed messages
  (task-delegation / result-report / steering-relay / claim-notice /
  lease-notice), a bounded mailbox per agent id, and the
  delivered-to-the-participant bridge. Transport: in-process mediator (canonical
  v0) or the `flauz.a2a.*` commands on the Flauz Core service
  (`extensions/flauz-agent/core/service.mjs`) over the DL-21 stdio JSONL seam.
- `src/commands.ts` / `src/extension.ts` - command surface + activation
  (command activation only; see `build/flauz/scripts/activation-lint.mjs`).

## Conventions

- Zero runtime dependencies; node >= 20 stdlib only (node-free core: all IO
  through the flauz-workspace `FileSystemPort`/`Clock`).
- Canonical serialization (sorted keys, 2-space indent, one trailing newline) -
  the DL-9 git-diffability discipline.
- Tests: `node --test test/*.test.ts` (node type-stripping; no build step).
- Typecheck: `npm run typecheck` (tsc --noEmit, noEmit-only like the sibling
  flauz extensions; `build/flauz/scripts/bundle-extensions.mjs` produces
  `dist/extension.js` for real boots).
