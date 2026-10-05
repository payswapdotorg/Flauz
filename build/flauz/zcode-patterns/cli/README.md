# Flauz CLI/headless parity contracts (ZC-009, Phase C)

Typed contract set for the first-class CLI/headless client of the
existing Flauz service journeys: command grammar, request/response
wire records, exit codes and output formats, and the journey parity
view.

Contract set version: `CLI_PARITY_CONTRACTS_VERSION = '1.0.0'`, carried
by every module and stamped on every persisted record.

## Module index

- `common/grammar.ts` - the frozen journey-command table: 29 commands
  over the eight service journeys, typed argSpec triplets, `parseSpec`
  (the pure argv validator with typed mismatches), `grammarFor`.
- `common/wire.ts` - `CliRequest` / `CliResponse`, the frozen refusal
  table (no free-form error strings: refusal code + the exact violated
  law), `responseFor` (pure, fail closed), the service journey surface
  list pinned equal to the grammar's.
- `common/exitcodes.ts` - the frozen exit-code vocabulary
  (0 ok / 1 typed-refusal / 2 usage-error / 3 not-found / 4 partial),
  `exitCodeFor` (total outcome mapping; usage-error is the parse-layer
  code), `renderSpec` (the pure output SHAPE contract - json/table/
  digest; never a renderer), `HeadlessMode` (the non-interactive law).
- `common/parity.ts` - `JourneyParityView`, `projectParity` (pure: a
  journey is par-full only when every grammar command has a registered
  service projection; the registry is an injected plain input),
  `parityDrift` (typed diff naming missing/extra journeys and verdict
  mismatches - never a silent mismatch).
- `test/common/*.test.ts` - mocha tdd suites: behavioral tests, closed
  vocabulary pins, cross-module structural pins, fail-closed tests.

## Laws

- Contract set, not an executable CLI: no bin/ packaging, no process
  spawning, no argv runtime parser, no renderer, no network client.
  The runtime client is a later product wave; this wave pins its
  contract.
- Parity is projection: the grammar derives from the EXISTING service
  journeys (workspace, background-agent, workflow, approval, evidence,
  replay, lab, capability-discovery - the same journeys the VS Code
  surfaces expose). A CLI-only journey is unrepresentable; headless
  requests never prompt (interactive-only surfaces are disclosed typed
  refusals).
- Closed vocabularies: outcomes, refusal table, exit codes, output
  formats, render fields, parity verdicts - frozen and pinned by
  tests; free-form error strings are unrepresentable.
- Determinism: no clock reads and no randomness inside `common/**`;
  timestamps are plain ISO strings and durations are injected plain
  numbers.
- Every persisted record carries `scope: CliScope` and
  `contractVersion`.

## Projected authorities (read-only sources)

- `extensions/flauz-agent/src/types.ts` + `sessionsView.ts` - the
  workspace / background-agent / approval journey surfaces.
- `extensions/flauz-execution/src/contracts.ts` - the execution state
  machine, resource refs, journal/evidence semantics.
- `build/flauz/lab/` - the Lab journey surface.
- `extensions/flauz-isolation/` - workspace boundaries.

## Repo-side reconciliation (advisory, pre runtime wave)

`SEAM(ARG_SPECS)` (soft seam, documented in `common/grammar.ts`): the
per-command argSpec triplets and summary digests are minimal contract
decisions over the order-given command table. Reconcile them against
the actual journey surfaces before productizing the runtime client.
Unlike a hard seam this gates nothing: the full suite is expected
green as delivered (142 tests). The journey and command vocabularies
themselves are order-given and pinned verbatim.
