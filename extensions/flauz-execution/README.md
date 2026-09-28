# flauz-execution (extensions/flauz-execution)

TL2-S2 resource/execution integration: the additive TL2-side bridge that
lets a durable Agent OS task step treat a browser session, an environment
or a logical resource as an EXECUTION RESOURCE - acquired, targeted and
released through the EXISTING TL3 contracts, never around them.

## Placement law

- TL2 owns Agent OS semantics (the orchestration runtime at
  `extensions/flauz-agent/core/*.mjs`); TL3 owns Browser/Environment OS.
  This module is the bounded bridge: additive files only, ZERO edits to
  flauz-agent/core, flauz-browser, flauz-environments or flauz-resources.
- The task graph references `ResourceRef` IDENTITY (URN ids); the access
  surface is resolved at EXECUTION time through the TL3 ports and recorded
  as hand-off metadata (IDENTITY IS NOT ACCESS).
- Browser policy stays fail-closed; environment trust gates stay
  authoritative; human approvals gate execution and are never auto-granted.

## Layout

```
package.json        commands flauz.exec.status / flauz.exec.verify
                    (onCommand activation only - no startup activation)
src/
  contracts.ts      M1: the execution-resource port - resource identity
                    law (class/kind/URN), surface-snapshot validators
                    (contract-duplicated TL3 vocabularies, pinned by the
                    fixtures the TL3 lanes ship), the journal row contract
                    (15 exact fields), the acquisition transition table,
                    the task-level failure taxonomy and its mapping into
                    the orchestration policy failure classes
  journal.ts        M1/M2: ExecJournalStore - the append-only
                    flauz.execution-journal/v0 (canonical JSON lines,
                    hash-chained, strict load, torn-tail rule, full-replay
                    validation before any byte is written)
  acquisition.ts    M2: the ExecutionResourceManager - acquire/release
                    bound to task-step leases, timeout expiry, rollback
                    sweeps, typed failures
  adapters.ts       M3: the BrowserSession/EnvironmentExecutor/logical
                    adapters over structural ports the real TL3 managers
                    satisfy; provenance on every task-caused mutation
  runtime.ts        the effect sink: run(idempotencyKey, spec) - the seam
                    driveGraph consumes; acquire -> hand-off -> settle ->
                    release with idempotent replay
  continuity.ts     M4: continuity export/restore/reattach integration
                    points (first-class persisted rows, cross-environment
                    restoration, browser session reattach)
  extension.ts      the operator command wiring
test/               node:test, zero dependencies (Node >= 23.6 type
                    stripping); wires the REAL TL3 implementations
shims/              hand-written ambient Node typings (no @types/node)
vscode-dts/         vendored vscode.d.ts (PROVENANCE line inside)
```

## The persistence artifact

`.flauz/execution/journal.jsonl` - one canonical JSON object per line,
envelope `flauz.execution-journal/v0`. Exactly 15 fields per row:
`{$schema, seq, ts, rowId, graphId, stepId, attempt, idempotencyKey,
acquisitionId, type, actor, origin, payload, contentHash, prev}`. Each
row's `prev` carries the previous row's full-row hash (sha256 over the
canonical row minus prev; seq 1 has prev null). `contentHash` is the sha256
of the canonical payload (the content-hash linkage). Provenance on every
row: actor (human|agent|tool|service), origin, contentHash.

Row ids are `X-NNNNNN` (distinct namespace from the orchestration journal's
R-NNNNNN); acquisition ids are `flauz:exec:<16-hex>` LOGICAL ids (never a
path, URL, CDP target id or pid).

Event types (v0, closed list): `resource-acquired`, `resource-released`,
`resource-lost`, `resource-expired`, `handoff-recorded`, `acquire-denied`,
`session-reattached`, `continuity-exported`, `continuity-restored`,
`rollback-recorded`, `recovery-scan`, `effect-settled`.

The acquisition state machine: `acquired -> {released | lost | expired}`;
`lost` is recoverable (`session-reattached` / `continuity-restored`);
`released` and `expired` are terminal. A re-acquire is legal only after a
denial (the next attempt). Actor gates: release accepts every actor
(completion/rollback/expiry from the executors and sweeps, revocation a
human act); expiry is service-only; loss detection is executor-side.

## The failure taxonomy (task level)

`acquire-denied` (gate: browser-policy | environment-trust | graph-state |
resource-graph | invalid-request) maps to the TERMINAL orchestration class
`policy-violation` - fail-closed gates are never retried.
`resource-lost` -> `unavailable`, `executor-death` ->
`dependency-failure`, `acquire-timeout` -> `timeout` (retryable: the graph
re-acquires on the next attempt). `surface-unresolved` and
`invalid-request` -> `invalid-input` (terminal).

## Checks (zero-install)

```
/home/z/my-project/node_modules/.bin/tsc --noEmit -p <this tsconfig>
node --test test/*.test.ts
```

TypeScript is the only dev-dependency and is NOT installed in-tree (sandbox
discipline: reuse the host toolchain). Tests run directly on the `.ts`
sources via Node type stripping.

## Fixtures

`test/fixtures/execution/` (repo root): `good/journal.jsonl` pins the byte
form of a full lifecycle (browser acquire/handoff/settle/release,
environment acquire-with-lease/handoff/lost, logical acquire/handoff);
`bad/` pins one violation per file (schema, unknown key, rowId derivation,
content-hash linkage, actor vocabulary, unknown event, aggregate-vs-
acquisition level, chain break, byte drift, torn middle line, lease shape,
illegal transition order, surface digest linkage, idempotency-key shape).
