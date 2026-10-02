# Flauz Backup

The A-PROD-004-W2 beta-gate surface: **durable-state backup/export** and
**crash recovery** over the REAL durable state — the exact surface set the
W1 diagnostics census enumerates (`extensions/flauz-diagnostics`, PR #128),
one surface definition per census row, ids identical, pinned by the contract
suite.

## Commands (command-only activation)

| Command | What it does |
|---|---|
| `Flauz: Export Durable State (Backup)` (`flauz.backup.export`) | Documents exactly what the export will contain in the output channel, THEN creates `<workspace>/.flauz-exports/export-<stamp>/`. |
| `Flauz: Verify Export` (`flauz.backup.verify`) | Re-checks an export against its MANIFEST and renders the per-surface verdict table (green / tampered / torn). Accepts `{ "exportDir": "export-..." }` (default: the newest export). |
| `Flauz: Restore Durable State From Export (Crash Recovery)` (`flauz.backup.restore`) | VERIFY FIRST, then restore per-surface atomic stage+rename. Requires `{ "overwrite": true }` (the explicit overwrite consent) when target surface files are non-empty. Banks a recovery record into the restored state. |

## The export shape (v1)

```
.flauz-exports/export-<stamp>/
  export.json     metadata: versions, timestamp, workspace identity,
                  format version (1), the command line, receipts of the
                  other metadata artifacts
  MANIFEST.json   the per-surface inventory: every copied file's sha256 +
                  byte size, the surface's row/record counts, the format
                  version per surface (absent surfaces are listed absent,
                  never faked)
  integrity.json  the tamper-evidence verdicts re-run at export time (the
                  ledger chain + the ops chain, the same verdicts the
                  diagnostics surface reports)
  state/.flauz/…  the surface files themselves, byte-identical, mirroring
                  the workspace layout exactly
```

The surface set (exactly the census enumeration): the tasks file, the
evidence ledger, the evidence size watermark, the resources graph, the
resources ops-chain, the environments registry, the browser-session journal,
the workflow envelopes (`index.json` + every `W-NNN.json`), the
orchestration state (`graphs.json` + `journal.jsonl`), and the provider-lanes
state (`providers.json`, `routing-policy.json`, `routing-decisions.jsonl`,
`provider-switches.jsonl` — the complete known file set of the census's
models-dir row). Exports are **workspace-local in v0**: no network, no
telemetry, never leave the machine.

## The privacy law (split-sided)

An export legitimately contains durable-state **CONTENTS** — `state/` is a
byte-identical copy; that is a backup's job. What never carries a
secret-shaped value is the **metadata class**: `export.json`,
`MANIFEST.json`, `integrity.json`, the banked recovery record and every
command render. Every metadata artifact is swept for credential-shaped
literals before a single byte is written; a hit refuses the whole operation
(fail-closed). The canary regression tests plant secrets in the durable state
and assert they ARE in the state copy (a backup's honesty) and NEVER in any
metadata surface.

## The verify verdicts

Per surface: **green** (every file's sha256 + bytes re-derive from the
manifest, the re-derived counts match, no extra files), **tampered** (bytes
no longer match — including the swapped-surface-file case, where the digest
matches another manifest entry — counts drifted, metadata receipts drifted,
or unexpected files ride the export), **torn** (a manifest-listed file is
missing or shorter than its recorded size). The chain verifiers are re-run on
the COPIED state and compared with the export-time verdicts pinned in
`integrity.json` — identical bytes must produce identical verdicts. The
verdicts themselves are honest data about the exported state: an export of a
chain-broken workspace is still a *green export* (it faithfully copies what
was there); the verdicts say so.

Honest limitation (offline v0): a tamper that rewrites the state copy AND
both metadata artifacts consistently is equivalent to minting a new export —
undetectable without key material. The tamper-evidence covers partial
tampering (state without manifest, manifest without state, either alone).
Checkpoint signatures stay owner-side (the user keystore never enters an
export); they are counted, never verified here.

## The restore semantics (the crash-recovery path)

1. **Verify first.** Any non-green verdict = the typed `FLAUZ_BACKUP_TAMPERED`
   refusal. Restore NEVER proceeds from an unverified export.
2. **Consent before bytes.** Every target surface file that exists and is
   non-empty requires `{ "overwrite": true }` or the whole restore refuses
   (`FLAUZ_BACKUP_TARGET_NOT_EMPTY`) before a single byte is written.
   Surfaces the export records as ABSENT are left untouched and reported —
   never faked, never deleted.
3. **Per-surface atomic stage+rename.** Every file is staged to a sibling
   `.flauz-restore.tmp` path inside its target directory, then renamed over
   the target. A crash during staging leaves zero target effects; a crash
   during the rename phase leaves a prefix-committed restore that a re-run
   (with consent) completes.
4. **Bank the recovery record.** The durable record lands at
   `.flauz/backup/recovery-log.jsonl` (what/when/from-which-export), AND an
   evidence-ledger note row is appended (synthetic taskId `flauz-backup`,
   following the owning ledger's own `flauz.ledger` checkpoint-row precedent)
   whose uri points at the recovery log and whose sha256 pins the record's
   canonical bytes — so the NEXT DIAGNOSTICS CENSUS genuinely reports the
   recovery (`rowCount` + 1, `kindCounts.note` + 1, a new chain head). When a
   size watermark exists it is rewritten consistently (rowCount/bytes/head of
   the post-banking ledger — the watermark is unsigned JSON), keeping every
   post-restore integrity verdict GREEN. When the restored ledger does not
   parse (an honestly-exported corrupt ledger), the ledger row is skipped
   with a recorded reason; the recovery-log record still lands.

The ops-chain is deliberately NOT banked: it is the mutation log OF the
resources graph, and a restore is not a graph mutation — the graph itself is
restored byte-identically, so the chain's final `afterDigest` still matches.
The evidence ledger is the workspace's audit trail; a restore IS an auditable
event.

Note on banking vs byte-identity: the restore itself is byte-identical per
surface (the corrupted file comes back exactly as exported); the banking
step then appends the disclosed recovery row to the ledger — that is the
point of banking (the state now honestly records that a recovery happened).
The crash-recovery tests assert byte-identity on the non-ledger surfaces and
prefix-identity + valid chain continuation on the ledger.

## Evidence posture

The durable-state formats, the chain verifiers, the canonical JSON + sha256,
the counting laws and the watermark serialization are contract-duplicated
(DL-32: duplicated as types + parsers, pinned by tests against the REAL
owning modules and the shared fixtures — never imported across extensions,
and never imported from flauz-diagnostics either: a backup's verify must not
depend on any verified code being importable). The suite builds fixture
workspaces with the REAL owning services (`local-real`), then runs the
export/verify/restore paths over them, including crash/corruption fixtures
(truncated tasks file, torn ledger) and tamper fixtures (edited bytes,
swapped surface files, deleted export files).

No workspace folder open? The commands degrade honestly: a channel notice
and a typed `FLAUZ_BACKUP_NO_WORKSPACE` result; nothing is created.

## The tests (the G10 recipe — the mocha tdd isolated runner)

The suite is mocha-tdd shaped (`suite`/`test` globals, the
build/flauz/dogfood harness convention — never a repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx
cd <repo-root>/extensions/flauz-backup
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
