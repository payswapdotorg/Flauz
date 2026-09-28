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

- `src/executable.ts` - EXECUTABLE reusable workflows (TL2-005, Worker C M3):
  - `flauz.workflows.exec/v1` specs (WS-NNN): typed inputs (string/number/
    boolean/json params), steps with `{$param: name}` input-template refs,
    per-step approval + onFail policy;
  - VALIDATION: schema (strict) + SEMANTIC (tool refs exist in the
    ToolRegistryPort, template refs resolve to declared params, steps
    contiguous, non-empty);
  - VERSIONING: explicit `bumpSpec` (version+1 + a recorded migration stub);
    envelopeVersion above the supported one is a typed error - never
    in-place reinterpretation;
  - DURABLE RUNS: `flauz.workflow.runs/v1` envelopes (WR-NNN) under
    `.flauz/workflow-runs/`, persisted before/after EVERY step - the run
    envelope IS the durable-graph projection (`graphRowsOf` emits the
    GraphRowRef seam shape Worker A's graph speaks);
  - RECOVERY: `recover(runId)` resumes an interrupted run to a coherent
    state - done steps never re-execute, a 'running' step (crash
    mid-execution) re-runs at-least-once, recovery is pinned to the spec
    version the run started with; kill-and-recover matrix pinned by tests;
  - re-run linkage via `derivedFrom` (distilled runs link to the source
    fragment's task + evidence rows - the house pattern).

- `src/coordination.ts` - REAL agent-to-agent coordination (TL2-006, Worker
  C M4) over the typed A2A bus:
  - DELEGATION CONTRACTS (`flauz.a2a.contracts/v1`, `.flauz/a2a/contracts/`):
    goal + typed inputs + constraints (maxSteps/deadline/tools, recorded) +
    a typed result schema; persisted BEFORE the task-delegation message
    posts (crash-safe);
  - SHARED TASK STATE: `sharedState(taskId)` = the task envelope + the
    contract + the durable-graph run rows - the rows BOTH agents see
    (exec runs support `taskId` to run under the delegated task);
  - PRIVATE CONTEXT: the share lifecycle through the ContextSharePort (the
    flauz-memory MemoryStore satisfies it structurally); the boundary itself
    is enforced in flauz-memory's pure retrieval - no consumer can bypass;
  - RESULT VERIFICATION: evidence ids must resolve in the ledger AND the
    artifact bytes must re-hash to the row sha256; anything less is labeled
    `reported-not-verified` (never passed off as verified);
  - STEERING: mid-flight steering-relay with provenance recorded on the
    contract (messageId/from/ts); steering after submission is a typed error;
  - TRANSPORT: the in-process mediator port (`inMemoryA2aPort`) + the stdio
    loopback through the REAL core service (`flauz.a2a.*` over
    core/service.mjs) - pinned by tests.

- `test/recovery-matrix.test.ts` - THE KILL-AND-RECOVER MATRIX: the full
  stateful substrate (tasks + hardened ledger + fragments + exec runs +
  memory + A2A over the real on-disk bus journal + watermarks + checkpoints
  + claims) with simulated process deaths at five axes - mid-run step 2,
  step 1, after completion (no-op), double kill, and mid-memory-promotion -
  each followed by a full instance rebuild from disk and a coherent-state
  recovery pass (memory/ledger/checkpoint verification, run resumption,
  watermark deltas, contract verification, claim replay).

## Conventions

- Zero runtime dependencies; node >= 20 stdlib only (node-free core: all IO
  through the flauz-workspace `FileSystemPort`/`Clock`).
- Canonical serialization (sorted keys, 2-space indent, one trailing newline) -
  the DL-9 git-diffability discipline.
- Tests: `node --test test/*.test.ts` (node type-stripping; no build step).
- Typecheck: `npm run typecheck` (tsc --noEmit, noEmit-only like the sibling
  flauz extensions; `build/flauz/scripts/bundle-extensions.mjs` produces
  `dist/extension.js` for real boots).
