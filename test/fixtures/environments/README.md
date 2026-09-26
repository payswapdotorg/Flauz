# Environment fixtures (test/fixtures/environments/)

The fixture matrix consumed by `extensions/flauz-environments/test/fixtures.test.ts`
and the C-ENV canary runner (`build/flauz/scripts/env-registry-canary.mjs`).

## Layout

- `good/` — five valid descriptors (one per v0 kind + the bridged SSH
  variant) and `registry.json`, a full envelope carrying all five with
  `activeId` set.
- `bad/` — the rejection matrix: 45 numbered files, one per violated
  validation rule (every rule is violated at least once — descriptor
  structure, ids, kinds, labels, trust, capabilities, timing; envelope
  schema/activeId/duplicates; SSH host/port/auth/path/bridge (including the
  literal-token mistake); container shapes; cloud provider/apiKeyRef/template;
  workspace-remote authority prefix/path/viaTunnel).
- `plans/` — golden pins: the expected `flauz.connectionPlan/v0` documents
  for the five good descriptors. Generated from the provider adapters; a
  change to plan shape FAILS the pin on purpose (contract drift must be
  deliberate). Fixtures are semantically compared via canonical JSON
  (indentation-independent).
- `continuity/` — snapshot + expected-classification pairs for the N-8
  model: `snapshot-all.json` (all 16 canon surfaces), `snapshot-minimal.json`
  (+ its expected report), and two bad snapshots (unknown surface id,
  duplicate surface id).

## Conventions

- Repo `.json` fixtures are TAB-indented (repo hygiene; `package.json` is the
  only exemption family). Runtime-written `.flauz/environments.json` is
  2-space canonical (DL-9 envelope discipline — different file family).
- ASCII-only content.
- Bad fixtures 01-18 + 26-45 are valid JSON that must be REJECTED by the
  validators; `19-registry-not-json.json` is raw text for the not-JSON path;
  20-25 exercise the envelope-level (`parseEnvelope`) rejections.

## Adding a rule

When a validation rule is added to `src/api.ts` / `src/providers/*.ts`,
add a numbered bad fixture violating it (and extend the coverage claim in
the fixtures test: the matrix must keep >= 40 files).
