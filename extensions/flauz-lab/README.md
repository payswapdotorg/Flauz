# Flauz Lab

The Engineering Lab console (W1): run the fixture-lane evaluation ladder over
the task worlds, inspect candidate organizations, compare against the
single-agent baseline and save recommendations.

## What W1 shows

- **Scenarios** - the fixture task scenarios from the deterministic world
  catalog (`build/flauz/lab/common/taskWorlds.ts`); click one to make it
  active.
- **Run Lab Now** - executes the L2 robustness rung (fixed seed pair, 4
  instances per seed, balanced utility weights) over the active scenario
  through the organization search and the run engine
  (`build/flauz/lab/common/orgSearch.ts`, `runEngine.ts`).
- **Candidates** - the evaluated organizations ranked by utility; the
  single-agent baseline is always present and marked. Click a candidate to
  inspect it.
- **Comparison** - the selected candidate vs the baseline on every
  dimension; positive delta always means better.
- **Save Recommendation** - records the reversible draft (in-session) and
  shows the apply refusal on every save.

## The closed apply seam (by design)

Applying a recommendation routes through Agent OS via the Lab bridge
(LAB-010). The console is a recommendation surface - it never becomes a
second execution engine. Every save carries this refusal verbatim.

## Architecture

- `src/consoleState.ts` - the pure W1 state machine (vscode-free,
  node-free; fully covered by `node --test`).
- `src/labConsolePort.ts` - the injected port contract.
- `src/labView.ts` - the `flauz.lab` tree view (vscode slices injected).
- `src/labFlauzPort.ts` - the runtime binding to the deterministic lab core
  (the only cross-lane runtime edge; esbuild resolves the core's `.js`
  specifiers at bundle time; no test imports it).
- `src/extension.ts` - activation wiring (view + commands).

The deterministic core lives at `build/flauz/lab/` (single source of truth,
station-gated by the mocha/tdd lane); this extension only consumes it.
