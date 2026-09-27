# Environments-lifecycle fixtures (test/fixtures/environments-lifecycle/)

The PIN-2 fixture matrix consumed by
`extensions/flauz-environments/test/fixtures-lifecycle.test.ts`. These pin the
two sibling envelopes the TL3-003 lifecycle persists (a CROSS-WORKER CONTRACT
— another lane consumes them READ-ONLY):

- `.flauz/environments-lifecycle.json` — envelope
  `flauz.environments-lifecycle/v0`: `{schemaVersion, schema, updatedAt,
  entries: {<envId>: {state, updatedAt, executorKind, lastOpRef}}}`.
- `.flauz/environments-ops.jsonl` — append-only, one canonical JSON line per
  op: `{schemaVersion, schema, ts, actor, op, environmentId, result,
  fromState, toState, error?}`.

## Layout

- `good/` — `lifecycle.json` (six entries covering every phase + the
  `/attached` connection substate + the failed-with-error-record shape) and
  `ops.jsonl` (the six matching ledger lines, canonical key order, one
  trailing newline).
- `bad/` — the rejection matrix: 21 numbered files, one per violated rule
  (envelope schema/schemaVersion/extra-key/updatedAt; entry state/keys/
  lastOpRef/executorKind/environment id; ops actor/op/result/
  error-payload-completeness/fromState/extra keys/JSON/schema/
  schemaVersion/blank lines).

## Conventions

- Repo `.json` fixtures are TAB-indented (repo hygiene; the runtime-written
  `.flauz/environments-lifecycle.json` is 2-space canonical — different file
  family, same as `test/fixtures/environments/`).
- `.jsonl` fixtures are single-line canonical JSON per line, one trailing
  newline (the runtime ledger format).
- ASCII-only content.

## Semantics notes

- `state` carries the attach/detach connection substate INSIDE the string
  (`running/attached`, `stopped/attached`) — the entry key set stays exactly
  the PIN-2 four (`state`, `updatedAt`, `executorKind`, `lastOpRef`).
- `lastOpRef` is the 1-based line number of the environment's most recent
  record in the ops ledger.
- `result: 'error'` REQUIRES the `error: {code, message}` payload;
  `result: 'ok'` FORBIDS it.

## Adding a rule

When a validation rule is added to
`extensions/flauz-environments/src/lifecycle/store.ts`, add a numbered bad
fixture violating it (and extend the coverage claim in the fixtures test).
