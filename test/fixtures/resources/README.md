# Resource fixtures (test/fixtures/resources/)

The fixture matrix consumed by `extensions/flauz-resources/test/*` (graph /
contract suites) and the R-RES canary (YAML-embedded steps in
`.github/workflows/flauz-resources.yml`).

## Layout

- `good/` — one fully-populated graph (`graph.json`): 10 refs (9 of the 12
  v0 kinds), all 6 edge kinds, all 7 access-surface families, and two
  versioned surface records (a file path move + a browser endpoint swap --
  the identity-vs-access story). Generated THROUGH the real graph API and
  verified clean by `verifyEnvelope` before being written.
- `bad/` — the rejection matrix: 69 numbered files, one defect per file.
  Every validation rule is violated at least once: envelope structure
  (01-12), node identity / the identity law — paths, URLs, malformed or
  kind-mismatched URNs as ids (13-25), node fields incl. fail-closed
  provenance (26-36), edges — closed kind set, missing endpoints, self
  edges, duplicates, the endpoint-kind legality matrix (37-45), surface
  records — families, orphans, version rules (46-55), and the per-family
  surface shapes (56-68); the DL-82 restoration from-kind convergence
  (69: a `restored-from` edge from a `task`-kind ref, rejected once
  `RESTORABLE_KINDS` converged to exactly the kinds with v0 restoration
  families).
- `contracts/` — the pinned cross-worker shapes (DL-32: duplicated types +
  literal fixtures, never cross-extension imports):
  - `browser-session-descriptor.json` — Worker A's BrowserSessionDescriptor
    summary (sessionId, initiator, partition, state) as produced by the
    restoration planner;
  - `environment-descriptor.json` — the environment lifecycle summary
    (registry descriptor id + provider kind + registry state);
  - `environments-registry.json` — a valid `flauz.environments/v0`
    envelope the continuity probe reads (env-staging present + enabled,
    not active);
  - `evidence-row.json` — a `flauz-browser` `toEvidenceRow`-shaped row
    (kind note + uri + sha256 + note) bindable as an evidence ref +
    artifact surface;
  - `urn-ids.json` — the URN id contract (pinned `flauz:browser:<16-hex>`
    browser ids, `flauz:environment:env-*` env refs, invalid examples).

## Conventions

- Repo `.json` fixtures are TAB-indented (repo hygiene; `package.json` is
  the only exemption family). Runtime-written `.flauz/resources.json` is
  2-space canonical (DL-9 envelope discipline — different file family).
- ASCII-only content.
- Bad fixtures are valid JSON that must be REJECTED by
  `ResourceGraph.parseEnvelope` with a `flauz.resources/v0:`-prefixed
  error (`01-graph-not-json.json` is raw text for the not-JSON path).
- SECRET-SHAPED bad cases are NOT fixture files: no complete secret shape
  may ever appear in this repository (push-time secret scanning + the
  vault-only policy). The literal-secret rejection rule is covered by
  runtime-assembled fixtures in `extensions/flauz-resources/test/helpers.ts`
  (`runtimeSecretFixture` — fragments joined at runtime).

## Adding a rule

When a validation rule is added to `extensions/flauz-resources/src/api.ts`
(or a load-time integrity check to `src/graph.ts`), add a numbered bad
fixture violating it and extend the coverage claim in the R-RES canary
spec (`build/flauz/canaries/R-RES.md`).
