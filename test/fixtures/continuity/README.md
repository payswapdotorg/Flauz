# Continuity fixtures (test/fixtures/continuity/)

The fixture matrix consumed by
`extensions/flauz-environments/test/fixtures-continuity.test.ts`. These pin
the two TL3-006 NEW sibling envelopes (a cross-worker contract — consumers
read-only):

- `.flauz/continuity-bundles/<bundleId>/manifest.json` — envelope
  `flauz.continuity-bundle/v0`:
  `{schemaVersion, schema, bundleId, createdAt, actor, sourceEnvironmentId?,
  switchPlanRef?, surfaces: {<surfaceName>: {status: 'carried'|'lost'|
  'redacted', artifactPath?, sha256?, bytes?, note?}}}`.
- `.flauz/continuity-ops.jsonl` — append-only, one canonical JSON line per
  op: `{schemaVersion, schema, ts, actor, op: 'export'|'restore'|'verify',
  bundleId, result: 'ok'|'error', prev, details? {fromEnvironmentId?,
  toEnvironmentId?, surfacesCarried, surfacesLost, surfacesRedacted},
  error? {code, message}}`. `prev` is the per-row hash chain — the sha256 of
  the PREVIOUS record's canonical line, `null` on the genesis record (the
  DL-77 tamper-evidence chain: an in-place record edit breaks the successor's
  `prev` and is a typed `OPS_CORRUPT` rejection).

## The surface-status contract (pinned here, not just in code)

- `carried`  : `{status, artifactPath, sha256, bytes, note?}` — the payload
  was copied into the bundle; `sha256` is the CONTENT hash; `artifactPath`
  is bundle-relative under `surfaces/` (no traversal, no absolute).
- `lost`     : `{status, note}` — REQUIRED note (why the surface was not
  carried); never an artifact, never a hash, never bytes.
- `redacted` : `{status, sha256, note?}` — the SECRET-REDACTION LAW: presence
  + sha256 of the surface PATH (re-derivable from the closed surface table),
  never the payload, never bytes, never an artifact path.

The manifest must cover the CLOSED surface table (the 16 N-8 canon surfaces
+ the post-canon state surfaces — 22 in v0); a missing surface key is a
rejection (lost surfaces are typed entries, never silently dropped).

## Layout

- `good/` — `manifest.json` (all 22 surfaces: 7 carried, 3 redacted with the
  correct re-derivable path hashes, 12 typed lost entries with notes) and
  `ops.jsonl` (export ok + restore ok with environment details, verify
  error with the {code, message} payload, export error). Canonical key
  order; the .json is TAB-indented per repo fixture hygiene (the
  runtime-written manifest is 2-space canonical — equal states, not bytes).
- `bad/` — the rejection matrix: 35 numbered files, one defect per file.
  Manifest rules (01-21): not-JSON, schema, schemaVersion, missing/malformed
  bundleId (a PATH as id is rejected), actor, createdAt, extra key,
  surfaces-not-object, unknown surface (closed table), missing surface
  (incomplete table), bad status, carried-without-artifact, bad content
  hash, lost-with-artifact, redacted-with-bytes, artifact-path traversal,
  malformed switchPlanRef citation, malformed sourceEnvironmentId,
  lost-without-note, fabricated redacted path-hash. Ops rules (22-35):
  actor, op, result, error-without-payload, ok-with-payload, malformed
  bundleId, extra key, not-JSON, schema, schemaVersion, blank line,
  negative count, malformed details env id, bad ts.

## Adding a rule

When a validation rule is added to
`extensions/flauz-environments/src/continuityExec/store.ts`, add a numbered
bad fixture violating it (and extend the coverage claim in the fixtures
test).

## Conventions

- Repo `.json` fixtures are TAB-indented (repo hygiene); `.jsonl` fixtures
  are single-line canonical JSON per line, one trailing newline.
- ASCII-only content.
- SECRET-SHAPED cases are never fixture files: the redaction law is proven
  by runtime-assembled fixtures in
  `extensions/flauz-environments/test/continuityExec.test.ts`.
