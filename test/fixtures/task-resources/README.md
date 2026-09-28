# Task-Resource Fixture Family

Repo-root fixtures consumed READ-ONLY by
`extensions/flauz-agent/test/resourceExec/fixtures.test.ts` (the
`fixtures-continuity.test.ts` pattern, applied to the task-resource layer).

## Layout

- `good/workspace/.flauz/` -- a small valid workspace state (the
  cross-adapter integration target). Carries:
  - `tasks.json` (flauz.tasks/v0 envelope -- a few tasks);
  - `browser-sessions.jsonl` (PIN-1: 3 records -- an active agent
    session, a suspended human session, a closed session);
  - `environments-lifecycle.json` + `environments-ops.jsonl` (PIN-2:
    a running env, an attached env, an untrusted env, a stopped env);
  - `environments.json` (the registry -- the sibling envelope the
    environment adapter reads for the trust posture);
  - `resources.json` (a small graph with browser-session, environment,
    file, and evidence ResourceRefs);
  - `continuity-bundles/flauz:continuity:0123456789abcdef/manifest.json`
    + `continuity-ops.jsonl` (one complete bundle);
  - `task-resources.jsonl` -- the NEW ledger this module owns (a few
    leases + one export-point hand-off).
- `bad/` -- bad `task-resources.jsonl` variants, one per ledger parser
  rule. Each is rejected with a `flauz.task-resources/v0:`-prefixed typed
  error (every rule violated at least once).

## Secret safety

No secret-shaped literal lives in this tree (the
no-flattening / vault-only policy). Secret-shape detection is exercised
in `secretShape.test.ts` by FRAGMENT-ASSEMBLING a secret-shaped string at
runtime -- the pattern from `extensions/flauz-resources/src/api.ts`
("Pattern text only -- no complete secret shape is ever spelled out in
this source file; test fixtures assemble secret-shaped strings from
fragments at runtime").

## Wiring

The extension test suite owns these fixtures (the continuity precedent):
they are NOT wired into `build/flauz/scripts/verify-fixtures.sh`.
