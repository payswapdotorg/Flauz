# Flauz Migration

The A-PROD-004-W3 beta-gate surface: **workspace migration/upgrade safety**
and **rollback** over the REAL durable state — the exact surface set the W1
diagnostics census enumerates (`extensions/flauz-diagnostics`, PR #128), one
surface definition per census row, ids identical, pinned by the contract
suite. The rollback anchor IS a W2 export
(`extensions/flauz-backup`, PR #133): the migration's contract-duplicated
export machinery produces genuine `.flauz-exports/export-<stamp>/` artifacts
that `flauz.backup.verify` (and `flauz.backup.restore`) accept, pinned
cross-recognizable in BOTH directions by the contract suite.

## Commands (command-only activation)

| Command | What it does |
|---|---|
| `Flauz: Plan Workspace Migration (Pre-flight)` (`flauz.migration.plan`) | Censuses the current state, reads every surface's ACTUAL on-disk format version (the W2 MANIFEST shape), judges compatibility against this build's formats, and renders + persists the migration plan at `.flauz/migration/plan.json`. Typed refusals for incompatible/mixed/unreadable versions (the exact surface + version pair) and for torn migrations. |
| `Flauz: Execute Workspace Migration (Anchor-first)` (`flauz.migration.execute`) | ANCHOR FIRST: creates + verifies a W2 export of the current state; no verified anchor = the typed refusal, ZERO transforms run. Then per-surface atomic stage+rename transforms exactly as planned, post-flight verification (re-census + chain verifiers re-run + anchor-verdict comparison), and the migration record banked into the census-visible state. |
| `Flauz: Roll Back Workspace Migration (Verify-first)` (`flauz.migration.rollback`) | VERIFY FIRST on the anchor (any mismatch = the typed tamper refusal; rollback NEVER proceeds from an unverified anchor), then per-surface atomic stage+rename restore, byte-identical from the anchor, then the migration artifacts cleaned (the persisted plan DELETED — a resume-after-rollback is a fresh plan, never a blind continue) and the rollback record banked. Requires `{ "overwrite": true }` when target surface files are non-empty (the W2 consent law). |

## The plan shape (v1)

```
.flauz/migration/plan.json
  $schema: flauz.migration-plan/v1
  planId: sha256 over the canonical body minus the id itself (execute
          re-derives it: a tampered plan = the typed STALE refusal)
  surfaces: the census inventory, one row per census surface --
            present + expectedVersion + detectedVersion + the per-file
            sha256/bytes/versions; absent surfaces are listed absent
            (stepKind 'absent'), never faked
  steps:   the ordered execution plan -- identity steps (same-format:
           byte-identical re-commit through the atomic stage+rename) and
           transform steps (cross-format: the registered transform)
  target:  the product/extension versions of the build whose formats the
           plan migrates to (this build = the surface registry)
  anchorRequirement: the anchor-first law, verbatim
```

## The version-source law (honest detection, never assumption)

Per-file format versions are READ, never assumed: `.json` surface files
declare their version in-band (`$schema`, or `schema` for the models
family); `.jsonl` surface files declare it on every row (the orchestration
journal, the browser-session journal, the routing decisions, the provider
switches). Two files self-declare nothing BY DESIGN — the evidence ledger
(`flauz.evidence.rows/v0`) and the resources ops chain
(`flauz.resources-ops/v0`): their version is the pinned row contract,
validated line-by-line by the contract-duplicated parsers. Anything else
(unparseable, undeclared, mixed) is a typed plan refusal naming the exact
surface + file + problem: a plan NEVER proceeds past a version it cannot
read.

## The transform registry (the honest scope)

Cross-format steps resolve through a typed transform registry
(`TransformSpec`: surface + fromVersion + toVersion + per-file apply). At
the pinned base **ZERO production transforms are registered** — every
surface's current format IS this build's format, and inventing another
extension's future format would violate the boundary law (a surface's own
format-version handling belongs to its owner in a later wave). The registry
structure, the plan's transform-step rendering and the execute path's
transform application are complete and proven by tests with injected
transform specs over REAL surface files; the first real (from, to) pair
lands with the owning wave that defines it.

## The anchor-first law (the wave's core safety)

`flauz.migration.execute` creates a W2 export of the CURRENT state (the
contract-duplicated builder — same schema ids, same directory shape, the
provenance fields `commandLine: flauz.migration.execute` /
`extensionId: flauz.flauz-migration` are the only difference from a
`flauz.backup.export` artifact) and verifies it with the contract-duplicated
verifier BEFORE the first transform. No verified anchor = the typed
`FLAUZ_MIGRATION_ANCHOR_UNVERIFIED` refusal, zero transforms run. The
anchor's `state/` copy is byte-identical (that is an export's job); the
metadata surfaces are swept for secret-shaped values before write.

