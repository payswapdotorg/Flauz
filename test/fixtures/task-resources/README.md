# Task-Resources Fixtures (TL2-S2)

Fixture family for `extensions/flauz-agent/src/resourceExec/` (the
task-boundary resource lease layer, envelope `flauz.task-resources/v0`).

Consumed READ-ONLY by `extensions/flauz-agent/test/resourceExec/fixtures.test.ts`
(the `fixtures-continuity.test.ts` pattern: the extension suite owns these
fixtures; they are NOT wired into `build/flauz/scripts/verify-fixtures.sh`).

## good/ -- a valid small workspace `.flauz/` state

```
.flauz/tasks.json                      flauz.tasks/v0 (T-001, execute)
.flauz/browser-sessions.jsonl          PIN-1 journal (agent + human + closed sessions)
.flauz/environments.json               flauz.environments/v0 registry (trusted/untrusted/disabled)
.flauz/environments-lifecycle.json     PIN-2 lifecycle (running + created)
.flauz/environments-ops.jsonl          PIN-2 ops ledger (3 canonical lines)
.flauz/resources.json                  flauz.resources/v0 graph (task/file/browser-session refs)
.flauz/resources-ops.jsonl             flauz.resources-ops/v0 (2 canonical lines)
.flauz/task-resources.jsonl            flauz.task-resources/v0 (released browser lease + ACTIVE env lease)
.flauz/continuity-ops.jsonl            flauz.continuity-ops/v0 (export ok + verify ok)
.flauz/continuity-bundles/flauz:continuity:0123456789abcdef/
    manifest.json                      flauz.continuity-bundle/v0 (22 surfaces: 6 carried / 3 redacted / 13 lost)
    surfaces/*.json                    the carried artifacts (sha256-pinned by the manifest)
```

The `.json` files are TAB-indented (equal states, not bytes -- the runtime
envelopes are 2-space); the `.jsonl` files are CANONICAL single lines (the
PIN-1/PIN-2 byte law: recursively sorted keys, compact, one `\n` per record).

## bad/ -- one file per failure class

Each bad fixture REPLACES one canonical state file (the fixtures test maps
each onto its in-memory path) and pins exactly one typed refusal:

| file | pins |
|---|---|
| `01-browser-session-absent.jsonl` | RESOURCE_ABSENT (agent session not in the journal) |
| `02-browser-session-closed.jsonl` | TRUST_REFUSED (latest journal state `closed`) |
| `03-browser-session-failed.jsonl` | TRUST_REFUSED (latest journal state `failed`) |
| `04-browser-human-initiator.jsonl` | TRUST_REFUSED (agent actor + human-initiator session) |
| `05-browser-non-canonical.jsonl` | typed journal SKIP (non-canonical line) -> RESOURCE_ABSENT |
| `06-env-untrusted.json` | TRUST_REFUSED (posture `untrusted`) |
| `07-env-unknown.json` | RESOURCE_ABSENT (not registered) |
| `08-env-destroyed.json` | RESOURCE_ABSENT (lifecycle `destroyed`) |
| `09-env-lifecycle-corrupt.json` | STATE_UNREADABLE (wrong lifecycle schema id) |
| `10-ref-absent.json` | RESOURCE_ABSENT (ref not in the graph) |
| `11-graph-corrupt.json` | STATE_UNREADABLE (wrong graph `$schema`) |
| `12-bundle-manifest-incomplete.json` | CONTINUITY_INVALID (closed-table completeness) |
| `13-bundle-hash-mismatch.json` | CONTINUITY_INVALID (carried artifact hash mismatch) |
| `14-bundle-redacted-bad-hash.json` | CONTINUITY_INVALID (redacted path-hash mismatch) |
| `15-ledger-non-canonical.jsonl` | LEDGER_CORRUPT (non-canonical ledger line) |
| `16-ledger-unknown-actor.jsonl` | LEDGER_CORRUPT (unknown actor -- the PROVENANCE fixture form) |
| `17-ledger-double-acquire.jsonl` | LEDGER_CORRUPT (lease id minted twice) |
| `18-ledger-terminal-without-acquire.jsonl` | LEDGER_CORRUPT (terminal event for an unacquired lease) |
| `19-ledger-wrong-schema.jsonl` | LEDGER_CORRUPT (wrong ledger schema id) |
| `20-browser-partition-changed.jsonl` | SURFACE_MISMATCH (partition re-minted across records) |
| `21-ref-family-changed.json` | SURFACE_MISMATCH (surface family set changed) |

## Secret safety

No literal credential-shaped strings exist in this family. Secret-shaped
material for the SECRET_IN_LEASE law is fragment-assembled at RUNTIME by the
test suite (never spelled out in the tree).
