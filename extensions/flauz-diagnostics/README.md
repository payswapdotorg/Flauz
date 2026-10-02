# Flauz Diagnostics

The A-PROD-004-W1 beta-gate surface: a **diagnostics view** and a
**support/debug bundle** over the REAL durable state (`.flauz/`), built
redacted-by-default.

## Commands (command-only activation)

| Command | What it does |
|---|---|
| `Flauz: Show Diagnostics` (`flauz.diag.show`) | Renders the diagnostics snapshot into the `Flauz Diagnostics` output channel. Creates nothing. |
| `Flauz: Create Support Bundle` (`flauz.diag.bundle`) | Documents exactly what the bundle will contain in the output channel, THEN creates `<workspace>/.flauz/support-bundle-<stamp>/`. |

`flauz.diag.bundle` accepts an optional `include` argument (a class name or
an array), e.g. `{ "include": ["diagnostics", "integrity"] }`. The default is
the full safe set. The `contents` class is **refused** (see below).

## What a v0 support bundle contains (the disclosure)

Every bundle ships a `MANIFEST.json` that enumerates its artifact classes —
the same enumeration rendered into the output channel BEFORE the bundle is
created:

| Class | File | Contents |
|---|---|---|
| `manifest` | `MANIFEST.json` | This enumeration, the include set, the privacy law, and the sha256 + byte count of every other file. |
| `diagnostics` | `diagnostics.json` | Product/extension versions, environment summary (node/platform/arch), and the durable-state census: task/event/status counts, ledger rows + chain-head hash + kind counts, resources-graph ref/edge/surface counts, ops-chain length, environments-registry count, browser-session journal count, workflow envelope count, orchestration graph/journal counts. **Counts and hashes only, never contents.** |
| `provider-lanes` | `provider-lanes.json` | Provider lane ids, model ids, enablement; routing-policy rule ids + ranking modes; decision counts by selected lane; provider-switch event count. **No keys, no credentials, no endpoints.** |
| `recent-events` | `recent-events.json` | The last 20 rows of each typed event surface (execution journal, resources ops chain, provider-switch linking events), each row reduced to ids, actors, enums, paths and digests. Free-form payloads, causes, notes and explanations are dropped. |
| `integrity` | `integrity.json` | Tamper-evidence verdicts: the evidence-ledger chain recompute (seq contiguity, prev linkage, size-watermark comparison) and the resources ops-chain recompute (digest continuity, prev linkage, envelope head digest). Checkpoint signatures are counted only — they are verified owner-side; the user keystore never enters a bundle. |

## The privacy law (v0)

- The bundle **REDACTS BY DEFAULT**: counts and hashes only. Paths and ids
  are metadata (the explicit allowlist). File CONTENTS are never included.
- The `contents` class is **refused with a typed error** that names what a
  contents-class bundle would need as a future decision (per-class redaction
  review, explicit user opt-in, size budgets, third-party-content
  provenance, a contents canary matrix).
- Every artifact is swept for secret-shaped values (credential literals)
  before a single byte is written; a hit refuses the whole bundle
  (fail-closed). The canary regression tests plant secrets in the durable
  state and assert they never reach a bundle file.

## Evidence posture

The durable-state formats and chain verifiers are contract-duplicated
(DL-32: duplicated as types, pinned by tests against the real modules and
the shared fixtures — never imported across extensions). The suite builds
fixture workspaces with the REAL owning services (`local-real`), then runs
the diagnostics surface over them.

No workspace folder open? The commands degrade honestly: a channel notice
and a typed `FLAUZ_DIAG_NO_WORKSPACE` result; no bundle is created.

## The tests (the G10 recipe — the mocha tdd isolated runner)

The suite is mocha-tdd shaped (`suite`/`test` globals, the
build/flauz/dogfood harness convention — never a repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx
cd <repo-root>/extensions/flauz-diagnostics
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