## The torn-migration law

A migration interrupted mid-transform is DETECTABLE by three orthogonal
signals, each naming the EXACT surface: (1) the in-progress marker
(`.flauz/migration/in-progress.json` — written after the anchor verifies,
checked off per completed surface, removed only at full success; a present
marker = torn, the unchecked steps name the surfaces in flight); (2) the
stage-file scan (a `<file>.flauz-migration.tmp` leftover under `.flauz/`
names its surface); (3) the content readers (a surface corrupted
mid-structure refuses the plan typed with the parse problem; the chain
verifiers name the ledger/ops classes). Plan and execute REFUSE while torn;
rollback REPORTS the torn state and proceeds (rollback IS the recovery):
verify-first on the anchor, byte-identical per-surface restore, the torn
artifacts + the persisted plan cleaned, the rollback record banked. A
resume-after-rollback is a fresh `flauz.migration.plan`, never a blind
continue.

## The banking law (census visibility)

The migration record lands at `.flauz/migration/migration-log.jsonl`
(what/when/which-plan/which-anchor) AND an evidence-ledger note row is
appended (synthetic taskId `flauz-migration`, the `flauz-backup`
recovery-row precedent) whose uri points at the record bank and whose
sha256 pins the record's canonical bytes — so the NEXT DIAGNOSTICS CENSUS
genuinely reports the migration (rowCount + 1, kindCounts.note + 1, a new
chain head). The rollback record lands at
`.flauz/migration/rollback-log.jsonl` + its own ledger note row: a
migration followed by its rollback is a census-visible PAIR. When a size
watermark exists it is rewritten consistently (rowCount/bytes/head of the
post-banking ledger), keeping every post-migration integrity verdict GREEN.

Banking vs byte-identity (the W2 note): the restore itself is
byte-identical per surface (the anchor restores the exact bytes — the tests
assert byte-equality on every non-ledger surface); the banking step then
appends the disclosed rollback row to the ledger. The ledger is
prefix-identical with the anchor's copy plus exactly one banked row.

## The privacy law (split-sided)

Durable-state CONTENTS legitimately transit — the anchor's `state/` copy,
the transformed files, the anchor's `state/` mirror of the migrated state:
that is a migration's job. What never carries a secret-shaped value is the
METADATA class: `plan.json`, the in-progress marker, the banked
migration/rollback records, and every command render. Every metadata
artifact is swept for credential-shaped literals before a single byte is
written; a hit refuses the whole operation (fail-closed). The canary
regression tests plant secrets in the durable state and assert they ARE in
the state transit and NEVER in any metadata surface — including the
fail-closed backstop (a secret-shaped workspace-root path refuses the plan,
because the root rides `plan.json`).

## Evidence posture

The durable-state formats, the chain verifiers, the canonical JSON + sha256,
the counting laws, the W2 export/verify machinery and the watermark
serialization are contract-duplicated (DL-32: duplicated as types + parsers,
pinned by tests against the REAL owning modules, the real flauz-diagnostics
census AND the real flauz-backup export/verify — never imported across
extensions in src). The suite builds fixture workspaces with the REAL owning
services (`local-real`), then runs the plan/execute/rollback paths over
them, including crash/corruption fixtures (the sabotage wrappers: corrupted
anchor copies, mid-rename crashes), torn fixtures (marker, stage leftovers,
content tears) and tamper fixtures (edited anchor bytes, edited plans).

No workspace folder open? The commands degrade honestly: a channel notice
and a typed `FLAUZ_MIGRATION_NO_WORKSPACE` result; nothing is created.

## The tests (the G10 recipe — the mocha tdd isolated runner)

The suite is mocha-tdd shaped (`suite`/`test` globals, the
build/flauz/dogfood harness convention — never a repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx
cd <repo-root>/extensions/flauz-migration
NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```

`npm test` in this directory runs the same mocha command (mocha resolves
from the repo root's devDependencies after a root install; the tsx loader
rides NODE_OPTIONS as above). The scoped typechecks:

```sh
tsc --noEmit                       # src only (full strict incl. noUnusedLocals)
tsc --noEmit -p tsconfig.test.json # src + tests (see the in-file note on the
                                   # sibling lint-posture relaxation)
```
